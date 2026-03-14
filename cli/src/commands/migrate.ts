import { existsSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getDataDir, saveConfig } from '../config.js'

export function cmdMigrate(): void {
  const electronDataDir = join(homedir(), 'Library', 'Application Support', 'Statonic')
  const targetDir = getDataDir()

  if (!existsSync(electronDataDir)) {
    console.log(`No Electron app data found at: ${electronDataDir}`)
    console.log('Nothing to migrate.')
    return
  }

  console.log(`Source: ${electronDataDir}`)
  console.log(`Target: ${targetDir}`)
  console.log()

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })

  const items = [
    { src: 'accounts.json', label: 'Accounts' },
    { src: 'clip-library', label: 'Clip library', dir: true },
    { src: 'projects', label: 'Projects', dir: true },
    { src: 'audio-library', label: 'Audio library', dir: true },
    { src: 'templates', label: 'Templates', dir: true },
    { src: 'hook-knowledge.json', label: 'Hook knowledge' },
  ]

  let migrated = 0
  for (const item of items) {
    const srcPath = join(electronDataDir, item.src)
    const dstPath = join(targetDir, item.src)

    if (!existsSync(srcPath)) {
      console.log(`  Skip: ${item.label} (not found)`)
      continue
    }

    if (existsSync(dstPath)) {
      console.log(`  Skip: ${item.label} (already exists at target)`)
      continue
    }

    try {
      if (item.dir) {
        cpSync(srcPath, dstPath, { recursive: true })
      } else {
        cpSync(srcPath, dstPath)
      }
      console.log(`  Copied: ${item.label}`)
      migrated++
    } catch (e: unknown) {
      console.error(`  Error: ${item.label} — ${(e as Error).message}`)
    }
  }

  // Migrate active account from current-state.json
  const stateFile = join(electronDataDir, 'current-state.json')
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'))
      if (state.currentAccountId) {
        saveConfig({ activeAccountId: state.currentAccountId })
        console.log(`  Set active account: ${state.currentAccountId}`)
      }
    } catch {}
  }

  console.log()
  console.log(`Migration complete. ${migrated} item(s) copied.`)
  console.log('Original data is untouched at the source.')
}
