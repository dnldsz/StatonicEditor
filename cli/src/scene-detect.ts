import { spawnSync } from 'child_process'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { getVideoInfo } from './ffmpeg.js'
import type { SceneData, SceneInfo } from './types.js'

/**
 * Detect visual cuts in a video using FFmpeg's scene change detection.
 * Returns raw cuts only — logical scene merging is done by Claude analysis.
 */
export function detectScenes(videoPath: string, threshold = 0.3): SceneData {
  const info = getVideoInfo(videoPath)
  const totalDuration = info.durationSec

  const r = spawnSync('ffmpeg', [
    '-i', videoPath,
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-vsync', 'vfr',
    '-f', 'null', '-',
  ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })

  const stderr = r.stderr ?? ''

  const cutTimes: number[] = []
  for (const line of stderr.split('\n')) {
    const match = line.match(/pts_time:\s*([\d.]+)/)
    if (match) {
      cutTimes.push(parseFloat(match[1]))
    }
  }

  const boundaries = [0, ...cutTimes, totalDuration]
  const cuts: SceneInfo[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = Math.round(boundaries[i] * 1000) / 1000
    const end = Math.round(boundaries[i + 1] * 1000) / 1000
    const duration = Math.round((end - start) * 1000) / 1000
    if (duration > 0.05) {
      cuts.push({ start, end, duration })
    }
  }

  const totalCuts = cuts.length
  const avgCutDuration = totalCuts > 0 ? totalDuration / totalCuts : totalDuration
  const hookDuration = cuts.length > 0 ? cuts[0].duration : totalDuration
  const bodyCuts = cuts.slice(1)
  const bodyAvgDuration = bodyCuts.length > 0
    ? bodyCuts.reduce((s, sc) => s + sc.duration, 0) / bodyCuts.length
    : 0
  const cutsPerSecond = totalDuration > 0 ? (totalCuts - 1) / totalDuration : 0

  return {
    scenes: cuts,
    raw_cuts: cuts,
    total_scenes: totalCuts,
    total_cuts: totalCuts,
    total_duration: Math.round(totalDuration * 1000) / 1000,
    avg_scene_duration: Math.round(avgCutDuration * 1000) / 1000,
    hook_duration: Math.round(hookDuration * 1000) / 1000,
    body_avg_duration: Math.round(bodyAvgDuration * 1000) / 1000,
    cuts_per_second: Math.round(cutsPerSecond * 1000) / 1000,
  }
}

/**
 * Extract one keyframe per cut (at the midpoint).
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
