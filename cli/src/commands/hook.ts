import { existsSync, readFileSync } from 'fs'
import { getHookKnowledgePath } from '../config.js'
import { extractKeyframes } from '../ffmpeg.js'

export function cmdHookGenerate(args: string[]): void {
  const topic = args[0]
  if (!topic) { console.error('Usage: statonic hook generate <topic>'); process.exit(1) }

  const knowledgePath = getHookKnowledgePath()
  let knowledge: { formulas: any[]; learned_examples: any[] } = { formulas: [], learned_examples: [] }
  if (existsSync(knowledgePath)) {
    try { knowledge = JSON.parse(readFileSync(knowledgePath, 'utf-8')) } catch {}
  }

  console.log(`Topic: "${topic}"`)
  console.log()
  console.log(`Available formulas:`)
  for (const f of knowledge.formulas) {
    console.log(`  ${f.id}: "${f.pattern}"`)
    console.log(`    Example: "${f.example}"`)
    if (f.notes) console.log(`    Notes: ${f.notes}`)
  }

  if (knowledge.learned_examples.length > 0) {
    console.log()
    console.log(`Learned examples:`)
    for (const e of knowledge.learned_examples.slice(0, 5)) {
      console.log(`  "${e.extracted_text}" (formula: ${e.formula}, topic: ${e.topic})`)
    }
  }

  console.log()
  console.log(`Use these formulas to generate hook text for "${topic}".`)
  console.log(`Apply the formula patterns to the topic, creating 2-3 line text with CAPS emphasis.`)
}

export function cmdHookLearn(args: string[]): void {
  const videoPath = args[0]
  if (!videoPath) { console.error('Usage: statonic hook learn <video-path>'); process.exit(1) }
  if (!existsSync(videoPath)) { console.error(`Video not found: ${videoPath}`); process.exit(1) }

  const { timestamps, paths } = extractKeyframes(videoPath, 3)

  console.log(`Extracted ${paths.length} frames from first seconds of: ${videoPath}`)
  for (let i = 0; i < paths.length; i++) {
    console.log(`  ${timestamps[i].toFixed(1)}s → ${paths[i]}`)
  }
  console.log()
  console.log(`Analyze the frames above, then update hook-knowledge.json at:`)
  console.log(`  ${getHookKnowledgePath()}`)
}
