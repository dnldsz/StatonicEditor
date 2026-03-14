import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { getAudioLibraryDir } from '../config.js'

export function cmdAudioFind(args: string[]): void {
  let hookDuration = 0
  let totalDuration = 0
  let preferClosest = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hook-duration' && args[i + 1]) hookDuration = parseFloat(args[++i])
    if (args[i] === '--total-duration' && args[i + 1]) totalDuration = parseFloat(args[++i])
    if (args[i] === '--prefer-closest') preferClosest = true
  }

  if (!hookDuration || !totalDuration) {
    console.error('Usage: statonic audio find --hook-duration <sec> --total-duration <sec> [--prefer-closest]')
    process.exit(1)
  }

  const audioDir = getAudioLibraryDir()
  if (!existsSync(audioDir)) { console.log('No audio library found.'); return }

  const audios: any[] = []
  const dirs = readdirSync(audioDir)
  for (const audioId of dirs) {
    const dir = join(audioDir, audioId)
    try {
      if (!statSync(dir).isDirectory()) continue
      const metaPath = join(dir, 'metadata.json')
      if (!existsSync(metaPath)) continue
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      audios.push({
        id: meta.id,
        name: meta.name,
        path: meta.path,
        duration: meta.duration,
        dropTimeMs: meta.dropTimeMs ?? null,
      })
    } catch {}
  }

  const suitable = audios.filter(a => {
    if (a.dropTimeMs === null) return false
    const dropSec = a.dropTimeMs / 1000
    if (dropSec < hookDuration - 0.1) return false
    if (a.duration < totalDuration) return false
    return true
  })

  if (suitable.length === 0) {
    console.log(`No suitable audio found.`)
    console.log(`Requirements: drop > ${hookDuration}s, duration >= ${totalDuration}s`)
    console.log(`Available audios:`)
    for (const a of audios) {
      console.log(`  ${a.name}: drop=${a.dropTimeMs ? (a.dropTimeMs / 1000).toFixed(2) + 's' : 'N/A'}, dur=${a.duration.toFixed(2)}s`)
    }
    return
  }

  if (preferClosest) {
    suitable.sort((a: any, b: any) =>
      Math.abs(a.dropTimeMs / 1000 - hookDuration) - Math.abs(b.dropTimeMs / 1000 - hookDuration)
    )
  }

  const selected = suitable[0]
  const dropSec = selected.dropTimeMs / 1000
  const audioStartSec = hookDuration - dropSec
  const audioStartUs = Math.round(audioStartSec * 1e6)
  const sourceStartUs = audioStartUs < 0 ? Math.round(Math.abs(audioStartUs)) : 0

  console.log(`Audio: ${selected.name}`)
  console.log(`Drop: ${dropSec.toFixed(2)}s | Duration: ${selected.duration.toFixed(2)}s`)
  console.log(`Path: ${selected.path}`)
  console.log()
  console.log(`Audio segment JSON:`)
  console.log(JSON.stringify({
    id: 'audio-1',
    type: 'audio',
    src: selected.path,
    name: selected.name,
    startUs: audioStartUs,
    durationUs: Math.round(totalDuration * 1e6),
    sourceStartUs,
    sourceDurationUs: Math.round(totalDuration * 1e6),
    fileDurationUs: Math.round(selected.duration * 1e6),
    volume: 1.0,
    dropTimeUs: selected.dropTimeMs * 1000,
  }, null, 2))
  console.log(`\n(${suitable.length} suitable audio(s) available)`)
}
