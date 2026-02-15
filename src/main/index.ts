import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Menu } from 'electron'
import { join, extname, basename } from 'path'
import { readFileSync, writeFileSync, watch, readdirSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync } from 'fs'
import type { FSWatcher } from 'fs'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

// Use PNG for dock (more reliable in dev than .icns)
const ICON_PATH = join(__dirname, '../../resources/icon.png')

// ── Hot-reload: watch the open project file or folder for external changes ──
let mainWin: BrowserWindow | null = null
let fileWatcher: FSWatcher | null = null
let watchDebounce: ReturnType<typeof setTimeout> | null = null

function watchProjectFile(filePath: string): void {
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null }
  fileWatcher = watch(filePath, () => {
    if (watchDebounce) clearTimeout(watchDebounce)
    watchDebounce = setTimeout(() => {
      try {
        const project = JSON.parse(readFileSync(filePath, 'utf-8'))
        mainWin?.webContents.send('project-file-changed', project)
      } catch {
        // ignore transient read errors mid-write
      }
    }, 150)
  })
}

function watchFolder(folderPath: string): void {
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null }
  fileWatcher = watch(folderPath, { recursive: false }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.json')) return
    if (watchDebounce) clearTimeout(watchDebounce)
    watchDebounce = setTimeout(() => {
      try {
        const fullPath = join(folderPath, filename)
        const project = JSON.parse(readFileSync(fullPath, 'utf-8'))
        mainWin?.webContents.send('batch-file-changed', { filename, project })
      } catch {
        // ignore transient read errors mid-write
      }
    }, 150)
  })
}

function createWindow(): BrowserWindow {
  const preloadPath = join(__dirname, '../preload/index.mjs')

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      webSecurity: false // allow local file:// video URLs
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Prevent Electron from navigating away when files are dropped onto the window
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  return win
}

app.setName('Statonic')
app.setAboutPanelOptions({
  applicationName: 'Statonic',
  applicationVersion: '1.0.0',
  iconPath: ICON_PATH
})

app.whenReady().then(() => {
  // Set macOS application menu so menu bar shows "Statonic" instead of "Electron"
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Statonic',
      submenu: [
        { role: 'about', label: 'About Statonic' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Statonic' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Statonic' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]))

  if (app.dock) {
    const icon = nativeImage.createFromPath(ICON_PATH)
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon)
    } else {
      console.error('[icon] nativeImage is empty — check path:', ICON_PATH)
    }
  }
  mainWin = createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── helpers ────────────────────────────────────────────────────────────────────

function uid(): string {
  return randomBytes(6).toString('hex')
}

function getClipLibraryPath(accountId?: string): string {
  const base = join(app.getPath('userData'), 'clip-library')
  if (accountId) {
    return join(base, 'accounts', accountId, 'clips')
  }
  return join(base, 'clips')  // legacy path for clips without account
}

function getAccountsPath(): string {
  return join(app.getPath('userData'), 'accounts.json')
}

function loadAccounts(): any[] {
  const accountsPath = getAccountsPath()
  if (!existsSync(accountsPath)) return []
  try {
    return JSON.parse(readFileSync(accountsPath, 'utf-8'))
  } catch {
    return []
  }
}

function saveAccounts(accounts: any[]): void {
  const accountsPath = getAccountsPath()
  writeFileSync(accountsPath, JSON.stringify(accounts, null, 2), 'utf-8')
}

function parseVideoStream(vstream: any): { width: number; height: number; durationSec: number } {
  let width: number = vstream?.width ?? 1080
  let height: number = vstream?.height ?? 1920
  const durationSec = parseFloat(vstream?.duration ?? '0')

  // Mobile videos are often encoded in landscape with a rotation tag.
  // ffprobe reports raw encoded dimensions; we need display dimensions.
  const tagRotate = parseInt(vstream?.tags?.rotate ?? '0')
  const sideRotate = parseInt(vstream?.side_data_list?.[0]?.rotation ?? '0')
  const rotate = tagRotate || sideRotate
  if (Math.abs(rotate % 180) === 90) {
    ;[width, height] = [height, width]
  }

  return { width, height, durationSec }
}

// ── IPC handlers ───────────────────────────────────────────────────────────────

ipcMain.handle('open-video', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add Video',
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const name = filePath.split('/').pop() ?? filePath

  // Use ffprobe to get duration and dimensions
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath
    ])
    let out = ''
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('close', () => {
      try {
        const json = JSON.parse(out)
        const vstream = json.streams?.find((s: any) => s.codec_type === 'video')
        const { width, height, durationSec } = parseVideoStream(vstream)
        resolve({ path: filePath, name, width, height, durationSec })
      } catch {
        resolve({ path: filePath, name, width: 1080, height: 1920, durationSec: 0 })

      }
    })
    proc.on('error', () => {
      resolve({ path: filePath, name, width: 1080, height: 1920, durationSec: 0 })
    })
  })
})

ipcMain.handle('save-project', async (_event, project: any) => {
  const result = await dialog.showSaveDialog({
    title: 'Save Project',
    defaultPath: `${project.name ?? 'untitled'}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { cancelled: true }
  try {
    writeFileSync(result.filePath, JSON.stringify(project, null, 2))
    watchProjectFile(result.filePath)
    return { ok: true, filePath: result.filePath }
  } catch (err: any) {
    return { error: err.message }
  }
})

ipcMain.handle('load-project', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Project',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  try {
    const raw = readFileSync(result.filePaths[0], 'utf-8')
    watchProjectFile(result.filePaths[0])
    return JSON.parse(raw)
  } catch (err: any) {
    return { error: err.message }
  }
})

// Called when a file is dragged into the renderer — no dialog needed
ipcMain.handle('get-video-info', async (_event, filePath: string) => {
  const name = filePath.split('/').pop() ?? filePath
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filePath
    ])
    let out = ''
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('close', () => {
      try {
        const json = JSON.parse(out)
        const vstream = json.streams?.find((s: any) => s.codec_type === 'video')
        const { width, height, durationSec } = parseVideoStream(vstream)
        resolve({ path: filePath, name, width, height, durationSec })
      } catch {
        resolve({ path: filePath, name, width: 1080, height: 1920, durationSec: 0 })

      }
    })
    proc.on('error', () => {
      resolve({ path: filePath, name, width: 1080, height: 1920, durationSec: 0 })
    })
  })
})

ipcMain.handle('save-temp-png', async (_event, dataUrl: string, filename: string) => {
  const tmpDir = app.getPath('temp')
  const filePath = join(tmpDir, filename)
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return filePath
})

ipcMain.handle('export-video', async (event, project: any, textOverlays: Array<{ path: string; startSec: number; endSec: number }> = []) => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `${project.name ?? 'export'}.mp4`,
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  })
  if (!filePath) return { cancelled: true }

  const { canvas, tracks } = project

  // Collect all video segments preserving track order (track 0 = bottom layer)
  const allVideoSegs: Array<{ seg: any; trackIdx: number }> = []
  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti]
    if (track.type === 'video') {
      for (const seg of track.segments) allVideoSegs.push({ seg, trackIdx: ti })
    }
  }
  // Lower track index rendered first (underneath), then by start time within each track
  allVideoSegs.sort((a, b) =>
    a.trackIdx !== b.trackIdx ? a.trackIdx - b.trackIdx : a.seg.startUs - b.seg.startUs
  )

  if (allVideoSegs.length === 0) return { error: 'No video segments to export' }

  const totalDuration = Math.max(...allVideoSegs.map(({ seg }) => (seg.startUs + seg.durationUs) / 1e6))

  // Input 0: black canvas for the full output duration. Inputs 1..N: video segments.
  const inputs: string[] = [
    '-f', 'lavfi', '-i', `color=c=black:s=${canvas.width}x${canvas.height}:r=30:d=${totalDuration}`
  ]
  for (const { seg } of allVideoSegs) {
    inputs.push(
      '-ss', String(seg.sourceStartUs / 1_000_000),
      '-t', String(seg.sourceDurationUs / 1_000_000),
      '-i', seg.src
    )
  }

  const filterParts: string[] = []

  // Step 1: crop each segment then scale to its correct cropped display size
  for (let i = 0; i < allVideoSegs.length; i++) {
    const { seg } = allVideoSegs[i]
    const clipScale = seg.clipScale ?? 1
    const srcW = seg.sourceWidth ?? canvas.width
    const srcH = seg.sourceHeight ?? canvas.height
    const cropL = seg.cropLeft ?? 0, cropR = seg.cropRight ?? 0
    const cropT = seg.cropTop ?? 0, cropB = seg.cropBottom ?? 0
    const cW = Math.max(0.01, 1 - cropL - cropR)
    const cH = Math.max(0.01, 1 - cropT - cropB)

    // Full frame display size
    const fullH = Math.round(clipScale * canvas.height / 2) * 2
    const fullW = Math.round((srcW / srcH) * fullH / 2) * 2
    // Cropped visible size (what actually appears on canvas)
    const visW = Math.max(2, Math.round(fullW * cW / 2) * 2)
    const visH = Math.max(2, Math.round(fullH * cH / 2) * 2)

    const hasCrop = cropL > 0 || cropR > 0 || cropT > 0 || cropB > 0
    const cropFilter = hasCrop
      ? `crop=iw*${cW}:ih*${cH}:iw*${cropL}:ih*${cropT},`
      : ''

    filterParts.push(
      `[${i + 1}:v]${cropFilter}scale=${visW}:${visH}:force_original_aspect_ratio=disable,fps=fps=30[sv${i}]`
    )
  }

  // Step 2: chain overlay filters — each segment placed at the right position and time
  let currentIn = '[0:v]'
  for (let i = 0; i < allVideoSegs.length; i++) {
    const { seg } = allVideoSegs[i]
    const clipScale = seg.clipScale ?? 1
    const clipX = seg.clipX ?? 0
    const clipY = seg.clipY ?? 0
    const srcW = seg.sourceWidth ?? canvas.width
    const srcH = seg.sourceHeight ?? canvas.height
    const cropL = seg.cropLeft ?? 0, cropT = seg.cropTop ?? 0

    const fullH = Math.round(clipScale * canvas.height / 2) * 2
    const fullW = Math.round((srcW / srcH) * fullH / 2) * 2

    // Center of the full frame on canvas, then offset for crop to get top-left of visible area
    const frameCX = (clipX + 1) / 2 * canvas.width
    const frameCY = (1 - clipY) / 2 * canvas.height
    const x = Math.round(frameCX - fullW / 2 + cropL * fullW)
    const y = Math.round(frameCY - fullH / 2 + cropT * fullH)

    const outStart = seg.startUs / 1e6
    const outEnd = (seg.startUs + seg.durationUs) / 1e6
    const outLabel = i === allVideoSegs.length - 1 ? '[vcomp]' : `[ov${i}]`

    filterParts.push(
      `${currentIn}[sv${i}]overlay=${x}:${y}:enable='between(t,${outStart},${outEnd})'${outLabel}`
    )
    currentIn = outLabel
  }

  // Text overlays: rendered to PNGs by the browser (supports emoji + WYSIWYG)
  const pngInputArgs: string[] = []
  for (const overlay of textOverlays) {
    pngInputArgs.push('-loop', '1', '-i', overlay.path)
  }

  // Text overlay input indices start after the black canvas + all video segments
  let vIn = '[vcomp]'
  if (textOverlays.length === 0) {
    filterParts.push(`[vcomp]null[vout]`)
  } else {
    textOverlays.forEach((overlay, i) => {
      const inputIdx = 1 + allVideoSegs.length + i
      const outLabel = i === textOverlays.length - 1 ? '[vout]' : `[vto${i}]`
      filterParts.push(
        `${vIn}[${inputIdx}:v]overlay=0:0:shortest=1:enable='between(t,${overlay.startSec},${overlay.endSec})'${outLabel}`
      )
      vIn = outLabel
    })
  }

  const filterComplex = filterParts.join(';')
  const args = [
    '-y',
    ...inputs,
    ...pngInputArgs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    filePath
  ]

  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args)
    proc.stderr.on('data', (chunk: Buffer) => {
      event.sender.send('export-progress', chunk.toString())
    })
    proc.on('close', (code) => {
      if (code === 0) {
        shell.showItemInFolder(filePath)
        resolve({ ok: true, filePath })
      } else {
        resolve({ error: `FFmpeg exited with code ${code}` })
      }
    })
    proc.on('error', (err) => {
      resolve({ error: err.message })
    })
  })
})

ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Batch Folder',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const folderPath = result.filePaths[0]
  const files = readdirSync(folderPath).filter(f => f.endsWith('.json'))

  const projects: Array<{ name: string; path: string; project: any }> = []
  for (const file of files) {
    try {
      const fullPath = join(folderPath, file)
      const project = JSON.parse(readFileSync(fullPath, 'utf-8'))
      projects.push({ name: file.replace('.json', ''), path: fullPath, project })
    } catch {
      // skip invalid JSON files
    }
  }

  if (projects.length > 0) {
    watchFolder(folderPath)
  }

  return { folderPath, projects }
})

ipcMain.handle('render-thumbnail', async (_event, projectPath: string, timeSec = 0.5) => {
  try {
    const project = JSON.parse(readFileSync(projectPath, 'utf-8'))
    const { canvas, tracks } = project

    // Collect active video segments at timeSec
    type ActiveVideo = { seg: any; trackIdx: number }
    const activeVideo: ActiveVideo[] = []

    for (let ti = 0; ti < tracks.length; ti++) {
      for (const seg of tracks[ti].segments) {
        if (seg.type !== 'video') continue
        const start = seg.startUs / 1e6
        const end = (seg.startUs + seg.durationUs) / 1e6
        if (timeSec >= start && timeSec < end) {
          activeVideo.push({ seg, trackIdx: ti })
        }
      }
    }
    activeVideo.sort((a, b) => a.trackIdx - b.trackIdx)

    if (activeVideo.length === 0) {
      // Return black frame
      return null
    }

    // Build ffmpeg filter to composite a single frame
    const ffArgs: string[] = [
      '-f', 'lavfi', '-i', `color=c=black:s=${canvas.width}x${canvas.height}:r=1:d=1`,
    ]
    for (const { seg } of activeVideo) {
      const seekTime = Math.max(0, seg.sourceStartUs / 1e6 + (timeSec - seg.startUs / 1e6))
      ffArgs.push('-ss', String(seekTime), '-i', seg.src)
    }

    const fp: string[] = []

    // Step 1: crop + scale
    for (let i = 0; i < activeVideo.length; i++) {
      const { seg } = activeVideo[i]
      const clipScale = seg.clipScale ?? 1
      const srcW = seg.sourceWidth ?? canvas.width
      const srcH = seg.sourceHeight ?? canvas.height
      const cropL = seg.cropLeft ?? 0, cropR = seg.cropRight ?? 0
      const cropT = seg.cropTop ?? 0, cropB = seg.cropBottom ?? 0
      const cW = Math.max(0.01, 1 - cropL - cropR)
      const cH = Math.max(0.01, 1 - cropT - cropB)
      const fullH = Math.round(clipScale * canvas.height / 2) * 2
      const fullW = Math.round((srcW / srcH) * fullH / 2) * 2
      const visW = Math.max(2, Math.round(fullW * cW / 2) * 2)
      const visH = Math.max(2, Math.round(fullH * cH / 2) * 2)
      const cropFilter = (cropL > 0 || cropR > 0 || cropT > 0 || cropB > 0)
        ? `crop=iw*${cW}:ih*${cH}:iw*${cropL}:ih*${cropT},` : ''
      fp.push(`[${i + 1}:v]${cropFilter}scale=${visW}:${visH}[sv${i}]`)
    }

    // Step 2: overlay chain
    let cur = '[0:v]'
    for (let i = 0; i < activeVideo.length; i++) {
      const { seg } = activeVideo[i]
      const clipScale = seg.clipScale ?? 1
      const srcW = seg.sourceWidth ?? canvas.width, srcH = seg.sourceHeight ?? canvas.height
      const cropL = seg.cropLeft ?? 0, cropT = seg.cropTop ?? 0
      const fullH = Math.round(clipScale * canvas.height / 2) * 2
      const fullW = Math.round((srcW / srcH) * fullH / 2) * 2
      const x = Math.round((seg.clipX + 1) / 2 * canvas.width - fullW / 2 + cropL * fullW)
      const y = Math.round((1 - seg.clipY) / 2 * canvas.height - fullH / 2 + cropT * fullH)
      const out = `[ov${i}]`
      fp.push(`${cur}[sv${i}]overlay=${x}:${y}${out}`)
      cur = out
    }

    // Scale to thumbnail size (270px wide)
    fp.push(`${cur}scale=270:-2[out]`)

    const tmp = join(tmpdir(), `thumb_${Date.now()}.jpg`)
    const r = spawn('ffmpeg', [
      '-y', ...ffArgs,
      '-filter_complex', fp.join(';'),
      '-map', '[out]',
      '-vframes', '1',
      '-q:v', '3',
      tmp,
    ])

    return new Promise((resolve) => {
      r.on('close', (code) => {
        if (code === 0) {
          try {
            const data = readFileSync(tmp)
            spawn('rm', ['-f', tmp])
            resolve(data.toString('base64'))
          } catch {
            resolve(null)
          }
        } else {
          resolve(null)
        }
      })
      r.on('error', () => resolve(null))
    })
  } catch {
    return null
  }
})

// ── Clip Library ───────────────────────────────────────────────────────────────

ipcMain.handle('import-clip', async (_event, sourcePath: string, accountId?: string) => {
  const clipId = uid()
  const clipDir = join(getClipLibraryPath(accountId), clipId)
  mkdirSync(clipDir, { recursive: true })

  const ext = extname(sourcePath)
  const destPath = join(clipDir, `video${ext}`)

  try {
    // Copy file to library
    copyFileSync(sourcePath, destPath)

    // Get video info with rotation handling
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      destPath
    ])
    let out = ''
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()))

    return new Promise((resolve) => {
      proc.on('close', () => {
        try {
          const json = JSON.parse(out)
          const vstream = json.streams?.find((s: any) => s.codec_type === 'video')
          const { width, height, durationSec } = parseVideoStream(vstream)

          // Generate thumbnail (with rotation)
          const thumbPath = join(clipDir, 'thumb.jpg')
          const thumbProc = spawn('ffmpeg', [
            '-ss', '0.5',
            '-i', destPath,
            '-vframes', '1',
            '-vf', 'scale=270:-2',
            '-q:v', '3',
            thumbPath, '-y'
          ])

          thumbProc.on('close', () => {
            // Save metadata
            const metadata = {
              id: clipId,
              accountId: accountId || 'default',
              name: basename(sourcePath, ext),
              path: destPath,
              originalPath: sourcePath,
              duration: durationSec,
              width,
              height,
              thumbnail: thumbPath,
              imported: new Date().toISOString(),
              analyzed: false,
              category: 'uncategorized'
            }

            writeFileSync(join(clipDir, 'metadata.json'), JSON.stringify(metadata, null, 2))
            resolve({ ok: true, clip: metadata })
          })

          thumbProc.on('error', () => {
            resolve({ error: 'Failed to generate thumbnail' })
          })
        } catch (err: any) {
          resolve({ error: err.message })
        }
      })

      proc.on('error', (err) => {
        resolve({ error: err.message })
      })
    })
  } catch (err: any) {
    return { error: err.message }
  }
})

ipcMain.handle('get-clip-library', async () => {
  const clips: any[] = []

  // Hard-coded accounts matching frontend
  const hardCodedAccounts = [
    { id: 'daniel', name: 'Daniel' },
    { id: 'stacy', name: 'Stacy' }
  ]

  // Load clips for each account
  for (const account of hardCodedAccounts) {
    const libraryPath = getClipLibraryPath(account.id)
    if (!existsSync(libraryPath)) continue

    const clipDirs = readdirSync(libraryPath)
    for (const clipId of clipDirs) {
      const clipDir = join(libraryPath, clipId)
      try {
        const stat = statSync(clipDir)
        if (!stat.isDirectory()) continue

        const metadataPath = join(clipDir, 'metadata.json')
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))
          clips.push(metadata)
        }
      } catch {
        // Skip invalid directories
      }
    }
  }

  return clips
})

ipcMain.handle('delete-clip-from-library', async (_event, clipId: string) => {
  // Hard-coded accounts matching frontend
  const hardCodedAccounts = [
    { id: 'daniel', name: 'Daniel' },
    { id: 'stacy', name: 'Stacy' }
  ]

  // Search through all account directories
  for (const account of hardCodedAccounts) {
    const clipDir = join(getClipLibraryPath(account.id), clipId)
    if (existsSync(clipDir)) {
      rmSync(clipDir, { recursive: true, force: true })
      return { ok: true }
    }
  }

  return { error: 'Clip not found' }
})

ipcMain.handle('update-clip-metadata', async (_event, clipId: string, updates: any) => {
  // Hard-coded accounts matching frontend
  const hardCodedAccounts = [
    { id: 'daniel', name: 'Daniel' },
    { id: 'stacy', name: 'Stacy' }
  ]

  // Search through all account directories
  for (const account of hardCodedAccounts) {
    const metadataPath = join(getClipLibraryPath(account.id), clipId, 'metadata.json')
    if (existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))
        const updated = { ...metadata, ...updates }
        writeFileSync(metadataPath, JSON.stringify(updated, null, 2))
        return { ok: true, clip: updated }
      } catch (err: any) {
        return { error: err.message }
      }
    }
  }

  return { error: 'Clip not found' }
})

// ── Accounts ───────────────────────────────────────────────────────────────────

ipcMain.handle('get-accounts', async () => {
  return loadAccounts()
})

ipcMain.handle('create-account', async (_event, name: string) => {
  const accounts = loadAccounts()
  const account = {
    id: uid(),
    name,
    created: new Date().toISOString()
  }
  accounts.push(account)
  saveAccounts(accounts)
  return account
})

ipcMain.handle('update-account', async (_event, accountId: string, updates: any) => {
  const accounts = loadAccounts()
  const index = accounts.findIndex((a: any) => a.id === accountId)
  if (index === -1) return { error: 'Account not found' }

  accounts[index] = { ...accounts[index], ...updates }
  saveAccounts(accounts)
  return accounts[index]
})
