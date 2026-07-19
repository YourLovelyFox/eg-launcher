import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const LEGACY_APP_FOLDERS = ['pulse-launcher', 'hive-launcher'] as const
const MODERN_APP_FOLDER = 'eg-launcher'
const LEGACY_DATA_FOLDERS = ['pulse-data', 'hive-data'] as const
const MODERN_DATA = 'eg-data'
const MARKER = '.eg-migration-v1'

function dirHasContent(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false
    return fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

function copyRecursive(src: string, dest: string): void {
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    errorOnExist: false,
  })
}

function rewritePathsInJsonFile(filePath: string, replacements: Array<[string, string]>): void {
  if (!fs.existsSync(filePath)) return
  try {
    let raw = fs.readFileSync(filePath, 'utf-8')
    let changed = false
    for (const [from, to] of replacements) {
      if (raw.includes(from)) {
        raw = raw.split(from).join(to)
        changed = true
      }
    }
    if (changed) fs.writeFileSync(filePath, raw, 'utf-8')
  } catch {
    // ignore
  }
}

/**
 * Migrate launcher data from legacy folders into EG Launcher.
 * Safe to call every launch — no-ops once migration marker exists and eg-data is present.
 */
export function migrateToHiveLauncher(): { migrated: boolean; message: string } {
  const appData = app.getPath('appData')
  const modernRoot = path.join(appData, MODERN_APP_FOLDER)

  try {
    fs.mkdirSync(modernRoot, { recursive: true })
    app.setPath('userData', modernRoot)
  } catch (err) {
    return { migrated: false, message: `Failed to set userData: ${(err as Error).message}` }
  }

  const modernData = path.join(modernRoot, MODERN_DATA)
  const markerPath = path.join(modernRoot, MARKER)

  if (fs.existsSync(markerPath) && dirHasContent(modernData)) {
    return { migrated: false, message: 'Already on EG Launcher data path' }
  }

  const candidateSources: string[] = []
  for (const appFolder of LEGACY_APP_FOLDERS) {
    for (const dataFolder of LEGACY_DATA_FOLDERS) {
      candidateSources.push(path.join(appData, appFolder, dataFolder))
    }
  }
  // Also check under modern root leftovers
  for (const dataFolder of LEGACY_DATA_FOLDERS) {
    candidateSources.push(path.join(modernRoot, dataFolder))
  }

  const sources = candidateSources.filter((p) => dirHasContent(p))

  if (sources.length === 0) {
    fs.mkdirSync(modernData, { recursive: true })
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        { migratedAt: new Date().toISOString(), source: null, note: 'fresh-install' },
        null,
        2,
      ),
      'utf-8',
    )
    return { migrated: false, message: 'No legacy data found; ready for EG Launcher' }
  }

  if (dirHasContent(modernData)) {
    rewriteEgPaths(modernData)
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ migratedAt: new Date().toISOString(), source: 'already-present' }, null, 2),
      'utf-8',
    )
    return { migrated: true, message: 'EG data already present; path rewrites applied' }
  }

  const source = sources[0]
  try {
    fs.mkdirSync(path.dirname(modernData), { recursive: true })
    copyRecursive(source, modernData)
    rewriteEgPaths(modernData)

    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          migratedAt: new Date().toISOString(),
          source,
          destination: modernData,
        },
        null,
        2,
      ),
      'utf-8',
    )

    return {
      migrated: true,
      message: `Migrated data from ${source} → ${modernData}`,
    }
  } catch (err) {
    return {
      migrated: false,
      message: `Migration failed: ${(err as Error).message}`,
    }
  }
}

function rewriteEgPaths(dataRoot: string): void {
  const replacements: Array<[string, string]> = [
    ['pulse-data', 'eg-data'],
    ['hive-data', 'eg-data'],
    ['pulse-launcher', 'eg-launcher'],
    ['hive-launcher', 'eg-launcher'],
    ['PulseLauncher', 'EGLauncher'],
    ['HiveLauncher', 'EGLauncher'],
    ['Pulse Launcher', 'EG Launcher'],
    ['Hive Launcher', 'EG Launcher'],
  ]

  const jsonFiles = [
    path.join(dataRoot, 'settings.json'),
    path.join(dataRoot, 'instances.json'),
    path.join(dataRoot, 'accounts.json'),
    path.join(dataRoot, 'featured-packs.json'),
  ]

  for (const f of jsonFiles) {
    rewritePathsInJsonFile(f, replacements)
  }

  const instancesDir = path.join(dataRoot, 'instances')
  if (fs.existsSync(instancesDir)) {
    for (const id of fs.readdirSync(instancesDir)) {
      rewritePathsInJsonFile(path.join(instancesDir, id, 'instance.json'), replacements)
    }
  }
}

/** Absolute path to the modern EG data root (after setPath). */
export function getHiveDataRoot(): string {
  return path.join(app.getPath('userData'), MODERN_DATA)
}
