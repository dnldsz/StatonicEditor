import { existsSync, readdirSync, mkdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'
import { readProject, saveProject, summariseProject } from '../project.js'
import { getProjectsDir, getActiveAccountId, loadConfig } from '../config.js'
import { exportVideo } from '../ffmpeg.js'

export function cmdProjectRead(args: string[]): void {
  const path = args[0]
  if (!path) { console.error('Usage: statonic project read <path>'); process.exit(1) }
  const project = readProject(path)
  console.log(summariseProject(project))
}

export function cmdProjectList(args: string[]): void {
  let accountId = ''
  const accIdx = args.indexOf('--account')
  if (accIdx >= 0 && args[accIdx + 1]) accountId = args[accIdx + 1]

  const config = loadConfig()
  const dataDir = config.dataDir
  const projectsBase = join(dataDir, 'projects', 'accounts')

  if (!existsSync(projectsBase)) {
    console.log('No projects found.')
    return
  }

  let accountDirs = readdirSync(projectsBase).filter(f =>
    statSync(join(projectsBase, f)).isDirectory()
  )
  if (accountId) {
    accountDirs = accountDirs.filter(a => a.toLowerCase().includes(accountId.toLowerCase()))
  }

  const results: Array<{ account: string; name: string; path: string }> = []
  for (const acct of accountDirs) {
    const dir = join(projectsBase, acct)
    const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      results.push({ account: acct, name: basename(f, '.json'), path: join(dir, f) })
    }
    // Check subdirectories (variation folders)
    const subdirs = readdirSync(dir).filter(f => {
      try { return statSync(join(dir, f)).isDirectory() } catch { return false }
    })
    for (const sub of subdirs) {
      const subFiles = readdirSync(join(dir, sub)).filter(f => f.endsWith('.json'))
      for (const f of subFiles) {
        results.push({ account: acct, name: `${sub}/${basename(f, '.json')}`, path: join(dir, sub, f) })
      }
    }
  }

  if (results.length === 0) {
    console.log('No projects found.')
    return
  }

  for (const r of results) {
    console.log(`[${r.account}] ${r.name}`)
    console.log(`  ${r.path}`)
  }
}

export function cmdProjectWrite(args: string[]): void {
  const jsonStr = args[0]
  const filename = args[1]
  if (!jsonStr || !filename) {
    console.error('Usage: statonic project write <json> <filename>')
    process.exit(1)
  }

  const accountId = getActiveAccountId()
  const project = JSON.parse(jsonStr)
  if (!project.accountId) project.accountId = accountId

  const dir = getProjectsDir(accountId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const projectPath = join(dir, filename.endsWith('.json') ? filename : `${filename}.json`)
  saveProject(projectPath, project)
  console.log(`Saved: ${projectPath}`)
}

export async function cmdProjectExport(args: string[]): Promise<void> {
  const projectPath = args[0]
  if (!projectPath) { console.error('Usage: statonic project export <path> [--output <path>]'); process.exit(1) }

  let outputPath = ''
  const outIdx = args.indexOf('--output')
  if (outIdx >= 0 && args[outIdx + 1]) outputPath = args[outIdx + 1]

  const project = readProject(projectPath)
  if (!outputPath) {
    outputPath = join(dirname(projectPath), `${project.name ?? 'export'}.mp4`)
  }

  console.log(`Exporting to: ${outputPath}`)
  const result = await exportVideo(project, outputPath, (line) => {
    // Print progress lines that contain frame info
    if (line.includes('frame=') || line.includes('time=')) {
      process.stderr.write(line)
    }
  })

  if (result.ok) {
    console.log(`Export complete: ${result.filePath}`)
  } else {
    console.error(`Export failed: ${result.error}`)
    process.exit(1)
  }
}
