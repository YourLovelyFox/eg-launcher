import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const DATA_FOLDER = 'eg-data'

export function getDataRoot(): string {
  const root = path.join(app.getPath('userData'), DATA_FOLDER)
  ensureDir(root)
  return root
}

export function getInstancesDir(): string {
  const dir = path.join(getDataRoot(), 'instances')
  ensureDir(dir)
  return dir
}

export function getInstanceDir(instanceId: string): string {
  const dir = path.join(getInstancesDir(), instanceId)
  ensureDir(dir)
  return dir
}

export function getInstanceModsDir(instanceId: string): string {
  const dir = path.join(getInstanceDir(instanceId), 'mods')
  ensureDir(dir)
  return dir
}

export function getVersionsDir(): string {
  const dir = path.join(getDataRoot(), 'versions')
  ensureDir(dir)
  return dir
}

export function getLibrariesDir(): string {
  const dir = path.join(getDataRoot(), 'libraries')
  ensureDir(dir)
  return dir
}

export function getAssetsDir(): string {
  const dir = path.join(getDataRoot(), 'assets')
  ensureDir(dir)
  return dir
}

export function getNativesDir(versionId: string): string {
  const dir = path.join(getDataRoot(), 'natives', versionId)
  ensureDir(dir)
  return dir
}

export function getAccountsPath(): string {
  return path.join(getDataRoot(), 'accounts.json')
}

export function getSettingsPath(): string {
  return path.join(getDataRoot(), 'settings.json')
}

export function getInstancesIndexPath(): string {
  return path.join(getDataRoot(), 'instances.json')
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
