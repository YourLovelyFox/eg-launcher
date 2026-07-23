import fs from 'fs'
import path from 'path'
import type { InstanceBackupInfo, ProgressEvent } from '../../shared/types'
import { ensureDir, getDataRoot, getInstanceDir, readJsonFile, writeJsonFile } from '../paths'
import { getInstance } from './instances'

/** Paths/files inside an instance game dir that we always backup. */
const ALWAYS_ITEMS = [
  'mods',
  'config',
  'options.txt',
  'optionsof.txt',
  'optionsshaders.txt',
  'servers.dat',
  'resourcepacks',
  'shaderpacks',
  'datapacks',
] as const

export type BackupCreateOptions = {
  /** Include world saves (can be large). Default true. */
  includeSaves?: boolean
  label?: string
}

function backupsRoot(): string {
  const dir = path.join(getDataRoot(), 'backups')
  ensureDir(dir)
  return dir
}

function instanceBackupsDir(instanceId: string): string {
  const dir = path.join(backupsRoot(), sanitizeId(instanceId))
  ensureDir(dir)
  return dir
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  const walk = (p: string) => {
    let st: fs.Stats
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isFile()) {
      total += st.size
      return
    }
    if (st.isDirectory()) {
      let entries: string[]
      try {
        entries = fs.readdirSync(p)
      } catch {
        return
      }
      for (const e of entries) walk(path.join(p, e))
    }
  }
  walk(dir)
  return total
}

function copyRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    ensureDir(dest)
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else if (st.isFile()) {
    ensureDir(path.dirname(dest))
    fs.copyFileSync(src, dest)
  }
}

function removeRecursive(target: string): void {
  if (!fs.existsSync(target)) return
  fs.rmSync(target, { recursive: true, force: true })
}

function metaPath(backupDir: string): string {
  return path.join(backupDir, 'meta.json')
}

function readMeta(backupDir: string): InstanceBackupInfo | null {
  const meta = readJsonFile<InstanceBackupInfo | null>(metaPath(backupDir), null)
  if (!meta?.id) return null
  return meta
}

export function listInstanceBackups(instanceId: string): InstanceBackupInfo[] {
  const root = instanceBackupsDir(instanceId)
  if (!fs.existsSync(root)) return []
  const out: InstanceBackupInfo[] = []
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const meta = readMeta(dir)
    if (meta) out.push(meta)
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return out
}

export async function createInstanceBackup(
  instanceId: string,
  options: BackupCreateOptions = {},
  onProgress?: (event: ProgressEvent) => void,
): Promise<InstanceBackupInfo> {
  const instance = getInstance(instanceId)
  if (!instance) throw new Error('Instance not found')

  const includeSaves = options.includeSaves !== false
  const gameDir = getInstanceDir(instanceId)
  const id = `${stamp()}_${Math.random().toString(36).slice(2, 7)}`
  const dest = path.join(instanceBackupsDir(instanceId), id)
  ensureDir(dest)

  const emit = (stage: string, progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
  }

  emit('prepare', 0.05, 'Preparing backup…')

  const items = [...ALWAYS_ITEMS]
  if (includeSaves) items.push('saves' as (typeof ALWAYS_ITEMS)[number])

  let done = 0
  for (const item of items) {
    const src = path.join(gameDir, item)
    const target = path.join(dest, item)
    emit('copy', 0.1 + (done / Math.max(items.length, 1)) * 0.8, `Copying ${item}…`)
    if (fs.existsSync(src)) {
      copyRecursive(src, target)
    }
    done++
  }

  const sizeBytes = dirSizeBytes(dest)
  const info: InstanceBackupInfo = {
    id,
    instanceId,
    instanceName: instance.name,
    createdAt: new Date().toISOString(),
    label: options.label?.trim() || `${instance.name} backup`,
    includeSaves,
    sizeBytes,
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    modCount: instance.mods.length,
  }
  writeJsonFile(metaPath(dest), info)
  emit('done', 1, 'Backup complete')
  return info
}

export async function restoreInstanceBackup(
  instanceId: string,
  backupId: string,
  onProgress?: (event: ProgressEvent) => void,
): Promise<{ ok: true; message: string }> {
  const instance = getInstance(instanceId)
  if (!instance) throw new Error('Instance not found')

  const safeBackupId = sanitizeId(backupId)
  const backupDir = path.join(instanceBackupsDir(instanceId), safeBackupId)
  if (!fs.existsSync(backupDir)) throw new Error('Backup not found')
  const meta = readMeta(backupDir)
  if (!meta) throw new Error('Backup meta missing')

  const gameDir = getInstanceDir(instanceId)
  const emit = (stage: string, progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
  }

  emit('prepare', 0.05, 'Preparing restore…')

  // Snapshot current state lightly into a rollback folder (best-effort)
  const rollbackId = `pre-restore_${stamp()}`
  const rollbackDir = path.join(instanceBackupsDir(instanceId), rollbackId)
  ensureDir(rollbackDir)

  const items = fs.readdirSync(backupDir).filter((n) => n !== 'meta.json')
  let done = 0
  for (const item of items) {
    const fromBackup = path.join(backupDir, item)
    const live = path.join(gameDir, item)
    emit('restore', 0.1 + (done / Math.max(items.length, 1)) * 0.85, `Restoring ${item}…`)

    // Keep a copy of what we're about to overwrite
    if (fs.existsSync(live)) {
      copyRecursive(live, path.join(rollbackDir, item))
      removeRecursive(live)
    }
    copyRecursive(fromBackup, live)
    done++
  }

  writeJsonFile(metaPath(rollbackDir), {
    id: rollbackId,
    instanceId,
    instanceName: instance.name,
    createdAt: new Date().toISOString(),
    label: `Auto snapshot before restore of ${meta.label}`,
    includeSaves: meta.includeSaves,
    sizeBytes: dirSizeBytes(rollbackDir),
    gameVersion: instance.gameVersion,
    loader: instance.loader,
    modCount: instance.mods.length,
  } satisfies InstanceBackupInfo)

  emit('done', 1, 'Restore complete')
  return {
    ok: true,
    message: `Restored “${meta.label}”. A safety snapshot was saved as ${rollbackId}.`,
  }
}

export function deleteInstanceBackup(instanceId: string, backupId: string): boolean {
  const safeBackupId = sanitizeId(backupId)
  const backupDir = path.join(instanceBackupsDir(instanceId), safeBackupId)
  if (!fs.existsSync(backupDir)) return false
  // Safety: only delete under backups root
  const root = path.resolve(instanceBackupsDir(instanceId))
  const resolved = path.resolve(backupDir)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Invalid backup path')
  }
  removeRecursive(backupDir)
  return true
}

export function openBackupsFolder(instanceId?: string): string {
  if (instanceId) {
    const dir = instanceBackupsDir(instanceId)
    return dir
  }
  return backupsRoot()
}
