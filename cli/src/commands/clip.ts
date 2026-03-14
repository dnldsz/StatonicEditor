import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'fs'
import { join, extname, basename } from 'path'
import { getClipLibraryDir, getActiveAccountId, getDataDir } from '../config.js'
import { getVideoInfo, extractKeyframes } from '../ffmpeg.js'
import { uid } from '../project.js'
import type { ClipMetadata, ClipIndex, LibraryClipMeta } from '../types.js'

export function cmdClipAnalyze(args: string[]): void {
  const videoPath = args[0]
  if (!videoPath) { console.error('Usage: statonic clip analyze <video-path> [--metadata <json>] [--keyframes <count>]'); process.exit(1) }

  let metadataJson = ''
  let keyframeCount = 4

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--metadata' && args[i + 1]) metadataJson = args[++i]
    if (args[i] === '--keyframes' && args[i + 1]) keyframeCount = parseInt(args[++i])
  }

  const info = getVideoInfo(videoPath)

  if (metadataJson) {
    const metadata = JSON.parse(metadataJson)
    const full: ClipMetadata = {
      id: uid(),
      path: videoPath,
      name: basename(videoPath, extname(videoPath)),
      category: metadata.category ?? 'general',
      duration: info.durationSec,
      width: info.width,
      height: info.height,
      description: metadata.description ?? '',
      tags: metadata.tags ?? [],
      mood: metadata.mood ?? 'neutral',
      subject_visible: metadata.subject_visible ?? false,
      subject_position: metadata.subject_position ?? 'unknown',
      setting: metadata.setting ?? 'unknown',
      keyframe_timestamps: metadata.keyframe_timestamps ?? [],
      added: new Date().toISOString(),
      analyzed_by: 'claude-code',
    }

    const metadataPath = videoPath.replace(extname(videoPath), '.json')
    writeFileSync(metadataPath, JSON.stringify(full, null, 2))
    console.log(`Saved metadata: ${metadataPath}`)
    return
  }

  // Extract keyframes for analysis
  const { timestamps, paths } = extractKeyframes(videoPath, keyframeCount)
  console.log(`Video: ${basename(videoPath)}`)
  console.log(`Duration: ${info.durationSec.toFixed(1)}s | Size: ${info.width}×${info.height}`)
  console.log(`\nExtracted ${paths.length} keyframes:`)
  for (let i = 0; i < paths.length; i++) {
    console.log(`  ${timestamps[i].toFixed(1)}s → ${paths[i]}`)
  }
  console.log(`\nAnalyze these frames, then call:`)
  console.log(`statonic clip analyze "${videoPath}" --metadata '<json>'`)
}

export function cmdClipIndex(args: string[]): void {
  let folderPath = args[0]
  let regenerate = args.includes('--regenerate')

  if (!folderPath) {
    // Default: index the active account's clip library
    const accountId = getActiveAccountId()
    folderPath = getClipLibraryDir(accountId)
  }

  if (!existsSync(folderPath)) {
    console.error(`Folder not found: ${folderPath}`)
    process.exit(1)
  }

  const videoExts = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']
  const clips: ClipMetadata[] = []
  const categories = new Set<string>()

  function scanFolder(dir: string, relativeCategory = ''): void {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        scanFolder(fullPath, relativeCategory ? `${relativeCategory}/${entry}` : entry)
      } else if (videoExts.includes(extname(entry).toLowerCase())) {
        const metadataPath = fullPath.replace(extname(fullPath), '.json')
        let metadata: ClipMetadata | null = null

        if (!regenerate && existsSync(metadataPath)) {
          try { metadata = JSON.parse(readFileSync(metadataPath, 'utf-8')) } catch {}
        }

        if (!metadata) {
          const info = getVideoInfo(fullPath)
          metadata = {
            id: uid(),
            path: fullPath,
            name: basename(fullPath, extname(fullPath)),
            category: relativeCategory || 'general',
            duration: info.durationSec,
            width: info.width,
            height: info.height,
            description: '(pending analysis)',
            tags: [],
            mood: 'unknown',
            subject_visible: false,
            subject_position: 'unknown',
            setting: 'unknown',
            keyframe_timestamps: [],
            added: new Date().toISOString(),
            analyzed_by: 'pending',
          }
          writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
        }

        clips.push(metadata)
        categories.add(metadata.category)
      }
    }
  }

  scanFolder(folderPath)

  const index: ClipIndex = { clips, categories: Array.from(categories), last_updated: new Date().toISOString() }
  const indexPath = join(folderPath, 'index.json')
  writeFileSync(indexPath, JSON.stringify(index, null, 2))

  console.log(`Indexed ${clips.length} clips across ${categories.size} categories`)
  console.log(`Categories: ${Array.from(categories).join(', ')}`)
  console.log(`Index: ${indexPath}`)
}

export function cmdClipSearch(args: string[]): void {
  const query = args[0]
  if (!query) { console.error('Usage: statonic clip search <query> [--category <cat>]'); process.exit(1) }

  let category = ''
  let accountId = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) category = args[++i]
    if (args[i] === '--account' && args[i + 1]) accountId = args[++i]
  }

  // Search in library
  if (!accountId) {
    try { accountId = getActiveAccountId() } catch { /* no account */ }
  }

  const dataDir = getDataDir()
  const accountsPath = join(dataDir, 'clip-library', 'accounts')
  if (!existsSync(accountsPath)) { console.log('No clip library found.'); return }

  const clips: LibraryClipMeta[] = []
  const accounts = accountId ? [accountId] : readdirSync(accountsPath)

  for (const accId of accounts) {
    const clipsPath = join(accountsPath, accId, 'clips')
    if (!existsSync(clipsPath)) continue

    const clipDirs = readdirSync(clipsPath)
    for (const clipId of clipDirs) {
      const clipDir = join(clipsPath, clipId)
      try {
        if (!statSync(clipDir).isDirectory()) continue
        const metaPath = join(clipDir, 'metadata.json')
        if (!existsSync(metaPath)) continue
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        if (!meta.analyzed) continue
        if (category && meta.category !== category) continue
        clips.push({
          id: meta.id ?? clipId,
          accountId: meta.accountId ?? accId,
          name: meta.name,
          path: meta.path,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          category: meta.category ?? 'uncategorized',
          analyzed: true,
          description: meta.description,
          tags: meta.tags,
          mood: meta.mood,
          subject_visible: meta.subject_visible,
          subject_position: meta.subject_position,
          setting: meta.setting,
        })
      } catch { /* skip */ }
    }
  }

  if (clips.length === 0) { console.log('No matching clips found.'); return }

  // Simple text search: score by keyword matches in description + tags + name
  const queryWords = query.toLowerCase().split(/\s+/)
  const scored = clips.map(c => {
    const searchText = `${c.name} ${c.description ?? ''} ${(c.tags ?? []).join(' ')} ${c.mood ?? ''} ${c.setting ?? ''}`.toLowerCase()
    const score = queryWords.reduce((s, w) => s + (searchText.includes(w) ? 1 : 0), 0)
    return { clip: c, score }
  }).sort((a, b) => b.score - a.score)

  for (const { clip: c, score } of scored) {
    console.log(`[${c.category}] ${c.name} (${c.accountId}) — score: ${score}`)
    console.log(`  ${c.description}`)
    console.log(`  Tags: ${(c.tags ?? []).join(', ')}`)
    console.log(`  Duration: ${c.duration.toFixed(1)}s | Size: ${c.width}×${c.height}`)
    console.log(`  Path: ${c.path}`)
    console.log()
  }
}

export function cmdClipList(args: string[]): void {
  let category = ''
  let accountId = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) category = args[++i]
    if (args[i] === '--account' && args[i + 1]) accountId = args[++i]
  }

  if (!accountId) accountId = getActiveAccountId()

  const clipsPath = getClipLibraryDir(accountId)
  if (!existsSync(clipsPath)) { console.log('No clips found.'); return }

  const clipDirs = readdirSync(clipsPath)
  let count = 0
  for (const clipId of clipDirs) {
    const clipDir = join(clipsPath, clipId)
    try {
      if (!statSync(clipDir).isDirectory()) continue
      const metaPath = join(clipDir, 'metadata.json')
      if (!existsSync(metaPath)) continue
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      if (category && meta.category !== category) continue

      count++
      console.log(`${meta.name} [${meta.category}] ${meta.analyzed ? '✓' : '○'}`)
      console.log(`  ID: ${meta.id ?? clipId}`)
      console.log(`  Duration: ${meta.duration?.toFixed(1)}s | ${meta.width}×${meta.height}`)
      console.log(`  Path: ${meta.path}`)
      if (meta.description && meta.description !== '(pending analysis)') {
        console.log(`  Description: ${meta.description}`)
      }
      console.log()
    } catch { /* skip */ }
  }
  console.log(`Total: ${count} clip(s)`)
}
