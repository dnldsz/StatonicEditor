import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'

const TIKTOK_FONT =
  '/Users/danieldsouza/Downloads/tiktok-text-display-cufonfonts/TikTok Text Medium.ttf'

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
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

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
        const width = vstream?.width ?? 1080
        const height = vstream?.height ?? 1920
        const durationSec = parseFloat(vstream?.duration ?? '0')
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

  // Scale + concat filter
  const filterParts: string[] = []
  for (let i = 0; i < videoSegments.length; i++) {
    filterParts.push(
      `[${i}:v]scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=increase,crop=${canvas.width}:${canvas.height}[v${i}]`
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
    filterParts.push(
      `${currentIn}drawtext=fontfile='${TIKTOK_FONT}':text='${escaped}':fontsize=${seg.fontSize}:fontcolor=0x${hex.toUpperCase()}${boldStr}:x=${xPx - seg.fontSize * escaped.length / 4}:y=${yPx}:enable='between(t,${startSec},${endSec})'${outLabel}`
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
