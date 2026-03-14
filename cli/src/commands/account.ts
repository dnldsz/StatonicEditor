import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getDataDir, loadConfig, saveConfig } from '../config.js'
import { uid } from '../project.js'
import type { Account } from '../types.js'

function getAccountsPath(): string {
  return join(getDataDir(), 'accounts.json')
}

function loadAccounts(): Account[] {
  const path = getAccountsPath()
  if (!existsSync(path)) return []
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return [] }
}

function saveAccounts(accounts: Account[]): void {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getAccountsPath(), JSON.stringify(accounts, null, 2))
}

export function cmdAccountList(): void {
  const accounts = loadAccounts()
  const config = loadConfig()

  if (accounts.length === 0) { console.log('No accounts. Create one: statonic account create <name>'); return }

  for (const acc of accounts) {
    const active = acc.id === config.activeAccountId ? ' (active)' : ''
    console.log(`${acc.id} — ${acc.name}${active}`)
  }
}

export function cmdAccountSet(args: string[]): void {
  const id = args[0]
  if (!id) { console.error('Usage: statonic account set <id>'); process.exit(1) }

  const accounts = loadAccounts()
  const match = accounts.find(a => a.id === id || a.name.toLowerCase() === id.toLowerCase())
  if (!match) { console.error(`Account "${id}" not found`); process.exit(1) }

  saveConfig({ activeAccountId: match.id })
  console.log(`Active account: ${match.name} (${match.id})`)
}

export function cmdAccountCreate(args: string[]): void {
  const name = args[0]
  if (!name) { console.error('Usage: statonic account create <name>'); process.exit(1) }

  const accounts = loadAccounts()
  const newAcc: Account = {
    id: uid(),
    name,
    created: new Date().toISOString(),
  }
  accounts.push(newAcc)
  saveAccounts(accounts)

  // Set as active if first account
  if (accounts.length === 1) {
    saveConfig({ activeAccountId: newAcc.id })
    console.log(`Created and set as active: ${name} (${newAcc.id})`)
  } else {
    console.log(`Created: ${name} (${newAcc.id})`)
  }
}
