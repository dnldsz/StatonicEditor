#!/usr/bin/env node

import { loadConfig, saveConfig } from './config.js'
import { cmdProjectRead, cmdProjectList, cmdProjectWrite, cmdProjectExport } from './commands/project.js'
import { cmdSegmentUpdate, cmdSegmentDelete, cmdSegmentAddText, cmdSegmentAddZoom } from './commands/segment.js'
import { cmdPreview, cmdFrames, cmdVideoInfo } from './commands/preview.js'
import { cmdClipAnalyze, cmdClipIndex, cmdClipSearch, cmdClipList } from './commands/clip.js'
import { cmdTemplateList, cmdTemplateUse } from './commands/template.js'
import { cmdAccountList, cmdAccountSet, cmdAccountCreate } from './commands/account.js'
import { cmdAudioFind } from './commands/audio.js'
import { cmdHookGenerate, cmdHookLearn } from './commands/hook.js'
import { cmdVariationCreate } from './commands/variation.js'
import { cmdMigrate } from './commands/migrate.js'
import { cmdTelegram } from './commands/telegram.js'
import { cmdReelDownload, cmdReelDetect, cmdReelAnalyze, cmdReelBatch, cmdReelInspect, cmdReelInsights, cmdReelTop } from './commands/reel.js'

const HELP = `statonic — headless video editor CLI

USAGE:
  statonic <command> [subcommand] [options]

PROJECT:
  project read <path>                    Read and summarize a project
  project list [--account <id>]          List all projects
  project write <json> <filename>        Write a project JSON file
  project export <path> [--output <p>]   Export to MP4

SEGMENT:
  segment update <project> <id> <json>   Update segment properties
  segment delete <project> <id>          Delete a segment
  segment add-text <project> --text "..." --start <s> --duration <s> [--x 0] [--y 0] [--font-size 80]
  segment add-zoom <project> <id> --keyframes '<json>'

PREVIEW / VIDEO:
  preview <project> [--time <s>] [--output <path>]
  frames <video-path> [--times 1,2.5,4] [--output-dir ./]
  video-info <video-path>

CLIP LIBRARY:
  clip analyze <video-path> [--metadata <json>] [--keyframes <n>]
  clip index [<folder>] [--regenerate]
  clip search <query> [--category <cat>] [--account <id>]
  clip list [--category <cat>] [--account <id>]

TEMPLATES:
  template list
  template use <id> [--name "..."] [--slots <json>]

HOOKS:
  hook generate <topic>
  hook learn <video-path>

VARIATIONS:
  variation create <project> --variations <json> [--output-dir <path>]

AUDIO:
  audio find --hook-duration <s> --total-duration <s> [--prefer-closest]

ACCOUNTS:
  account list
  account set <id>
  account create <name>

REEL ANALYSIS:
  reel download <url> [--views <n>] [--company <name>]
  reel detect <id-or-path> [--threshold <0.3>]
  reel analyze <id> [--json '<analysis>']
  reel batch <csv-or-xlsx> [--limit <n>] [--min-views <n>] [--company <name>]
  reel inspect <id>
  reel insights
  reel top [--min-views <n>] [--limit <n>]

UTILITY:
  telegram <file-path> [--caption "..."]
  migrate                                Migrate data from Electron app
  config                                 Show current config
`

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP)
    return
  }

  const cmd = args[0]
  const sub = args[1]
  const rest = args.slice(2)

  switch (cmd) {
    case 'project':
      switch (sub) {
        case 'read': return cmdProjectRead(rest)
        case 'list': return cmdProjectList(rest)
        case 'write': return cmdProjectWrite(rest)
        case 'export': return await cmdProjectExport(rest)
        default: console.error(`Unknown project subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'segment':
      switch (sub) {
        case 'update': return cmdSegmentUpdate(rest)
        case 'delete': return cmdSegmentDelete(rest)
        case 'add-text': return cmdSegmentAddText(rest)
        case 'add-zoom': return cmdSegmentAddZoom(rest)
        default: console.error(`Unknown segment subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'preview': return cmdPreview(args.slice(1))
    case 'frames': return cmdFrames(args.slice(1))
    case 'video-info': return cmdVideoInfo(args.slice(1))

    case 'clip':
      switch (sub) {
        case 'analyze': return cmdClipAnalyze(rest)
        case 'index': return cmdClipIndex(rest)
        case 'search': return cmdClipSearch(rest)
        case 'list': return cmdClipList(rest)
        default: console.error(`Unknown clip subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'template':
      switch (sub) {
        case 'list': return cmdTemplateList()
        case 'use': return cmdTemplateUse(rest)
        default: console.error(`Unknown template subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'hook':
      switch (sub) {
        case 'generate': return cmdHookGenerate(rest)
        case 'learn': return cmdHookLearn(rest)
        default: console.error(`Unknown hook subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'variation':
      switch (sub) {
        case 'create': return cmdVariationCreate(rest)
        default: console.error(`Unknown variation subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'audio':
      switch (sub) {
        case 'find': return cmdAudioFind(rest)
        default: console.error(`Unknown audio subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'account':
      switch (sub) {
        case 'list': return cmdAccountList()
        case 'set': return cmdAccountSet(rest)
        case 'create': return cmdAccountCreate(rest)
        default: console.error(`Unknown account subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'reel':
      switch (sub) {
        case 'download': return cmdReelDownload(rest)
        case 'detect': return cmdReelDetect(rest)
        case 'analyze': return cmdReelAnalyze(rest)
        case 'batch': return cmdReelBatch(rest)
        case 'inspect': return cmdReelInspect(rest)
        case 'insights': return cmdReelInsights(rest)
        case 'top': return cmdReelTop(rest)
        default: console.error(`Unknown reel subcommand: ${sub}`); process.exit(1)
      }
      break

    case 'telegram': return cmdTelegram(args.slice(1))
    case 'migrate': return cmdMigrate()
    case 'config': {
      if (sub === 'set' && rest[0] && rest[1]) {
        saveConfig({ [rest[0]]: rest[1] } as any)
        console.log(`Set ${rest[0]} = ${rest[1]}`)
        return
      }
      const config = loadConfig()
      console.log(JSON.stringify(config, null, 2))
      return
    }

    default:
      console.error(`Unknown command: ${cmd}`)
      console.log('Run: statonic --help')
      process.exit(1)
  }
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
