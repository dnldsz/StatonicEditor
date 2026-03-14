import { readProject } from '../project.js'
import { renderPreview, extractFrame, extractKeyframes, getVideoInfo } from '../ffmpeg.js'

export function cmdPreview(args: string[]): void {
  const projectPath = args[0]
  if (!projectPath) { console.error('Usage: statonic preview <project> [--time <sec>] [--output <path>]'); process.exit(1) }

  let timeSec: number | undefined
  let outputPath: string | undefined

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--time' && args[i + 1]) timeSec = parseFloat(args[++i])
    if (args[i] === '--output' && args[i + 1]) outputPath = args[++i]
  }

  const project = readProject(projectPath)
  const result = renderPreview(project, timeSec, outputPath)
  console.log(result)
}

export function cmdFrames(args: string[]): void {
  const videoPath = args[0]
  if (!videoPath) { console.error('Usage: statonic frames <video-path> --times 1,2.5,4 [--output-dir ./]'); process.exit(1) }

  let times: number[] = []
  let outputDir = ''

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--times' && args[i + 1]) {
      times = args[++i].split(',').map(Number)
    }
    if (args[i] === '--output-dir' && args[i + 1]) outputDir = args[++i]
  }

  if (times.length === 0) {
    // Default: extract 4 keyframes
    const result = extractKeyframes(videoPath, 4)
    for (let i = 0; i < result.paths.length; i++) {
      console.log(`${result.timestamps[i].toFixed(2)}s → ${result.paths[i]}`)
    }
    return
  }

  for (const t of times.slice(0, 6)) {
    const outPath = outputDir ? `${outputDir}/frame_${t.toFixed(2)}s.jpg` : undefined
    const result = extractFrame(videoPath, t, outPath)
    console.log(`${t.toFixed(2)}s → ${result}`)
  }
}

export function cmdVideoInfo(args: string[]): void {
  const videoPath = args[0]
  if (!videoPath) { console.error('Usage: statonic video-info <video-path>'); process.exit(1) }
  const info = getVideoInfo(videoPath)
  console.log(`Width: ${info.width}px`)
  console.log(`Height: ${info.height}px`)
  console.log(`Duration: ${info.durationSec.toFixed(3)}s`)
  if (info.rotation !== 0) console.log(`Rotation: ${info.rotation}°`)
}
