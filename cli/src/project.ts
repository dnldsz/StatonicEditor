import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomBytes } from 'crypto'
import type { Project, Segment, Track, VideoSegment, TextSegment } from './types.js'

export function uid(): string {
  return randomBytes(4).toString('hex')
}

export function readProject(path: string): Project {
  if (!existsSync(path)) throw new Error(`Project file not found: ${path}`)
  return JSON.parse(readFileSync(path, 'utf-8')) as Project
}

export function saveProject(path: string, project: Project): void {
  writeFileSync(path, JSON.stringify(project, null, 2))
}

export function findSegment(project: Project, id: string): { seg: Segment; track: Track } | null {
  for (const track of project.tracks) {
    const seg = track.segments.find(s => s.id === id)
    if (seg) return { seg, track }
  }
  return null
}

export function summariseProject(project: Project): string {
  const lines: string[] = [
    `Project: "${project.name}"  canvas: ${project.canvas.width}×${project.canvas.height}`,
    '',
  ]
  for (const track of project.tracks) {
    lines.push(`Track [${track.id}] "${track.label}" (${track.type})`)
    for (const seg of track.segments) {
      const start = (seg.startUs / 1e6).toFixed(3)
      const dur = (seg.durationUs / 1e6).toFixed(3)
      if (seg.type === 'video') {
        const v = seg as VideoSegment
        lines.push(
          `  [${v.id}] VIDEO "${v.name}"  ${start}s → +${dur}s` +
          `  pos=(${v.clipX.toFixed(3)},${v.clipY.toFixed(3)})` +
          `  scale=${v.clipScale.toFixed(3)}` +
          `  crop=(L${v.cropLeft.toFixed(3)} R${v.cropRight.toFixed(3)} T${v.cropTop.toFixed(3)} B${v.cropBottom.toFixed(3)})` +
          `  src="${v.src}"`
        )
      } else if (seg.type === 'text') {
        const t = seg as TextSegment
        lines.push(
          `  [${t.id}] TEXT "${t.text}"  ${start}s → +${dur}s` +
          `  pos=(${t.x.toFixed(3)},${t.y.toFixed(3)})` +
          `  fontSize=${t.fontSize}  color=${t.color}` +
          `  bold=${t.bold}  italic=${t.italic}`
        )
      } else {
        lines.push(
          `  [${seg.id}] AUDIO "${(seg as any).name}"  ${start}s → +${dur}s`
        )
      }
    }
  }
  return lines.join('\n')
}
