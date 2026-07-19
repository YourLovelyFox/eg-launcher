import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { GameInstance, InstalledMod, LoaderType } from '../../shared/types'
import {
  getInstanceDir,
  getInstanceModsDir,
  getInstancesIndexPath,
  readJsonFile,
  writeJsonFile,
} from '../paths'

function loadIndex(): GameInstance[] {
  return readJsonFile<GameInstance[]>(getInstancesIndexPath(), [])
}

function saveIndex(instances: GameInstance[]): void {
  writeJsonFile(getInstancesIndexPath(), instances)
}

export function listInstances(): GameInstance[] {
  return loadIndex().sort((a, b) => {
    const aTime = a.lastPlayed || a.createdAt
    const bTime = b.lastPlayed || b.createdAt
    return bTime.localeCompare(aTime)
  })
}

export function getInstance(id: string): GameInstance | null {
  return loadIndex().find((i) => i.id === id) ?? null
}

export function createInstance(input: {
  name: string
  gameVersion: string
  loader: LoaderType
  loaderVersion?: string
}): GameInstance {
  const instances = loadIndex()
  const instance: GameInstance = {
    id: randomUUID(),
    name: input.name.trim() || `${input.loader} ${input.gameVersion}`,
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
  const instances = loadIndex()
  const idx = instances.findIndex((i) => i.id === id)
  if (idx < 0) throw new Error('Instance not found')

  instances[idx] = { ...instances[idx], ...patch, id }
  writeJsonFile(path.join(getInstanceDir(id), 'instance.json'), instances[idx])
  saveIndex(instances)
  return instances[idx]
}

export function deleteInstance(id: string): void {
  const instances = loadIndex().filter((i) => i.id !== id)
  saveIndex(instances)
  const dir = getInstanceDir(id)
  fs.rmSync(dir, { recursive: true, force: true })
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
