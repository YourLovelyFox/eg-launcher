import fs from 'fs'
import path from 'path'
import type { GameInstance, InstalledMod, LoaderType } from '../../shared/types'
import {
  ensureDir,
  getDataRoot,
  getInstanceDir,
  getInstanceModsDir,
  getInstancesDir,
  getInstancesIndexPath,
  readJsonFile,
  writeJsonFile,
} from '../paths'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function decodeURIComponentSafe(id: string): string {
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}

function loadIndex(): GameInstance[] {
  return readJsonFile<GameInstance[]>(getInstancesIndexPath(), [])
}

function saveIndex(instances: GameInstance[]): void {
  writeJsonFile(getInstancesIndexPath(), instances)
}

/** Windows-safe folder name from display name. */
export function sanitizeInstanceFolderName(name: string): string {
  let s = (name || '').trim()
  // Forbidden Windows filename chars + control chars
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  // No trailing dots/spaces (Windows)
  s = s.replace(/[. ]+$/g, '')
  if (!s) s = 'Instance'
  // Avoid reserved device names
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) {
    s = `Instance ${s}`
  }
  return s.slice(0, 80)
}

function folderExists(folder: string): boolean {
  return fs.existsSync(path.join(getInstancesDir(), folder))
}

/**
 * Unique folder name under instances/.
 * @param excludeId current folder id when renaming (allowed to reuse own name)
 */
export function uniqueInstanceFolderName(desiredName: string, excludeId?: string): string {
  const base = sanitizeInstanceFolderName(desiredName)
  let candidate = base
  let n = 2
  const instances = loadIndex()
  while (true) {
    const takenByOther = instances.some(
      (i) => i.id !== excludeId && i.id.toLowerCase() === candidate.toLowerCase(),
    )
    const diskTaken =
      folderExists(candidate) &&
      (!excludeId || candidate.toLowerCase() !== excludeId.toLowerCase())
    if (!takenByOther && !diskTaken) return candidate
    candidate = `${base} (${n})`
    n++
    if (n > 999) return `${base}-${Date.now().toString(36)}`
  }
}

/** Update partners.json instanceId references after a rename. */
function rewirePartnerInstanceIds(oldId: string, newId: string): void {
  if (oldId === newId) return
  const storePath = path.join(getDataRoot(), 'partners.json')
  const store = readJsonFile<Record<string, { instanceId?: string | null }>>(storePath, {})
  let changed = false
  for (const key of Object.keys(store)) {
    if (store[key]?.instanceId === oldId) {
      store[key] = { ...store[key], instanceId: newId }
      changed = true
    }
  }
  if (changed) writeJsonFile(storePath, store)

  // Featured pack local state (bees SMP etc.)
  const featuredPath = path.join(getDataRoot(), 'featured-packs.json')
  if (fs.existsSync(featuredPath)) {
    try {
      const raw = readJsonFile<Record<string, { instanceId?: string | null }>>(featuredPath, {})
      let changedFeatured = false
      for (const key of Object.keys(raw)) {
        if (raw[key]?.instanceId === oldId) {
          raw[key] = { ...raw[key], instanceId: newId }
          changedFeatured = true
        }
      }
      if (changedFeatured) writeJsonFile(featuredPath, raw)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Migrate legacy UUID folders → human-readable names.
 * Called on list so Explorer always shows names.
 */
function migrateInstanceFoldersToNames(): void {
  const instances = loadIndex()
  let changed = false
  const next: GameInstance[] = []

  for (const inst of instances) {
    if (!UUID_RE.test(inst.id)) {
      next.push(inst)
      continue
    }

    const oldDir = path.join(getInstancesDir(), inst.id)
    if (!fs.existsSync(oldDir)) {
      // Index entry without folder — still rename id for consistency
      const newId = uniqueInstanceFolderName(inst.name, inst.id)
      next.push({ ...inst, id: newId })
      rewirePartnerInstanceIds(inst.id, newId)
      changed = true
      continue
    }

    try {
      const newId = uniqueInstanceFolderName(inst.name, inst.id)
      const newDir = path.join(getInstancesDir(), newId)
      if (oldDir !== newDir) {
        fs.renameSync(oldDir, newDir)
      }
      const updated = { ...inst, id: newId, name: inst.name }
      writeJsonFile(path.join(newDir, 'instance.json'), updated)
      rewirePartnerInstanceIds(inst.id, newId)
      next.push(updated)
      changed = true
    } catch (err) {
      console.warn('[instances] migrate folder failed', inst.id, err)
      next.push(inst)
    }
  }

  if (changed) saveIndex(next)
}

let migratedOnce = false
function needsFolderMigration(instances: GameInstance[]): boolean {
  return instances.some((i) => UUID_RE.test(i.id))
}

function ensureMigrated(): void {
  if (migratedOnce) return
  // Fast path: most installs already use human-readable folder ids
  const current = loadIndex()
  if (!needsFolderMigration(current)) {
    migratedOnce = true
    return
  }
  migrateInstanceFoldersToNames()
  migratedOnce = true
}

export function listInstances(): GameInstance[] {
  ensureMigrated()
  return loadIndex().sort((a, b) => {
    const aTime = a.lastPlayed || a.createdAt
    const bTime = b.lastPlayed || b.createdAt
    return bTime.localeCompare(aTime)
  })
}

export function getInstance(id: string): GameInstance | null {
  ensureMigrated()
  // After migration, UUID ids become names — also try decodeURIComponent for routes
  const decoded = (() => {
    try {
      return decodeURIComponent(id)
    } catch {
      return id
    }
  })()
  const list = loadIndex()
  return list.find((i) => i.id === id || i.id === decoded) ?? null
}

export function createInstance(input: {
  name: string
  gameVersion: string
  loader: LoaderType
  loaderVersion?: string
}): GameInstance {
  ensureMigrated()
  const instances = loadIndex()
  const displayName = input.name.trim() || `${input.loader} ${input.gameVersion}`
  const id = uniqueInstanceFolderName(displayName)

  const instance: GameInstance = {
    id,
    name: displayName,
    gameVersion: input.gameVersion,
    loader: input.loader,
    loaderVersion: input.loaderVersion,
    createdAt: new Date().toISOString(),
    mods: [],
    iconColor: pickColor(input.loader),
  }

  getInstanceDir(instance.id)
  getInstanceModsDir(instance.id)
  writeJsonFile(path.join(getInstanceDir(instance.id), 'instance.json'), instance)

  instances.push(instance)
  saveIndex(instances)
  return instance
}

export function updateInstance(id: string, patch: Partial<GameInstance>): GameInstance {
  // Renames must go through renameInstance so the folder stays in sync
  if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== getInstance(id)?.name) {
    const renamed = renameInstance(id, patch.name)
    const { name: _n, id: _i, ...rest } = patch
    if (Object.keys(rest).length === 0) return renamed
    return updateInstance(renamed.id, rest)
  }

  const instances = loadIndex()
  const idx = instances.findIndex((i) => i.id === id)
  if (idx < 0) throw new Error('Instance not found')

  instances[idx] = { ...instances[idx], ...patch, id: instances[idx].id }
  writeJsonFile(path.join(getInstanceDir(id), 'instance.json'), instances[idx])
  saveIndex(instances)
  return instances[idx]
}

/**
 * Rename instance display name and folder under eg-data/instances/.
 * Returns the updated instance (id may change to match folder).
 */
export function renameInstance(id: string, newName: string): GameInstance {
  ensureMigrated()
  const instances = loadIndex()
  const idx = instances.findIndex((i) => i.id === id || i.id === decodeURIComponentSafe(id))
  if (idx < 0) throw new Error('Instance not found')

  const displayName = newName.trim()
  if (!displayName) throw new Error('Name cannot be empty')

  const inst = instances[idx]
  const newId = uniqueInstanceFolderName(displayName, id)
  const oldDir = path.join(getInstancesDir(), id)
  const newDir = path.join(getInstancesDir(), newId)

  if (id !== newId) {
    if (!fs.existsSync(oldDir)) {
      // Create under new name if old missing
      ensureDir(newDir)
    } else if (fs.existsSync(newDir)) {
      throw new Error(`A folder named “${newId}” already exists`)
    } else {
      fs.renameSync(oldDir, newDir)
    }
    rewirePartnerInstanceIds(id, newId)
  }

  const updated: GameInstance = {
    ...inst,
    id: newId,
    name: displayName,
  }
  instances[idx] = updated
  writeJsonFile(path.join(getInstanceDir(newId), 'instance.json'), updated)
  saveIndex(instances)
  return updated
}

export function deleteInstance(id: string): void {
  const instances = loadIndex().filter((i) => i.id !== id)
  saveIndex(instances)
  const dir = path.join(getInstancesDir(), id)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function addModToInstance(instanceId: string, mod: InstalledMod): GameInstance {
  const instance = getInstance(instanceId)
  if (!instance) throw new Error('Instance not found')

  const mods = instance.mods.filter((m) => m.projectId !== mod.projectId)
  mods.push(mod)
  return updateInstance(instanceId, { mods })
}

export function removeModFromInstance(instanceId: string, projectId: string): GameInstance {
  const instance = getInstance(instanceId)
  if (!instance) throw new Error('Instance not found')

  const mod = instance.mods.find((m) => m.projectId === projectId)
  if (mod) {
    const filePath = path.join(getInstanceModsDir(instanceId), mod.fileName)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }

  return updateInstance(instanceId, {
    mods: instance.mods.filter((m) => m.projectId !== projectId),
  })
}

export function toggleMod(instanceId: string, projectId: string, enabled: boolean): GameInstance {
  const instance = getInstance(instanceId)
  if (!instance) throw new Error('Instance not found')

  const mods = instance.mods.map((m) => {
    if (m.projectId !== projectId) return m
    const modsDir = getInstanceModsDir(instanceId)
    const activePath = path.join(modsDir, m.fileName)
    const disabledPath = `${activePath}.disabled`

    try {
      if (enabled && fs.existsSync(disabledPath) && !fs.existsSync(activePath)) {
        fs.renameSync(disabledPath, activePath)
      } else if (!enabled && fs.existsSync(activePath) && !fs.existsSync(disabledPath)) {
        fs.renameSync(activePath, disabledPath)
      }
    } catch {
      // keep metadata in sync even if rename fails
    }

    return { ...m, enabled }
  })

  return updateInstance(instanceId, { mods })
}

function pickColor(loader: LoaderType): string {
  switch (loader) {
    case 'fabric':
      return '#dbb69b'
    case 'forge':
      return '#d2943e'
    case 'neoforge':
      return '#f16436'
    default:
      return '#1bd96a'
  }
}
