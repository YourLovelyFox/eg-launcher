import type { GameInstance, InstalledMod, LoaderType, ModrinthVersion } from '../shared/types'

export type ModUpdateInfo = {
  projectId: string
  hasUpdate: boolean
  latestVersionId: string | null
  latestVersionNumber: string | null
  installedVersionId: string
  installedVersionNumber: string
  checking?: boolean
  error?: string
}

export async function fetchLatestCompatibleVersion(
  projectId: string,
  gameVersion?: string,
  loader?: LoaderType | string,
): Promise<ModrinthVersion | null> {
  const list = await window.hive.modrinth.versions(
    projectId,
    gameVersion,
    loader && loader !== 'vanilla' ? loader : undefined,
  )
  return list[0] ?? null
}

export async function checkModUpdate(
  mod: InstalledMod,
  gameVersion?: string,
  loader?: LoaderType | string,
): Promise<ModUpdateInfo> {
  try {
    const latest = await fetchLatestCompatibleVersion(mod.projectId, gameVersion, loader)
    if (!latest) {
      return {
        projectId: mod.projectId,
        hasUpdate: false,
        latestVersionId: null,
        latestVersionNumber: null,
        installedVersionId: mod.versionId,
        installedVersionNumber: mod.versionNumber,
      }
    }
    return {
      projectId: mod.projectId,
      hasUpdate: latest.id !== mod.versionId,
      latestVersionId: latest.id,
      latestVersionNumber: latest.version_number,
      installedVersionId: mod.versionId,
      installedVersionNumber: mod.versionNumber,
    }
  } catch (err) {
    return {
      projectId: mod.projectId,
      hasUpdate: false,
      latestVersionId: null,
      latestVersionNumber: null,
      installedVersionId: mod.versionId,
      installedVersionNumber: mod.versionNumber,
      error: (err as Error).message,
    }
  }
}

export async function checkModsUpdates(
  mods: InstalledMod[],
  gameVersion?: string,
  loader?: LoaderType | string,
  concurrency = 6,
): Promise<Record<string, ModUpdateInfo>> {
  const result: Record<string, ModUpdateInfo> = {}
  let cursor = 0

  async function worker() {
    while (cursor < mods.length) {
      const i = cursor++
      const mod = mods[i]
      result[mod.projectId] = await checkModUpdate(mod, gameVersion, loader)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, mods.length || 1) }, () => worker()))
  return result
}

export function installedModMap(instance: GameInstance | null): Map<string, InstalledMod> {
  const map = new Map<string, InstalledMod>()
  if (!instance) return map
  for (const mod of instance.mods) {
    map.set(mod.projectId, mod)
  }
  return map
}
