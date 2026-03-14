import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface StatonicConfig {
  dataDir: string
  activeAccountId: string | null
  fontPath: string
  telegramBotToken?: string
  telegramChatId?: string
}

const DEFAULT_FONT_PATH = '/Users/danieldsouza/Downloads/tiktok-text-display-cufonfonts/TikTokTextMedium.otf'

export function getDataDir(): string {
  if (process.env.STATONIC_DATA_DIR) return process.env.STATONIC_DATA_DIR
  return '/Users/danieldsouza/Documents/2025/AppData'
}

export function getConfigPath(): string {
  return join(getDataDir(), 'config.json')
}

export function loadConfig(): StatonicConfig {
  const dataDir = getDataDir()
  const configPath = getConfigPath()

  const defaults: StatonicConfig = {
    dataDir,
    activeAccountId: null,
    fontPath: DEFAULT_FONT_PATH,
  }

  if (existsSync(configPath)) {
    try {
      const saved = JSON.parse(readFileSync(configPath, 'utf-8'))
      return { ...defaults, ...saved, dataDir }
    } catch {
      return defaults
    }
  }
  return defaults
}

export function saveConfig(config: Partial<StatonicConfig>): void {
  const dataDir = getDataDir()
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  const current = loadConfig()
  const merged = { ...current, ...config }
  writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2))
}

export function getProjectsDir(accountId: string): string {
  return join(getDataDir(), 'projects', 'accounts', accountId)
}

export function getClipLibraryDir(accountId: string): string {
  return join(getDataDir(), 'clip-library', 'accounts', accountId, 'clips')
}

export function getAudioLibraryDir(): string {
  return join(getDataDir(), 'audio-library')
}

export function getTemplatesDir(): string {
  return join(getDataDir(), 'templates')
}

export function getHookKnowledgePath(): string {
  return join(getDataDir(), 'hook-knowledge.json')
}

export function getReelsDir(): string {
  return join(getDataDir(), 'reels')
}

export function getActiveAccountId(): string {
  const config = loadConfig()
  if (!config.activeAccountId) {
    console.error('No active account. Run: statonic account set <id>')
    process.exit(1)
  }
  return config.activeAccountId
}
