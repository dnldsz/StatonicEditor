import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { readProject, saveProject } from '../project.js'

export function cmdVariationCreate(args: string[]): void {
  const projectPath = args[0]
  if (!projectPath) {
    console.error('Usage: statonic variation create <project-path> --variations <json>')
    console.error('  json: [{"name":"V1","textChanges":[{"find":"X","replace":"Y"}],"clipOverrides":[{"segmentId":"id","clipPath":"/path"}]}]')
    process.exit(1)
  }

  let variationsJson = ''
  let outputDir = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--variations' && args[i + 1]) variationsJson = args[++i]
    if (args[i] === '--output-dir' && args[i + 1]) outputDir = args[++i]
  }

  if (!variationsJson) { console.error('Required: --variations <json>'); process.exit(1) }

  const baseProject = readProject(projectPath)
  const variations = JSON.parse(variationsJson) as Array<{
    name: string
    textChanges?: Array<{ find: string; replace: string }>
    clipOverrides?: Array<{ segmentId: string; clipPath: string; clipName?: string }>
  }>

  if (!outputDir) {
    outputDir = join(dirname(projectPath), baseProject.name.replace(/[/\\?%*:|"<>]/g, '-'))
  }
  mkdirSync(outputDir, { recursive: true })

  const written: string[] = []
  const errors: string[] = []

  for (const variation of variations) {
    try {
      const varProject = JSON.parse(JSON.stringify(baseProject))
      varProject.name = variation.name

      if (variation.textChanges?.length) {
        for (const track of varProject.tracks ?? []) {
          for (const seg of track.segments ?? []) {
            if (seg.type !== 'text' || !seg.text) continue
            for (const change of variation.textChanges) {
              const regex = new RegExp(change.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
              seg.text = seg.text.replace(regex, change.replace)
            }
          }
        }
      }

      if (variation.clipOverrides?.length) {
        for (const override of variation.clipOverrides) {
          for (const track of varProject.tracks ?? []) {
            const seg = (track.segments ?? []).find((s: any) => s.id === override.segmentId)
            if (seg && seg.type === 'video') {
              seg.src = override.clipPath
              if (override.clipName) seg.name = override.clipName
            }
          }
        }
      }

      const outPath = join(outputDir, `${variation.name}.json`)
      saveProject(outPath, varProject)
      written.push(variation.name)
    } catch (e: unknown) {
      errors.push(`${variation.name}: ${(e as Error).message}`)
    }
  }

  console.log(`Created ${written.length} variation(s) in: ${outputDir}`)
  if (written.length > 0) console.log(`Written: ${written.join(', ')}`)
  if (errors.length > 0) console.log(`Errors:\n${errors.map(e => '  ' + e).join('\n')}`)
}
