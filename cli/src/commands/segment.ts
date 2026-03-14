import { readProject, saveProject, findSegment, uid } from '../project.js'
import type { TextSegment, Track } from '../types.js'

export function cmdSegmentUpdate(args: string[]): void {
  const projectPath = args[0]
  const segId = args[1]
  const patchJson = args[2]
  if (!projectPath || !segId || !patchJson) {
    console.error('Usage: statonic segment update <project> <id> <json-patch>')
    process.exit(1)
  }

  const project = readProject(projectPath)
  const found = findSegment(project, segId)
  if (!found) { console.error(`Segment "${segId}" not found`); process.exit(1) }

  const patch = JSON.parse(patchJson)
  Object.assign(found.seg, patch)
  saveProject(projectPath, project)
  console.log(`Updated segment ${segId}`)
}

export function cmdSegmentDelete(args: string[]): void {
  const projectPath = args[0]
  const segId = args[1]
  if (!projectPath || !segId) {
    console.error('Usage: statonic segment delete <project> <id>')
    process.exit(1)
  }

  const project = readProject(projectPath)
  let deleted = false
  for (const track of project.tracks) {
    const idx = track.segments.findIndex(s => s.id === segId)
    if (idx >= 0) {
      track.segments.splice(idx, 1)
      deleted = true
      break
    }
  }

  if (!deleted) { console.error(`Segment "${segId}" not found`); process.exit(1) }
  saveProject(projectPath, project)
  console.log(`Deleted segment ${segId}`)
}

export function cmdSegmentAddText(args: string[]): void {
  const projectPath = args.shift()
  if (!projectPath) {
    console.error('Usage: statonic segment add-text <project> --text "..." --start <sec> --duration <sec> [options]')
    process.exit(1)
  }

  // Parse flags
  const opts: Record<string, string> = {}
  while (args.length > 0) {
    const key = args.shift()!
    if (key.startsWith('--') && args.length > 0) {
      opts[key.slice(2)] = args.shift()!
    }
  }

  if (!opts.text || !opts.start || !opts.duration) {
    console.error('Required: --text, --start, --duration')
    process.exit(1)
  }

  const project = readProject(projectPath)

  const seg: TextSegment = {
    id: uid(),
    type: 'text',
    text: opts.text,
    startUs: Math.round(parseFloat(opts.start) * 1e6),
    durationUs: Math.round(parseFloat(opts.duration) * 1e6),
    x: parseFloat(opts.x ?? '0'),
    y: parseFloat(opts.y ?? '0'),
    fontSize: parseInt(opts['font-size'] ?? '80'),
    color: opts.color ?? '#ffffff',
    bold: opts.bold === 'true',
    italic: opts.italic === 'true',
    strokeEnabled: opts['stroke-enabled'] === 'true',
    strokeColor: opts['stroke-color'] ?? '#000000',
    textAlign: (opts['text-align'] as 'left' | 'center' | 'right') ?? 'center',
    textScale: 1,
  }

  // Find or create text track
  let textTrack = project.tracks.find(t => t.type === 'text')
  if (!textTrack) {
    textTrack = { id: uid(), type: 'text', label: 'TEXT', segments: [] }
    project.tracks.push(textTrack)
  }
  textTrack.segments.push(seg)

  saveProject(projectPath, project)
  console.log(`Added text segment ${seg.id}: "${seg.text}"`)
}

export function cmdSegmentAddZoom(args: string[]): void {
  const projectPath = args[0]
  const segId = args[1]
  if (!projectPath || !segId) {
    console.error('Usage: statonic segment add-zoom <project> <segment-id> --keyframes \'[{"time_sec":0,"scale":1}]\'')
    process.exit(1)
  }

  let kfJson = ''
  const kfIdx = args.indexOf('--keyframes')
  if (kfIdx >= 0 && args[kfIdx + 1]) kfJson = args[kfIdx + 1]
  if (!kfJson) { console.error('Required: --keyframes'); process.exit(1) }

  const project = readProject(projectPath)
  const found = findSegment(project, segId)
  if (!found) { console.error(`Segment "${segId}" not found`); process.exit(1) }
  if (found.seg.type !== 'video') { console.error('Segment must be a video segment'); process.exit(1) }

  const keyframes = JSON.parse(kfJson) as Array<{ time_sec: number; scale: number }>
  const videoSeg = found.seg as any
  videoSeg.scaleKeyframes = keyframes.map(kf => ({
    timeMs: Math.round(kf.time_sec * 1000),
    scale: kf.scale,
  }))

  saveProject(projectPath, project)
  const desc = keyframes.map(kf => `${kf.time_sec}s: ${kf.scale}x`).join(', ')
  console.log(`Added zoom keyframes to ${segId}: ${desc}`)
}
