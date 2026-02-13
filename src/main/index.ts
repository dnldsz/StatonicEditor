import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'

// Use PNG for dock (more reliable in dev than .icns)
const ICON_PATH = join(__dirname, '../../resources/icon.png')

const TIKTOK_FONT =
  '/Users/danieldsouza/Downloads/tiktok-text-display-cufonfonts/TikTokTextMedium.otf'

function createWindow(): void {
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
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Prevent Electron from navigating away when files are dropped onto the window
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
}

app.whenReady().then(() => {
  if (app.dock) {
    const icon = nativeImage.createFromPath(ICON_PATH)
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon)
    } else {
      console.error('[icon] nativeImage is empty — check path:', ICON_PATH)
    }
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── helpers ────────────────────────────────────────────────────────────────────

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

ipcMain.handle('export-video', async (event, project: any) => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `${project.name ?? 'export'}.mp4`,
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  })
  if (!filePath) return { cancelled: true }

  const { canvas, tracks } = project
  const videoSegments: any[] = []
  const textSegments: any[] = []

  for (const track of tracks) {
    if (track.type === 'video') {
      for (const seg of track.segments) videoSegments.push(seg)
    } else if (track.type === 'text') {
      for (const seg of track.segments) textSegments.push(seg)
    }
  }

  // Sort video segments by timeline position
  videoSegments.sort((a, b) => a.startUs - b.startUs)

  if (videoSegments.length === 0) return { error: 'No video segments to export' }

  // Build inputs: one per video segment
  const inputs: string[] = []
  for (const seg of videoSegments) {
    inputs.push(
      '-ss', String(seg.sourceStartUs / 1_000_000),
      '-t', String(seg.sourceDurationUs / 1_000_000),
      '-i', seg.src
    )
  }

  // Per-clip: scale to display size, overlay on black canvas, then concat
  const filterParts: string[] = []
  for (let i = 0; i < videoSegments.length; i++) {
    const seg = videoSegments[i]
    const clipScale = seg.clipScale ?? 1
    const clipX = seg.clipX ?? 0
    const clipY = seg.clipY ?? 0
    const srcW = seg.sourceWidth ?? canvas.width
    const srcH = seg.sourceHeight ?? canvas.height

    // Display size in export pixels (must be even for libx264)
    let dH = Math.round(clipScale * canvas.height / 2) * 2
    let dW = Math.round((srcW / srcH) * dH / 2) * 2
    // Top-left corner position on canvas
    const x = Math.round((clipX + 1) / 2 * canvas.width - dW / 2)
    const y = Math.round((1 - clipY) / 2 * canvas.height - dH / 2)

    filterParts.push(
      `color=c=black:s=${canvas.width}x${canvas.height}:r=30[bg${i}]`,
      `[${i}:v]scale=${dW}:${dH}:force_original_aspect_ratio=disable,fps=fps=30[sv${i}]`,
      `[bg${i}][sv${i}]overlay=${x}:${y}:shortest=1[v${i}]`
    )
  }
  const concatInputs = videoSegments.map((_, i) => `[v${i}]`).join('')
  filterParts.push(`${concatInputs}concat=n=${videoSegments.length}:v=1:a=0[vcat]`)

  // Drawtext for each text segment
  let currentIn = '[vcat]'
  textSegments.forEach((seg, i) => {
    const startSec = seg.startUs / 1_000_000
    const endSec = (seg.startUs + seg.durationUs) / 1_000_000
    const xPx = Math.round(((seg.x + 1) / 2) * canvas.width)
    const yPx = Math.round(((1 - seg.y) / 2) * canvas.height)
    const escaped = seg.text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "'\\\\\\''")
      .replace(/:/g, '\\:')
      .replace(/\n/g, '\\n')
    const hex = seg.color.replace('#', '')
    const outLabel = i === textSegments.length - 1 ? '[vout]' : `[vt${i}]`
    const boldStr = seg.bold ? ':bold=1' : ''
    const strokeStr = (seg.strokeWidth ?? 0) > 0
      ? `:borderw=${seg.strokeWidth}:bordercolor=0x${(seg.strokeColor ?? '#000000').replace('#', '').toUpperCase()}`
      : ''
    filterParts.push(
      `${currentIn}drawtext=fontfile='${TIKTOK_FONT}':text='${escaped}':fontsize=${seg.fontSize}:fontcolor=0x${hex.toUpperCase()}${boldStr}${strokeStr}:x=${xPx}-(text_w/2):y=${yPx}-(text_h/2):enable='between(t,${startSec},${endSec})'${outLabel}`
    )
    currentIn = outLabel
  })

  if (textSegments.length === 0) {
    filterParts.push(`[vcat]null[vout]`)
  }

  const filterComplex = filterParts.join(';')
  const args = [
    '-y',
    ...inputs,
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
