import { spawnSync } from 'child_process'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { getVideoInfo } from './ffmpeg.js'
import type { SceneData, SceneInfo } from './types.js'

/**
 * Detect scene changes in a video using FFmpeg's scene change detection.
 * Returns timestamps where scene changes occur (score > threshold).
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
  // Format: [Parsed_showinfo_1 ...] n:   3 pts:  12288 pts_time:4.2    ...
  const cutTimes: number[] = []
  for (const line of stderr.split('\n')) {
    const match = line.match(/pts_time:\s*([\d.]+)/)
    if (match) {
      cutTimes.push(parseFloat(match[1]))
    }
  }

  // Build scenes from cut points
  const boundaries = [0, ...cutTimes, totalDuration]
  const scenes: SceneInfo[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = Math.round(boundaries[i] * 1000) / 1000
    const end = Math.round(boundaries[i + 1] * 1000) / 1000
    const duration = Math.round((end - start) * 1000) / 1000
    if (duration > 0.05) { // skip tiny artifacts
      scenes.push({ start, end, duration })
    }
  }

  const totalScenes = scenes.length
  const avgSceneDuration = totalScenes > 0 ? totalDuration / totalScenes : totalDuration

  const hookDuration = scenes.length > 0 ? scenes[0].duration : totalDuration
  const bodyScenes = scenes.slice(1)
  const bodyAvgDuration = bodyScenes.length > 0
    ? bodyScenes.reduce((s, sc) => s + sc.duration, 0) / bodyScenes.length
    : 0
  const cutsPerSecond = totalDuration > 0 ? (totalScenes - 1) / totalDuration : 0

  return {
    scenes,
    total_scenes: totalScenes,
    total_duration: Math.round(totalDuration * 1000) / 1000,
    avg_scene_duration: Math.round(avgSceneDuration * 1000) / 1000,
    hook_duration: Math.round(hookDuration * 1000) / 1000,
    body_avg_duration: Math.round(bodyAvgDuration * 1000) / 1000,
    cuts_per_second: Math.round(cutsPerSecond * 1000) / 1000,
  }
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
