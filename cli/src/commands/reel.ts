import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import { spawnSync } from 'child_process'
import { getReelsDir } from '../config.js'
import { getVideoInfo } from '../ffmpeg.js'
import { detectScenes, extractSceneKeyframes } from '../scene-detect.js'
import type { ReelMetadata, SceneData, ReelIndexEntry } from '../types.js'

function getReelDir(id: string): string {
  return join(getReelsDir(), id)
}

function loadIndex(): ReelIndexEntry[] {
  const indexPath = join(getReelsDir(), 'index.json')
  if (!existsSync(indexPath)) return []
  return JSON.parse(readFileSync(indexPath, 'utf-8'))
}

function saveIndex(entries: ReelIndexEntry[]): void {
  const dir = getReelsDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.json'), JSON.stringify(entries, null, 2))
}

function extractReelId(url: string): string {
  // Instagram: /reel/XXXXX/ or /reels/XXXXX/
  const match = url.match(/\/reels?\/([A-Za-z0-9_-]+)/)
  if (match) return match[1]
  // TikTok: /video/XXXXX
  const tikMatch = url.match(/\/video\/(\d+)/)
  if (tikMatch) return tikMatch[1]
  // Fallback: hash of URL
  const { createHash } = require('crypto')
  return createHash('md5').update(url).digest('hex').slice(0, 12)
}

// ── Download ────────────────────────────────────────────────────────────────

export function cmdReelDownload(args: string[]): void {
  const url = args[0]
  if (!url) {
    console.error('Usage: statonic reel download <url> [--views <n>] [--company <name>] [--date <YYYY-MM-DD>]')
    process.exit(1)
  }

  let views = 0
  let company = ''
  let date = ''
  for (let i = 1; i < args.length; i++) {
    if ((args[i] === '--views' || args[i] === '--tag') && args[i + 1]) views = parseInt(args[++i])
    if (args[i] === '--company' && args[i + 1]) company = args[++i]
    if (args[i] === '--date' && args[i + 1]) date = args[++i]
  }

  const id = extractReelId(url)
  const reelDir = getReelDir(id)
  mkdirSync(reelDir, { recursive: true })

  const videoPath = join(reelDir, 'video.mp4')

  if (existsSync(videoPath)) {
    console.log(`Already downloaded: ${id}`)
  } else {
    console.log(`Downloading ${url} ...`)
    const r = spawnSync('yt-dlp', [
      '-o', videoPath,
      '--merge-output-format', 'mp4',
      url,
    ], { stdio: 'inherit' })
    if (r.status !== 0) {
      console.error('yt-dlp failed')
      process.exit(1)
    }
  }

  // Get video info
  const info = getVideoInfo(videoPath)

  const metadata: ReelMetadata = {
    id,
    url,
    views,
    date: date || new Date().toISOString().slice(0, 10),
    company,
    duration: Math.round(info.durationSec * 1000) / 1000,
    width: info.width,
    height: info.height,
  }
  writeFileSync(join(reelDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

  // Update index
  const index = loadIndex()
  const existing = index.findIndex(e => e.id === id)
  const entry: ReelIndexEntry = { id, url, views, company, detected: false }
  if (existing >= 0) {
    entry.detected = index[existing].detected
    index[existing] = entry
  } else {
    index.push(entry)
  }
  saveIndex(index)

  console.log(`Saved: ${id} (${info.width}x${info.height}, ${metadata.duration}s, ${views.toLocaleString()} views)`)
}

// ── Detect ──────────────────────────────────────────────────────────────────

export function cmdReelDetect(args: string[]): void {
  const target = args[0]
  if (!target) {
    console.error('Usage: statonic reel detect <id-or-path> [--threshold <0.3>]')
    process.exit(1)
  }

  let threshold = 0.3
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--threshold' && args[i + 1]) threshold = parseFloat(args[++i])
  }

  // Resolve to video path and reel dir
  let videoPath: string
  let reelDir: string

  if (existsSync(join(getReelsDir(), target, 'video.mp4'))) {
    reelDir = getReelDir(target)
    videoPath = join(reelDir, 'video.mp4')
  } else if (existsSync(target)) {
    videoPath = target
    reelDir = join(getReelsDir(), '_standalone')
    mkdirSync(reelDir, { recursive: true })
  } else {
    console.error(`Not found: ${target}`)
    process.exit(1)
  }

  console.log(`Detecting scenes (threshold=${threshold})...`)
  const sceneData = detectScenes(videoPath, threshold)

  writeFileSync(join(reelDir, 'scenes.json'), JSON.stringify(sceneData, null, 2))

  // Extract keyframes
  const kfDir = join(reelDir, 'keyframes')
  console.log(`Extracting ${sceneData.scenes.length} keyframes...`)
  extractSceneKeyframes(videoPath, sceneData.scenes, kfDir)

  // Update index
  const id = target.includes('/') ? '_standalone' : target
  const index = loadIndex()
  const entry = index.find(e => e.id === id)
  if (entry) {
    entry.detected = true
    saveIndex(index)
  }

  console.log(`\nScenes: ${sceneData.total_scenes}`)
  console.log(`Duration: ${sceneData.total_duration}s`)
  console.log(`Hook: ${sceneData.hook_duration}s`)
  console.log(`Avg scene: ${sceneData.avg_scene_duration}s`)
  console.log(`Cuts/sec: ${sceneData.cuts_per_second}`)

  for (let i = 0; i < sceneData.scenes.length; i++) {
    const s = sceneData.scenes[i]
    const label = i === 0 ? ' (hook)' : ''
    console.log(`  [${i}] ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s  (${s.duration.toFixed(2)}s)${label}`)
  }
}

// ── Batch ───────────────────────────────────────────────────────────────────

export function cmdReelBatch(args: string[]): void {
  const filePath = args[0]
  if (!filePath) {
    console.error('Usage: statonic reel batch <csv-or-xlsx> [--limit <n>] [--min-views <n>] [--company <name>]')
    process.exit(1)
  }

  let limit = Infinity
  let minViews = 0
  let filterCompany = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i])
    if (args[i] === '--min-views' && args[i + 1]) minViews = parseInt(args[++i])
    if (args[i] === '--company' && args[i + 1]) filterCompany = args[++i].toLowerCase()
  }

  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  const ext = extname(filePath).toLowerCase()
  let rows: Array<{ url: string; views: number; company: string; date: string }>

  if (ext === '.csv') {
    rows = parseCsv(filePath)
  } else if (ext === '.xlsx' || ext === '.xls') {
    rows = parseXlsx(filePath)
  } else {
    console.error('Supported formats: .csv, .xlsx')
    process.exit(1)
  }

  // Filter
  if (filterCompany) rows = rows.filter(r => r.company.toLowerCase().includes(filterCompany))
  if (minViews > 0) rows = rows.filter(r => r.views >= minViews)

  // Sort by views desc
  rows.sort((a, b) => b.views - a.views)

  if (limit < rows.length) rows = rows.slice(0, limit)

  console.log(`Processing ${rows.length} reels...`)

  let processed = 0
  let failed = 0
  for (const row of rows) {
    try {
      console.log(`\n[${processed + 1}/${rows.length}] ${row.url} (${row.views.toLocaleString()} views)`)

      // Download
      const id = extractReelId(row.url)
      const reelDir = getReelDir(id)
      mkdirSync(reelDir, { recursive: true })
      const videoPath = join(reelDir, 'video.mp4')

      if (!existsSync(videoPath)) {
        const r = spawnSync('yt-dlp', [
          '-o', videoPath,
          '--merge-output-format', 'mp4',
          row.url,
        ], { stdio: 'inherit', timeout: 60_000 })
        if (r.status !== 0) {
          console.error(`  Failed to download`)
          failed++
          continue
        }
      }

      // Get info + metadata
      const info = getVideoInfo(videoPath)
      const metadata: ReelMetadata = {
        id,
        url: row.url,
        views: row.views,
        date: row.date || new Date().toISOString().slice(0, 10),
        company: row.company,
        duration: Math.round(info.durationSec * 1000) / 1000,
        width: info.width,
        height: info.height,
      }
      writeFileSync(join(reelDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

      // Scene detection
      const sceneData = detectScenes(videoPath)
      writeFileSync(join(reelDir, 'scenes.json'), JSON.stringify(sceneData, null, 2))

      // Keyframes
      extractSceneKeyframes(videoPath, sceneData.scenes, join(reelDir, 'keyframes'))

      // Update index
      const index = loadIndex()
      const existing = index.findIndex(e => e.id === id)
      const entry: ReelIndexEntry = { id, url: row.url, views: row.views, company: row.company, detected: true }
      if (existing >= 0) index[existing] = entry
      else index.push(entry)
      saveIndex(index)

      console.log(`  ${sceneData.total_scenes} scenes, ${metadata.duration}s, hook=${sceneData.hook_duration}s`)
      processed++
    } catch (e: any) {
      console.error(`  Error: ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone: ${processed} processed, ${failed} failed`)
}

function parseCsv(filePath: string): Array<{ url: string; views: number; company: string; date: string }> {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.trim().split('\n')
  if (lines.length < 2) return []

  const header = lines[0].toLowerCase().split(',').map(h => h.trim())
  const urlIdx = header.findIndex(h => h.includes('url') || h.includes('link'))
  const viewsIdx = header.findIndex(h => h.includes('view'))
  const companyIdx = header.findIndex(h => h.includes('company') || h.includes('brand') || h.includes('account'))
  const dateIdx = header.findIndex(h => h.includes('date'))

  if (urlIdx < 0) {
    console.error('CSV must have a column with "url" or "link" in the header')
    process.exit(1)
  }

  const rows: Array<{ url: string; views: number; company: string; date: string }> = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    const url = cols[urlIdx]
    if (!url || !url.startsWith('http')) continue
    rows.push({
      url,
      views: viewsIdx >= 0 ? parseViewCount(cols[viewsIdx]) : 0,
      company: companyIdx >= 0 ? cols[companyIdx] : '',
      date: dateIdx >= 0 ? cols[dateIdx] : '',
    })
  }
  return rows
}

function parseXlsx(filePath: string): Array<{ url: string; views: number; company: string; date: string }> {
  // Use a simple xlsx parser via Python (no npm dependency needed)
  const script = `
import json, sys
try:
    import openpyxl
except ImportError:
    print("NEED_INSTALL")
    sys.exit(0)

wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb.active
rows = []
for row in ws.iter_rows(values_only=True):
    rows.append([str(c) if c is not None else '' for c in row])
print(json.dumps(rows))
`
  const r = spawnSync('python3', ['-c', script, filePath], { encoding: 'utf-8' })
  if (r.stdout?.trim() === 'NEED_INSTALL') {
    console.error('Install openpyxl: pip3 install openpyxl')
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(`Failed to parse xlsx: ${r.stderr}`)
    process.exit(1)
  }

  const data: string[][] = JSON.parse(r.stdout)
  if (data.length < 2) return []

  const header = data[0].map(h => h.toLowerCase())
  const urlIdx = header.findIndex(h => h.includes('url') || h.includes('link'))
  const viewsIdx = header.findIndex(h => h.includes('view'))
  const companyIdx = header.findIndex(h => h.includes('company') || h.includes('brand') || h.includes('account'))
  const dateIdx = header.findIndex(h => h.includes('date'))

  if (urlIdx < 0) {
    console.error('Spreadsheet must have a column with "url" or "link" in the header')
    process.exit(1)
  }

  const rows: Array<{ url: string; views: number; company: string; date: string }> = []
  for (let i = 1; i < data.length; i++) {
    const cols = data[i]
    const url = cols[urlIdx]
    if (!url || !url.startsWith('http')) continue
    rows.push({
      url,
      views: viewsIdx >= 0 ? parseViewCount(cols[viewsIdx]) : 0,
      company: companyIdx >= 0 ? cols[companyIdx] : '',
      date: dateIdx >= 0 ? cols[dateIdx] : '',
    })
  }
  return rows
}

function parseViewCount(s: string): number {
  if (!s) return 0
  // Handle "7M", "500K", "1.2M" etc.
  const cleaned = s.replace(/[,\s]/g, '').toLowerCase()
  const mMatch = cleaned.match(/^([\d.]+)m$/)
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000)
  const kMatch = cleaned.match(/^([\d.]+)k$/)
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000)
  return parseInt(cleaned) || 0
}

// ── Inspect ─────────────────────────────────────────────────────────────────

export function cmdReelInspect(args: string[]): void {
  const id = args[0]
  if (!id) {
    console.error('Usage: statonic reel inspect <id>')
    process.exit(1)
  }

  const reelDir = getReelDir(id)
  if (!existsSync(reelDir)) {
    console.error(`Reel not found: ${id}`)
    process.exit(1)
  }

  const metaPath = join(reelDir, 'metadata.json')
  const scenesPath = join(reelDir, 'scenes.json')

  if (existsSync(metaPath)) {
    const meta: ReelMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'))
    console.log(`Reel: ${meta.id}`)
    console.log(`URL: ${meta.url}`)
    console.log(`Views: ${meta.views.toLocaleString()}`)
    console.log(`Company: ${meta.company || '(none)'}`)
    console.log(`Date: ${meta.date}`)
    console.log(`Duration: ${meta.duration}s`)
    console.log(`Resolution: ${meta.width}x${meta.height}`)
  }

  if (existsSync(scenesPath)) {
    const data: SceneData = JSON.parse(readFileSync(scenesPath, 'utf-8'))
    console.log(`\nScenes: ${data.total_scenes}`)
    console.log(`Hook: ${data.hook_duration}s`)
    console.log(`Body avg: ${data.body_avg_duration}s`)
    console.log(`Cuts/sec: ${data.cuts_per_second}`)
    console.log('')
    for (let i = 0; i < data.scenes.length; i++) {
      const s = data.scenes[i]
      const label = i === 0 ? ' (hook)' : ''
      console.log(`  [${i}] ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s  (${s.duration.toFixed(2)}s)${label}`)
    }

    // Show keyframe paths
    const kfDir = join(reelDir, 'keyframes')
    if (existsSync(kfDir)) {
      const kfs = readdirSync(kfDir).filter(f => f.endsWith('.jpg')).sort()
      if (kfs.length > 0) {
        console.log(`\nKeyframes: ${kfDir}/`)
        for (const kf of kfs) console.log(`  ${kf}`)
      }
    }
  } else {
    console.log('\nNo scene detection yet. Run: statonic reel detect ' + id)
  }
}

// ── Insights ────────────────────────────────────────────────────────────────

export function cmdReelInsights(args: string[]): void {
  const reelsDir = getReelsDir()
  if (!existsSync(reelsDir)) {
    console.error('No reels data. Run: statonic reel download <url>')
    process.exit(1)
  }

  // Collect all reels with scenes
  const entries = readdirSync(reelsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  interface ReelRecord {
    id: string; views: number; company: string
    duration: number; scenes: SceneData
  }
  const reels: ReelRecord[] = []

  for (const id of entries) {
    const metaPath = join(reelsDir, id, 'metadata.json')
    const scenesPath = join(reelsDir, id, 'scenes.json')
    if (!existsSync(metaPath) || !existsSync(scenesPath)) continue
    const meta: ReelMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'))
    const scenes: SceneData = JSON.parse(readFileSync(scenesPath, 'utf-8'))
    reels.push({ id, views: meta.views, company: meta.company, duration: meta.duration, scenes })
  }

  if (reels.length === 0) {
    console.error('No analyzed reels. Run: statonic reel detect <id>')
    process.exit(1)
  }

  console.log(`\n=== Reel Insights (${reels.length} reels) ===\n`)

  // Tier breakdown
  const tiers = [
    { label: '1M+ views', filter: (r: ReelRecord) => r.views >= 1_000_000 },
    { label: '100K–1M', filter: (r: ReelRecord) => r.views >= 100_000 && r.views < 1_000_000 },
    { label: '50K–100K', filter: (r: ReelRecord) => r.views >= 50_000 && r.views < 100_000 },
    { label: '<50K views', filter: (r: ReelRecord) => r.views < 50_000 },
  ]

  for (const tier of tiers) {
    const group = reels.filter(tier.filter)
    if (group.length === 0) continue

    const avgHook = avg(group.map(r => r.scenes.hook_duration))
    const avgScenes = avg(group.map(r => r.scenes.total_scenes))
    const avgDuration = avg(group.map(r => r.duration))
    const avgBodyDur = avg(group.map(r => r.scenes.body_avg_duration))
    const avgCuts = avg(group.map(r => r.scenes.cuts_per_second))

    console.log(`${tier.label} (n=${group.length}):`)
    console.log(`  Avg duration:     ${avgDuration.toFixed(1)}s`)
    console.log(`  Avg hook:         ${avgHook.toFixed(2)}s`)
    console.log(`  Avg scenes:       ${avgScenes.toFixed(1)}`)
    console.log(`  Avg body clip:    ${avgBodyDur.toFixed(2)}s`)
    console.log(`  Avg cuts/sec:     ${avgCuts.toFixed(2)}`)
    console.log('')
  }

  // Correlations
  if (reels.length >= 5) {
    console.log('Correlations with views:')
    const views = reels.map(r => r.views)
    const hookDurs = reels.map(r => r.scenes.hook_duration)
    const sceneCounts = reels.map(r => r.scenes.total_scenes)
    const durations = reels.map(r => r.duration)
    const cuts = reels.map(r => r.scenes.cuts_per_second)

    console.log(`  Hook duration:    r=${correlation(views, hookDurs).toFixed(3)}`)
    console.log(`  Scene count:      r=${correlation(views, sceneCounts).toFixed(3)}`)
    console.log(`  Total duration:   r=${correlation(views, durations).toFixed(3)}`)
    console.log(`  Cuts/sec:         r=${correlation(views, cuts).toFixed(3)}`)
    console.log('')
  }

  // Structure patterns
  console.log('Common structures:')
  const structures = new Map<string, { count: number; totalViews: number }>()
  for (const r of reels) {
    const sceneCount = r.scenes.total_scenes
    const hookLen = r.scenes.hook_duration < 2 ? 'short' : r.scenes.hook_duration < 4 ? 'medium' : 'long'
    const key = `${hookLen}-hook + ${sceneCount - 1} body clips`
    const existing = structures.get(key) || { count: 0, totalViews: 0 }
    existing.count++
    existing.totalViews += r.views
    structures.set(key, existing)
  }

  const sorted = [...structures.entries()].sort((a, b) => b[1].count - a[1].count)
  for (const [pattern, data] of sorted.slice(0, 10)) {
    const avgViews = Math.round(data.totalViews / data.count)
    console.log(`  ${pattern}  (n=${data.count}, avg views=${avgViews.toLocaleString()})`)
  }

  // Write insights.json
  const insights = {
    total_reels: reels.length,
    generated: new Date().toISOString(),
    tiers: tiers.map(tier => {
      const group = reels.filter(tier.filter)
      if (group.length === 0) return { label: tier.label, count: 0 }
      return {
        label: tier.label,
        count: group.length,
        avg_duration: round(avg(group.map(r => r.duration))),
        avg_hook: round(avg(group.map(r => r.scenes.hook_duration))),
        avg_scenes: round(avg(group.map(r => r.scenes.total_scenes))),
        avg_body_clip: round(avg(group.map(r => r.scenes.body_avg_duration))),
        avg_cuts_per_sec: round(avg(group.map(r => r.scenes.cuts_per_second))),
      }
    }),
  }
  writeFileSync(join(reelsDir, 'insights.json'), JSON.stringify(insights, null, 2))
  console.log(`\nWritten: ${join(reelsDir, 'insights.json')}`)
}

// ── Top ─────────────────────────────────────────────────────────────────────

export function cmdReelTop(args: string[]): void {
  const reelsDir = getReelsDir()
  if (!existsSync(reelsDir)) {
    console.error('No reels data.')
    process.exit(1)
  }

  let minViews = 100_000
  let showLimit = 20
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--min-views' && args[i + 1]) minViews = parseInt(args[++i])
    if (args[i] === '--limit' && args[i + 1]) showLimit = parseInt(args[++i])
  }

  const entries = readdirSync(reelsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  interface Row { id: string; views: number; company: string; duration: number; scenes: number; hook: number; cutsPerSec: number }
  const rows: Row[] = []

  for (const id of entries) {
    const metaPath = join(reelsDir, id, 'metadata.json')
    const scenesPath = join(reelsDir, id, 'scenes.json')
    if (!existsSync(metaPath)) continue
    const meta: ReelMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'))
    if (meta.views < minViews) continue

    let scenes = 0, hook = 0, cutsPerSec = 0
    if (existsSync(scenesPath)) {
      const data: SceneData = JSON.parse(readFileSync(scenesPath, 'utf-8'))
      scenes = data.total_scenes
      hook = data.hook_duration
      cutsPerSec = data.cuts_per_second
    }

    rows.push({ id, views: meta.views, company: meta.company, duration: meta.duration, scenes, hook, cutsPerSec })
  }

  rows.sort((a, b) => b.views - a.views)

  if (rows.length === 0) {
    console.log(`No reels with ${minViews.toLocaleString()}+ views`)
    return
  }

  console.log(`Top reels (${minViews.toLocaleString()}+ views):\n`)
  console.log(pad('ID', 16) + pad('Views', 12) + pad('Dur', 8) + pad('Scenes', 8) + pad('Hook', 8) + pad('Cuts/s', 8) + 'Company')
  console.log('─'.repeat(76))

  for (const r of rows.slice(0, showLimit)) {
    const viewStr = r.views >= 1_000_000 ? `${(r.views / 1_000_000).toFixed(1)}M` : `${Math.round(r.views / 1000)}K`
    console.log(
      pad(r.id.slice(0, 14), 16) +
      pad(viewStr, 12) +
      pad(`${r.duration.toFixed(1)}s`, 8) +
      pad(String(r.scenes), 8) +
      pad(`${r.hook.toFixed(1)}s`, 8) +
      pad(r.cutsPerSec.toFixed(2), 8) +
      r.company
    )
  }

  if (rows.length > showLimit) console.log(`\n... and ${rows.length - showLimit} more`)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function round(n: number, places = 2): number {
  const f = Math.pow(10, places)
  return Math.round(n * f) / f
}

function correlation(x: number[], y: number[]): number {
  const n = x.length
  if (n < 3) return 0
  const mx = avg(x), my = avg(y)
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my)
    dx += (x[i] - mx) ** 2
    dy += (y[i] - my) ** 2
  }
  const denom = Math.sqrt(dx * dy)
  return denom === 0 ? 0 : num / denom
}

function pad(s: string, w: number): string {
  return s.padEnd(w)
}
