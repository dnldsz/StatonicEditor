// Patches the local Electron binary's Info.plist so the macOS menu bar
// and dock show "Statonic" instead of "Electron" during development.
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plist = join(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist')

const set = (key, value) => {
  try {
    execSync(`/usr/libexec/PlistBuddy -c "Set :${key} ${value}" "${plist}"`, { stdio: 'pipe' })
  } catch {
    execSync(`/usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "${plist}"`, { stdio: 'pipe' })
  }
}

try {
  set('CFBundleName', 'Statonic')
  set('CFBundleDisplayName', 'Statonic')
  set('LSDisplayName', 'Statonic')
  // Refresh the macOS dock so it picks up the new name immediately
  try { execSync('killall Dock', { stdio: 'pipe' }) } catch {}
  console.log('✓ Patched Electron binary name → Statonic')
} catch (e) {
  console.warn('Could not patch Electron binary:', e.message)
}
