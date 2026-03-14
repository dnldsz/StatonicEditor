import { existsSync, readFileSync } from 'fs'
import { basename } from 'path'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { loadConfig } from '../config.js'

export function cmdTelegram(args: string[]): void {
  const filePath = args[0]
  if (!filePath) { console.error('Usage: statonic telegram <file-path> [--caption "..."]'); process.exit(1) }

  let caption = ''
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--caption' && args[i + 1]) caption = args[++i]
  }

  const config = loadConfig()
  const token = process.env.TELEGRAM_BOT_TOKEN || config.telegramBotToken
  const chatId = process.env.TELEGRAM_CHAT_ID || config.telegramChatId
  if (!token) { console.error('No Telegram bot token. Set TELEGRAM_BOT_TOKEN env var or run: statonic config set telegramBotToken <token>'); process.exit(1) }
  if (!chatId) { console.error('No Telegram chat ID. Set TELEGRAM_CHAT_ID env var or run: statonic config set telegramChatId <id>'); process.exit(1) }
  if (!existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1) }

  const fileData = readFileSync(filePath)
  const fileName = basename(filePath)

  const boundary = `----FormBoundary${randomBytes(8).toString('hex')}`
  const CRLF = '\r\n'

  const parts: Buffer[] = []
  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`
    ))
  }

  addField('chat_id', chatId)
  if (caption) addField('caption', caption)

  parts.push(Buffer.from(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="document"; filename="${fileName}"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}`
  ))
  parts.push(fileData)
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`))

  const body = Buffer.concat(parts)
  const tmpBody = join(tmpdir(), `tg_body_${randomBytes(4).toString('hex')}.bin`)
  writeFileSync(tmpBody, body)

  const r = spawnSync('curl', [
    '-s', '-X', 'POST',
    `https://api.telegram.org/bot${token}/sendDocument`,
    '-H', `Content-Type: multipart/form-data; boundary=${boundary}`,
    '--data-binary', `@${tmpBody}`,
  ], { encoding: 'utf-8' })

  spawnSync('rm', ['-f', tmpBody])

  if (r.status !== 0) { console.error(`curl failed: ${r.stderr}`); process.exit(1) }

  let resp: any
  try { resp = JSON.parse(r.stdout) } catch { console.error(`Bad response: ${r.stdout}`); process.exit(1) }
  if (!resp.ok) { console.error(`Telegram error: ${resp.description ?? JSON.stringify(resp)}`); process.exit(1) }

  console.log(`Sent "${fileName}" to Telegram.`)
}
