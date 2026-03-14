import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getTemplatesDir, getActiveAccountId, getClipLibraryDir, getProjectsDir } from '../config.js'
import { uid, saveProject } from '../project.js'

export function cmdTemplateList(): void {
  const dir = getTemplatesDir()
  if (!existsSync(dir)) { console.log('No templates directory found.'); return }

  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) { console.log('No templates found.'); return }

  for (const f of files) {
    try {
      const t = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
      console.log(`${t.id} — ${t.name}`)
      if (t.description) console.log(`  ${t.description}`)
      console.log(`  ${t.slots?.length ?? 0} slots, ${t.total_duration_sec}s total`)
      console.log()
    } catch {
      console.log(`${f} (parse error)`)
    }
  }
}

export function cmdTemplateUse(args: string[]): void {
  const templateId = args[0]
  if (!templateId) { console.error('Usage: statonic template use <id> [--name "..."] [--slots <json>]'); process.exit(1) }

  let projectName = ''
  let slotsJson = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) projectName = args[++i]
    if (args[i] === '--slots' && args[i + 1]) slotsJson = args[++i]
  }

  const accountId = getActiveAccountId()
  const templatePath = join(getTemplatesDir(), `${templateId}.json`)
  if (!existsSync(templatePath)) { console.error(`Template "${templateId}" not found`); process.exit(1) }

  const template = JSON.parse(readFileSync(templatePath, 'utf-8'))
  const slotOverrides: Array<{ slot_id: string; clip_id?: string; text?: string }> = slotsJson ? JSON.parse(slotsJson) : []

  // Load clip library
  const clipLibDir = getClipLibraryDir(accountId)
  const clipsByCategory: Record<string, any[]> = {}
  if (existsSync(clipLibDir)) {
    const clipIds = readdirSync(clipLibDir)
    for (const clipId of clipIds) {
      const metaPath = join(clipLibDir, clipId, 'metadata.json')
      if (!existsSync(metaPath)) continue
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        const cat = meta.category || 'unknown'
        const files = readdirSync(join(clipLibDir, clipId)).filter((f: string) => /\.(mp4|mov|m4v)$/i.test(f))
        if (files.length === 0) continue
        if (!clipsByCategory[cat]) clipsByCategory[cat] = []
        clipsByCategory[cat].push({
          path: join(clipLibDir, clipId, files[0]),
          name: meta.name || files[0],
          durationUs: Math.round((meta.duration || 5) * 1e6),
          width: meta.width || 1080,
          height: meta.height || 1920,
        })
      } catch {}
    }
  }

  function pickClip(category: string): any | null {
    const pool = clipsByCategory[category] || []
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null
  }

  const videoTrack = { id: uid(), type: 'video' as const, label: 'VIDEO', segments: [] as any[] }
  const textTrack = { id: uid(), type: 'text' as const, label: 'TEXT', segments: [] as any[] }

  for (const slot of template.slots) {
    const override = slotOverrides.find(o => o.slot_id === slot.slot_id)
    const startUs = Math.round(slot.start_sec * 1e6)
    const durationUs = Math.round(slot.duration_sec * 1e6)

    let clip = override?.clip_id ? null : pickClip(slot.clip_category)
    if (override?.clip_id) {
      const clipDir = join(clipLibDir, override.clip_id)
      if (existsSync(clipDir)) {
        const files = readdirSync(clipDir).filter((f: string) => /\.(mp4|mov|m4v)$/i.test(f))
        if (files.length > 0) {
          const metaPath = join(clipDir, 'metadata.json')
          const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : {}
          clip = {
            path: join(clipDir, files[0]),
            name: meta.name || files[0],
            durationUs: Math.round((meta.duration || 5) * 1e6),
            width: meta.width || 1080,
            height: meta.height || 1920,
          }
        }
      }
    }

    if (clip) {
      videoTrack.segments.push({
        id: uid(), type: 'video',
        src: clip.path, name: clip.name,
        startUs, durationUs,
        sourceStartUs: 0, sourceDurationUs: durationUs, fileDurationUs: clip.durationUs,
        sourceWidth: clip.width, sourceHeight: clip.height,
        clipX: 0, clipY: 0, clipScale: 1,
        cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
      })
    }

    const text = override?.text ?? slot.text?.example ?? ''
    if (text) {
      textTrack.segments.push({
        id: uid(), type: 'text', text,
        startUs, durationUs,
        x: 0, y: slot.text?.y ?? 0.28,
        fontSize: slot.text?.fontSize ?? 85,
        color: '#ffffff', bold: false, italic: false,
        strokeEnabled: false, strokeColor: '#000000',
        textAlign: 'center', textScale: 1,
      })
    }
  }

  const finalName = projectName || `${template.name} - ${new Date().toLocaleDateString()}`
  const project = {
    name: finalName,
    accountId,
    canvas: { width: 1080, height: 1920 },
    tracks: [videoTrack, textTrack],
  }

  const projectsDir = getProjectsDir(accountId)
  mkdirSync(projectsDir, { recursive: true })
  const safeFilename = finalName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase()
  const projectPath = join(projectsDir, `${safeFilename}.json`)
  saveProject(projectPath, project)

  console.log(`Created from template "${templateId}": ${projectPath}`)
}
