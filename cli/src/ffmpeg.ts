import { spawnSync, spawn } from 'child_process'
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { uid } from './project.js'
import { loadConfig } from './config.js'
import type { Project, VideoSegment, TextSegment, ScaleKeyframe } from './types.js'

// ── Basic video utilities ────────────────────────────────────────────────────

export function getVideoInfo(videoPath: string): { width: number; height: number; durationSec: number; rotation: number } {
  const r = spawnSync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', videoPath,
  ], { encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`)
  const json = JSON.parse(r.stdout)
  const v = json.streams?.find((s: { codec_type: string }) => s.codec_type === 'video')

  let width: number = v?.width ?? 1080
  let height: number = v?.height ?? 1920
  const durationSec = parseFloat(v?.duration ?? '0')

  const tagRotate = parseInt(v?.tags?.rotate ?? '0')
  const sideRotate = parseInt(v?.side_data_list?.[0]?.rotation ?? '0')
  const rotate = tagRotate || sideRotate

  if (Math.abs(rotate % 180) === 90) {
    ;[width, height] = [height, width]
  }

  return { width, height, durationSec, rotation: rotate }
}

export function extractFrame(videoPath: string, timeSec: number, outputPath?: string): string {
  const tmp = outputPath ?? join(tmpdir(), `frame_${uid()}.jpg`)
  const r = spawnSync('ffmpeg', [
    '-ss', String(timeSec),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '3',
    '-vf', 'scale=640:-1',
    tmp, '-y',
  ], { stdio: 'pipe' })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString()}`)
  return tmp
}

export function extractKeyframes(videoPath: string, count: number): { timestamps: number[]; paths: string[] } {
  const info = getVideoInfo(videoPath)
  const duration = info.durationSec
  const timestamps: number[] = []
  const paths: string[] = []

  const filters: string[] = []
  if (info.rotation !== 0) {
    const absRotate = Math.abs(info.rotation % 360)
    if (absRotate === 90 || absRotate === 270) {
      if ((info.rotation === -90) || (info.rotation === 270)) {
        filters.push('transpose=1')
      } else if ((info.rotation === 90) || (info.rotation === -270)) {
        filters.push('transpose=2')
      }
    } else if (absRotate === 180) {
      filters.push('transpose=1,transpose=1')
    }
  }
  filters.push('scale=640:-2')
  const vf = filters.join(',')

  for (let i = 0; i < count; i++) {
    const t = (duration / (count + 1)) * (i + 1)
    timestamps.push(t)
    const tmp = join(tmpdir(), `frame_${uid()}.jpg`)
    const r = spawnSync('ffmpeg', [
      '-ss', String(t), '-i', videoPath,
      '-vf', vf, '-vframes', '1', '-q:v', '2',
      tmp, '-y',
    ], { stdio: 'pipe' })
    if (r.status === 0) {
      paths.push(tmp)
    }
  }

  return { timestamps, paths }
}

// ── Preview rendering (matches export quality) ──────────────────────────────

function getFontFile(): string {
  const config = loadConfig()
  if (existsSync(config.fontPath)) return config.fontPath
  // Fallback: don't specify fontfile, let ffmpeg use default
  return ''
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
}

// LINE_HEIGHT matches renderTextToPng (export canvas) which uses lineHeight = effectiveSize (1.0)
// CSS live preview uses 1.05 but the export renderer is what matters for output fidelity
const LINE_HEIGHT = 1.0

/**
 * Build drawtext filter chain for a text segment, rendering each line separately
 * to match the editor's tight line spacing (CSS lineHeight: 1.05).
 * FFmpeg's built-in \n handling uses the font's line gap which is much larger.
 */
function buildDrawtextFilters(
  t: TextSegment,
  canvasW: number,
  canvasH: number,
  fontFile: string,
  enable?: string,
): string[] {
  const fs = Math.round(t.fontSize * (t.textScale ?? 1))
  const col = t.color.replace('#', '0x') + 'ff'
  const px = Math.round((t.x + 1) / 2 * canvasW)
  const py = Math.round((1 - t.y) / 2 * canvasH)
  const lines = t.text.split('\n')
  const lineH = Math.round(fs * LINE_HEIGHT)
  const totalH = lines.length * lineH

  const filters: string[] = []
  for (let li = 0; li < lines.length; li++) {
    if (!lines[li]) continue
    const esc = escapeDrawtext(lines[li])
    const xExpr = t.textAlign === 'left' ? `${px}` : t.textAlign === 'right' ? `${px}-tw` : `${px}-tw/2`
    // Center of this line: py - totalH/2 + lineH * (li + 0.5) - th/2 for drawtext y
    const lineY = py - Math.round(totalH / 2) + Math.round(lineH * li)

    let dt = `drawtext=text='${esc}':fontsize=${fs}:fontcolor=${col}:x=${xExpr}:y=${lineY}`
    if (fontFile) dt += `:fontfile='${fontFile}'`
    if (t.strokeEnabled) {
      // Sub-linear scaling: larger text gets proportionally thinner outline
      // At fs=85 → ~6px, at fs=120 → ~7px (instead of linear ~9px)
      const bw = Math.max(1, Math.round(Math.sqrt(fs) * 0.55))
      dt += `:bordercolor=${t.strokeColor.replace('#', '0x')}ff:borderw=${bw}`
    } else {
      // Subtle border matching text color to mimic browser's heavier font rendering
      dt += `:bordercolor=${col}:borderw=2`
    }
    if (enable) dt += `:${enable}`
    filters.push(dt)
  }
  return filters
}

export function renderPreview(project: Project, timeSec?: number, outputPath?: string): string {
  const { canvas, tracks } = project

  type ActiveVideo = { seg: VideoSegment; trackIdx: number }
  const activeVideo: ActiveVideo[] = []
  const activeText: TextSegment[] = []

  // Default time: 0.5s into first video clip, or 0
  if (timeSec === undefined) {
    const firstVid = tracks.flatMap(t => t.segments).find(s => s.type === 'video') as VideoSegment | undefined
    timeSec = firstVid ? firstVid.startUs / 1e6 + 0.5 : 0
  }

  for (let ti = 0; ti < tracks.length; ti++) {
    for (const seg of tracks[ti].segments) {
      const start = seg.startUs / 1e6
      const end = (seg.startUs + seg.durationUs) / 1e6
      if (timeSec < start || timeSec >= end) continue
      if (seg.type === 'video') activeVideo.push({ seg: seg as VideoSegment, trackIdx: ti })
      else if (seg.type === 'text') activeText.push(seg as TextSegment)
    }
  }
  activeVideo.sort((a, b) => a.trackIdx - b.trackIdx)

  // Build ffmpeg inputs
  const ffArgs: string[] = [
    '-f', 'lavfi', '-i', `color=c=black:s=${canvas.width}x${canvas.height}:r=30`,
  ]
  for (const { seg } of activeVideo) {
    const seekTime = Math.max(0, seg.sourceStartUs / 1e6 + (timeSec! - seg.startUs / 1e6))
    ffArgs.push('-ss', String(seekTime), '-i', seg.src)
  }

  const fp: string[] = []

  // Step 1: crop + scale each video
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

  // Step 2: overlay onto canvas
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

  // Step 3: drawtext for each text segment — one filter per line for correct spacing
  const fontFile = getFontFile()
  const allDrawtexts: string[] = []
  for (const t of activeText) {
    allDrawtexts.push(...buildDrawtextFilters(t, canvas.width, canvas.height, fontFile))
  }
  for (let i = 0; i < allDrawtexts.length; i++) {
    const out = i === allDrawtexts.length - 1 ? '[txtout]' : `[txt${i}]`
    fp.push(`${cur}${allDrawtexts[i]}${out}`)
    cur = out
  }

  // Step 4: output at full resolution
  fp.push(`${cur}null[out]`)

  const tmp = outputPath ?? join(tmpdir(), `preview_${uid()}.jpg`)
  const r = spawnSync('ffmpeg', [
    '-y', ...ffArgs,
    '-filter_complex', fp.join(';'),
    '-map', '[out]',
    '-vframes', '1',
    '-q:v', '2',
    tmp,
  ], { stdio: 'pipe' })

  if (r.status !== 0) {
    throw new Error(`ffmpeg failed:\n${r.stderr?.toString().slice(-800)}`)
  }

  return tmp
}

// ── Full export pipeline (headless, no Electron) ─────────────────────────────

function getScaleFilter(seg: VideoSegment, outStart: number, canvas: { width: number; height: number }): { filter: string; needsCentering: boolean } {
  const baseScale = seg.clipScale ?? 1
  const kfs = seg.scaleKeyframes
  const srcW = seg.sourceWidth ?? canvas.width
  const srcH = seg.sourceHeight ?? canvas.height
  const cropL = seg.cropLeft ?? 0, cropR = seg.cropRight ?? 0
  const cropT = seg.cropTop ?? 0, cropB = seg.cropBottom ?? 0
  const cW = Math.max(0.01, 1 - cropL - cropR)
  const cH = Math.max(0.01, 1 - cropT - cropB)

  if (!kfs || kfs.length === 0) {
    const fullH = Math.round(baseScale * canvas.height / 2) * 2
    const fullW = Math.round((srcW / srcH) * fullH / 2) * 2
    const visW = Math.max(2, Math.round(fullW * cW / 2) * 2)
    const visH = Math.max(2, Math.round(fullH * cH / 2) * 2)
    return { filter: `scale=${visW}:${visH}:force_original_aspect_ratio=disable`, needsCentering: false }
  }

  const sorted = [...kfs].sort((a, b) => a.timeMs - b.timeMs)
  const firstKf = sorted[0]
  const lastKf = sorted[sorted.length - 1]
  const segDuration = seg.durationUs / 1e6

  const baseH = canvas.height
  const baseW = Math.round((srcW / srcH) * baseH)

  if (Math.abs(firstKf.scale - lastKf.scale) < 0.01) {
    const fullH = Math.round(firstKf.scale * baseH / 2) * 2
    const fullW = Math.round((srcW / srcH) * fullH / 2) * 2
    const visW = Math.max(2, Math.round(fullW * cW / 2) * 2)
    const visH = Math.max(2, Math.round(fullH * cH / 2) * 2)
    return { filter: `scale=${visW}:${visH}:force_original_aspect_ratio=disable`, needsCentering: false }
  }

  // Smooth zoom: scale at 4x resolution with eval=frame, overlay on 4x canvas,
  // then downscale to canvas size. The 4px rounding at 4x = 1px at final res (invisible).
  const HIRES = 4
  const hiresW = canvas.width * HIRES
  const hiresH = canvas.height * HIRES
  const t0 = outStart
  const t1 = outStart + segDuration
  const hiresBaseW = baseW * HIRES
  const hiresBaseH = baseH * HIRES

  const interpW = `${hiresBaseW}*(${firstKf.scale}+(${lastKf.scale - firstKf.scale})*(t-${t0})/(${t1}-${t0}))`
  const interpH = `${hiresBaseH}*(${firstKf.scale}+(${lastKf.scale - firstKf.scale})*(t-${t0})/(${t1}-${t0}))`
  const widthExpr = `4*trunc((${interpW})/4)`
  const heightExpr = `4*trunc((${interpH})/4)`

  return {
    filter: `fps=30,scale=w=${widthExpr}:h=${heightExpr}:eval=frame:flags=lanczos`,
    needsCentering: true,
    hiresCanvas: { w: hiresW, h: hiresH }
  } as any
}

export function exportVideo(
  project: Project,
  outputPath: string,
  onProgress?: (line: string) => void
): Promise<{ ok?: boolean; error?: string; filePath?: string }> {
  const { canvas, tracks } = project
  const fontFile = getFontFile()
  const FPS = 30

  // Collect video segments
  const allVideoSegs: Array<{ seg: VideoSegment; trackIdx: number }> = []
  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti]
    if (track.type === 'video') {
      for (const seg of track.segments) allVideoSegs.push({ seg: seg as VideoSegment, trackIdx: ti })
    }
  }
  allVideoSegs.sort((a, b) =>
    a.trackIdx !== b.trackIdx ? a.trackIdx - b.trackIdx : a.seg.startUs - b.seg.startUs
  )

  if (allVideoSegs.length === 0) return Promise.resolve({ error: 'No video segments to export' })

  const rawDuration = Math.max(...allVideoSegs.map(({ seg }) => (seg.startUs + seg.durationUs) / 1e6))
  const totalFrames = Math.round(rawDuration * FPS)
  const totalDuration = rawDuration

  // Collect all text segments
  const allTextSegs: Array<{ seg: TextSegment; trackIdx: number }> = []
  for (let ti = 0; ti < tracks.length; ti++) {
    if (tracks[ti].type === 'text') {
      for (const seg of tracks[ti].segments) {
        allTextSegs.push({ seg: seg as TextSegment, trackIdx: ti })
      }
    }
  }

  // Build inputs
  const inputs: string[] = [
    '-f', 'lavfi', '-i', `color=c=black:s=${canvas.width}x${canvas.height}:r=${FPS}:d=${totalDuration}`
  ]
  for (const { seg } of allVideoSegs) {
    inputs.push(
      '-ss', String(seg.sourceStartUs / 1_000_000),
      '-t', String(seg.sourceDurationUs / 1_000_000),
      '-i', seg.src
    )
  }

  const filterParts: string[] = []

  // Step 1: crop + scale + fps for each video
  // Animated zoom segments scale at 4x resolution, overlay on 4x canvas, downscale.
  const HIRES = 4
  for (let i = 0; i < allVideoSegs.length; i++) {
    const { seg } = allVideoSegs[i]
    const cropL = seg.cropLeft ?? 0, cropR = seg.cropRight ?? 0
    const cropT = seg.cropTop ?? 0, cropB = seg.cropBottom ?? 0
    const cW = Math.max(0.01, 1 - cropL - cropR)
    const cH = Math.max(0.01, 1 - cropT - cropB)
    const hasCrop = cropL > 0 || cropR > 0 || cropT > 0 || cropB > 0
    const cropFilter = hasCrop ? `crop=iw*${cW}:ih*${cH}:iw*${cropL}:ih*${cropT},` : ''
    const outStart = seg.startUs / 1e6
    const result = getScaleFilter(seg, outStart, canvas)
    const ptsShift = `setpts=PTS-STARTPTS+${outStart}/TB`

    if (result.needsCentering && (result as any).hiresCanvas) {
      // Animated zoom: scale at 4x, overlay on 4x black canvas, downscale to canvas size.
      // This makes 4px rounding = 1px at final res (invisible).
      const hc = (result as any).hiresCanvas as { w: number; h: number }
      const clipX = seg.clipX ?? 0
      const clipY = seg.clipY ?? 0
      const userOffsetX = Math.round((clipX + 1) / 2 * hc.w - hc.w / 2)
      const userOffsetY = Math.round((1 - clipY) / 2 * hc.h - hc.h / 2)
      const xExpr = `(W-w)/2+${userOffsetX}`
      const yExpr = `(H-h)/2+${userOffsetY}`
      filterParts.push(
        `[${i + 1}:v]${cropFilter}${result.filter},${ptsShift}[sv${i}prep]`,
        `color=c=black:s=${hc.w}x${hc.h}:r=${FPS}:d=${totalDuration}[hibg${i}]`,
        `[hibg${i}][sv${i}prep]overlay=x='${xExpr}':y='${yExpr}':eval=frame:eof_action=pass,scale=${canvas.width}:${canvas.height}:flags=lanczos[sv${i}]`
      )
    } else {
      filterParts.push(
        `[${i + 1}:v]${cropFilter}${result.filter},fps=${FPS},${ptsShift}[sv${i}]`
      )
    }
  }

  // Step 2: overlay chain
  let currentIn = '[0:v]'
  for (let i = 0; i < allVideoSegs.length; i++) {
    const { seg } = allVideoSegs[i]
    const outLabel = i === allVideoSegs.length - 1 && allTextSegs.length === 0 ? '[vout]' : `[ov${i}]`
    const hasAnimatedZoom = seg.scaleKeyframes && seg.scaleKeyframes.length > 0 &&
      Math.abs(seg.scaleKeyframes[0].scale - seg.scaleKeyframes[seg.scaleKeyframes.length - 1].scale) >= 0.01

    if (hasAnimatedZoom) {
      // Already canvas-sized from hires pipeline
      filterParts.push(
        `${currentIn}[sv${i}]overlay=0:0:eof_action=pass${outLabel}`
      )
    } else {
      const clipScale = seg.clipScale ?? 1
      const clipX = seg.clipX ?? 0
      const clipY = seg.clipY ?? 0
      const srcW = seg.sourceWidth ?? canvas.width
      const srcH = seg.sourceHeight ?? canvas.height
      const cropL = seg.cropLeft ?? 0, cropT = seg.cropTop ?? 0
      const fullH = Math.round(clipScale * canvas.height / 2) * 2
      const fullW = Math.round((srcW / srcH) * fullH / 2) * 2
      const x = Math.round((clipX + 1) / 2 * canvas.width - fullW / 2 + cropL * fullW)
      const y = Math.round((1 - clipY) / 2 * canvas.height - fullH / 2 + cropT * fullH)
      filterParts.push(
        `${currentIn}[sv${i}]overlay=${x}:${y}:eof_action=pass${outLabel}`
      )
    }
    currentIn = outLabel
  }

  // Step 3: drawtext for text segments — one filter per line for correct spacing
  if (allTextSegs.length > 0) {
    const allDrawtexts: string[] = []
    for (const { seg: t } of allTextSegs) {
      const startSec = t.startUs / 1e6
      const endSec = (t.startUs + t.durationUs) / 1e6
      const enable = `enable='between(t,${startSec},${endSec})'`
      allDrawtexts.push(...buildDrawtextFilters(t, canvas.width, canvas.height, fontFile, enable))
    }
    for (let i = 0; i < allDrawtexts.length; i++) {
      const outLabel = i === allDrawtexts.length - 1 ? '[vout]' : `[dt${i}]`
      filterParts.push(`${currentIn}${allDrawtexts[i]}${outLabel}`)
      currentIn = outLabel
    }
  } else if (allVideoSegs.length > 0) {
    // Rename last overlay to vout if no text
    // Already handled above when allTextSegs.length === 0
  }

  // If no text and the last overlay label isn't [vout], add null filter
  if (allTextSegs.length === 0 && currentIn !== '[vout]') {
    filterParts.push(`${currentIn}null[vout]`)
  }

  // Audio
  const audioTracks = tracks.filter(t => (t.type === 'audio' || t.type === 'video') && !t.muted)
  const audioSegs: any[] = []
  for (const track of audioTracks) {
    if (track.type === 'audio') {
      for (const seg of track.segments) audioSegs.push(seg)
    } else if (track.type === 'video') {
      for (const seg of track.segments) audioSegs.push({ ...seg, isVideoAudio: true })
    }
  }

  let audioArgs: string[] = []
  let audioFilter = ''

  if (audioSegs.length > 0) {
    const audioInputStartIdx = 1 + allVideoSegs.length
    for (const seg of audioSegs) {
      audioArgs.push(
        '-ss', String(seg.sourceStartUs / 1_000_000),
        '-t', String(seg.sourceDurationUs / 1_000_000),
        '-i', seg.src
      )
    }

    const audioFilterParts: string[] = []
    audioSegs.forEach((seg: any, i: number) => {
      const inputIdx = audioInputStartIdx + i
      const startSec = seg.startUs / 1e6
      if (startSec >= 0) {
        audioFilterParts.push(`[${inputIdx}:a]adelay=${Math.round(startSec * 1000)}|${Math.round(startSec * 1000)}[a${i}]`)
      } else {
        audioFilterParts.push(`[${inputIdx}:a]anull[a${i}]`)
      }
    })

    if (audioSegs.length === 1) {
      audioFilter = audioFilterParts[0] + ';[a0]anull[aout]'
    } else {
      const mixInputs = audioSegs.map((_: any, i: number) => `[a${i}]`).join('')
      audioFilter = audioFilterParts.join(';') + `;${mixInputs}amix=inputs=${audioSegs.length}:duration=longest[aout]`
    }
  }

  const filterComplex = audioSegs.length > 0
    ? filterParts.join(';') + ';' + audioFilter
    : filterParts.join(';')

  const args = [
    '-y',
    ...inputs,
    ...audioArgs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    ...(audioSegs.length > 0 ? ['-map', '[aout]'] : ['-an']),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-frames:v', String(totalFrames),
    ...(audioSegs.length > 0 ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    outputPath
  ]

  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args)
    let stderrOutput = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrOutput += text
      onProgress?.(text)
    })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, filePath: outputPath })
      } else {
        resolve({ error: `FFmpeg exited with code ${code}\n${stderrOutput.slice(-500)}` })
      }
    })
    proc.on('error', (err) => {
      resolve({ error: err.message })
    })
  })
}
