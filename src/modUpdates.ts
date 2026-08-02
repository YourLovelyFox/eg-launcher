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

/** Synthetic ids from pack disk-scan — not real Modrinth projects. */
export function isLocalOnlyModId(id: string | null | undefined): boolean {
  if (!id) return true
  return /^(local|import|disk|offline)-/i.test(id.trim())
}

export async function fetchLatestCompatibleVersion(
  projectId: string,
  gameVersion?: string,
  loader?: LoaderType | string,
): Promise<ModrinthVersion | null> {
  if (isLocalOnlyModId(projectId)) return null
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
  if (isLocalOnlyModId(mod.projectId)) {
    return {
      projectId: mod.projectId,
      hasUpdate: false,
      latestVersionId: null,
      latestVersionNumber: null,
      installedVersionId: mod.versionId,
      installedVersionNumber: mod.versionNumber,
    }
  }
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
  concurrency = 4,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, ModUpdateInfo>> {
  const result: Record<string, ModUpdateInfo> = {}

  // Local / synthetic mods never hit the API
  const remote: InstalledMod[] = []
  for (const mod of mods) {
    if (isLocalOnlyModId(mod.projectId)) {
      result[mod.projectId] = {
        projectId: mod.projectId,
        hasUpdate: false,
        latestVersionId: null,
        latestVersionNumber: null,
        installedVersionId: mod.versionId,
        installedVersionNumber: mod.versionNumber,
      }
    } else {
      remote.push(mod)
    }
  }

  const total = remote.length
  if (total === 0) {
    onProgress?.(0, 0)
    return result
  }

  let cursor = 0
  let finished = 0

  async function worker() {
    while (cursor < remote.length) {
      const i = cursor++
      const mod = remote[i]!
      result[mod.projectId] = await checkModUpdate(mod, gameVersion, loader)
      finished++
      onProgress?.(finished, total)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, remote.length) }, () => worker()),
  )
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
