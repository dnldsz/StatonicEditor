import { spawnSync } from 'child_process'
import { mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getVideoInfo } from './ffmpeg.js'
import { uid } from './project.js'
import type { SceneData, SceneInfo } from './types.js'

/**
 * Detect scene changes in a video using FFmpeg's scene change detection.
 * Then OCR each cut's keyframe and merge consecutive cuts that share
 * the same text overlay into logical scenes.
 */
export function detectScenes(videoPath: string, threshold = 0.3): SceneData {
  const info = getVideoInfo(videoPath)
  const totalDuration = info.durationSec

  // Run scene detection
  const r = spawnSync('ffmpeg', [
    '-i', videoPath,
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-vsync', 'vfr',
    '-f', 'null', '-',
  ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })

  const stderr = r.stderr ?? ''

  // Parse showinfo output for timestamps
  const cutTimes: number[] = []
  for (const line of stderr.split('\n')) {
    const match = line.match(/pts_time:\s*([\d.]+)/)
    if (match) {
      cutTimes.push(parseFloat(match[1]))
    }
  }

  // Build raw cuts from cut points
  const boundaries = [0, ...cutTimes, totalDuration]
  const rawCuts: SceneInfo[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = Math.round(boundaries[i] * 1000) / 1000
    const end = Math.round(boundaries[i + 1] * 1000) / 1000
    const duration = Math.round((end - start) * 1000) / 1000
    if (duration > 0.05) {
      rawCuts.push({ start, end, duration })
    }
  }

  // OCR each cut's keyframe to detect text overlays
  const cutTexts = ocrCuts(videoPath, rawCuts)

  // Merge consecutive cuts with the same text into logical scenes
  const scenes = mergeCutsByText(rawCuts, cutTexts)

  const totalScenes = scenes.length
  const totalCuts = rawCuts.length
  const avgSceneDuration = totalScenes > 0 ? totalDuration / totalScenes : totalDuration
  const hookDuration = scenes.length > 0 ? scenes[0].duration : totalDuration
  const bodyScenes = scenes.slice(1)
  const bodyAvgDuration = bodyScenes.length > 0
    ? bodyScenes.reduce((s, sc) => s + sc.duration, 0) / bodyScenes.length
    : 0
  const cutsPerSecond = totalDuration > 0 ? (totalCuts - 1) / totalDuration : 0

  return {
    scenes,
    raw_cuts: rawCuts,
    total_scenes: totalScenes,
    total_cuts: totalCuts,
    total_duration: Math.round(totalDuration * 1000) / 1000,
    avg_scene_duration: Math.round(avgSceneDuration * 1000) / 1000,
    hook_duration: Math.round(hookDuration * 1000) / 1000,
    body_avg_duration: Math.round(bodyAvgDuration * 1000) / 1000,
    cuts_per_second: Math.round(cutsPerSecond * 1000) / 1000,
  }
}

/**
 * Extract a keyframe for each cut and run tesseract OCR on it.
 * Returns normalized text for each cut (lowercase, trimmed, collapsed whitespace).
 */
function ocrCuts(videoPath: string, cuts: SceneInfo[]): string[] {
  const texts: string[] = []

  for (const cut of cuts) {
    const midTime = cut.start + cut.duration / 2
    const tmpPath = join(tmpdir(), `ocr_${uid()}.jpg`)

    // Extract frame
    const r = spawnSync('ffmpeg', [
      '-ss', String(midTime),
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      '-vf', 'scale=640:-2',
      tmpPath, '-y',
    ], { stdio: 'pipe' })

    if (r.status !== 0) {
      texts.push('')
      continue
    }

    // Run tesseract
    const ocr = spawnSync('tesseract', [
      tmpPath, 'stdout',
      '--psm', '6',     // assume uniform block of text
      '-l', 'eng',
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })

    // Clean up temp file
    try { unlinkSync(tmpPath) } catch {}

    const raw = (ocr.stdout ?? '').trim()
    // Normalize: lowercase, collapse whitespace, strip non-alphanumeric except spaces
    const normalized = raw.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
    texts.push(normalized)
  }

  return texts
}

/**
 * Merge consecutive cuts whose OCR text is similar into logical scenes.
 *
 * Strategy: compare each cut against the group's "anchor" text (the longest
 * OCR result in the group so far). This handles cases where a cut has noisy
 * OCR (e.g., close-up of a textbook) but the overlay text is the same before
 * and after — the noisy cut gets absorbed into the group because the next
 * cut still matches the anchor.
 */
function mergeCutsByText(cuts: SceneInfo[], texts: string[]): SceneInfo[] {
  if (cuts.length === 0) return []

  const scenes: SceneInfo[] = []
  let groupStart = 0
  let anchorText = texts[0] // best OCR text for the current group

  for (let i = 1; i <= cuts.length; i++) {
    // Check if this cut should merge into the current group.
    // Compare against the anchor text AND look ahead to bridge noisy middle cuts.
    let shouldMerge = false
    if (i < cuts.length) {
      const currentText = texts[i]
      // Direct match: this cut's text matches the group anchor
      if (anchorText.length > 3 && currentText.length > 3 && textSimilar(anchorText, currentText)) {
        shouldMerge = true
      }
      // Bridge match: this cut doesn't match the anchor, but the NEXT cut does.
      // This handles noisy OCR on close-ups/b-roll within the same overlay.
      else if (i + 1 < cuts.length && anchorText.length > 3
        && texts[i + 1].length > 3 && textSimilar(anchorText, texts[i + 1])) {
        shouldMerge = true
      }
    }

    if (shouldMerge) {
      // Update anchor to the longest text in the group (most reliable OCR)
      if (texts[i].length > anchorText.length) {
        anchorText = texts[i]
      }
    } else {
      // Finalize the group [groupStart..i-1]
      const start = cuts[groupStart].start
      const end = cuts[i - 1].end
      const duration = Math.round((end - start) * 1000) / 1000
      const cutsInGroup = i - groupStart

      scenes.push({
        start,
        end,
        duration,
        text: anchorText || undefined,
        cuts: cutsInGroup > 1 ? cutsInGroup : undefined,
      })
      groupStart = i
      anchorText = i < texts.length ? texts[i] : ''
    }
  }

  return scenes
}

/**
 * Check if two OCR texts are similar enough to be the same overlay.
 * Uses Jaccard similarity on word sets with a 0.5 threshold.
 */
function textSimilar(a: string, b: string): boolean {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 1))
  const wordsB = new Set(b.split(' ').filter(w => w.length > 1))
  if (wordsA.size === 0 || wordsB.size === 0) return false

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  const union = wordsA.size + wordsB.size - intersection
  return union > 0 && intersection / union >= 0.5
}

/**
 * Extract one keyframe per scene (at the midpoint of each scene).
 */
export function extractSceneKeyframes(videoPath: string, scenes: SceneInfo[], outDir: string): string[] {
  mkdirSync(outDir, { recursive: true })
  const paths: string[] = []

  for (let i = 0; i < scenes.length; i++) {
    const midTime = scenes[i].start + scenes[i].duration / 2
    const outPath = join(outDir, `scene-${i}.jpg`)
    const r = spawnSync('ffmpeg', [
      '-ss', String(midTime),
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      '-vf', 'scale=640:-2',
      outPath, '-y',
    ], { stdio: 'pipe' })
    if (r.status === 0) {
      paths.push(outPath)
    }
  }

  return paths
}
