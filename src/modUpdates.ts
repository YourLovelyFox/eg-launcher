import type { GameInstance, InstalledMod, LoaderType, CatalogVersion } from '../shared/types'

export type ModUpdateInfo = {
  projectId: string
  hasUpdate: boolean
  /** No catalog version exists for the instance's current Minecraft version + loader. */
  incompatible: boolean
  latestVersionId: string | null
  latestVersionNumber: string | null
  installedVersionId: string
  installedVersionNumber: string
  checking?: boolean
  error?: string
}

function baseInfo(mod: InstalledMod, extra?: Partial<ModUpdateInfo>): ModUpdateInfo {
  return {
    projectId: mod.projectId,
    hasUpdate: false,
    incompatible: false,
    latestVersionId: null,
    latestVersionNumber: null,
    installedVersionId: mod.versionId,
    installedVersionNumber: mod.versionNumber,
    ...extra,
  }
}

export function needsModAction(info: ModUpdateInfo): boolean {
  return info.hasUpdate || info.incompatible
}

/** Synthetic ids from pack disk-scan — not real mod projects. */
export function isLocalOnlyModId(id: string | null | undefined): boolean {
  if (!id) return true
  return /^(local|import|disk|offline)-/i.test(id.trim())
}

export async function fetchLatestCompatibleVersion(
  projectId: string,
  gameVersion?: string,
  loader?: LoaderType | string,
): Promise<CatalogVersion | null> {
  if (isLocalOnlyModId(projectId)) return null
  const list = await window.hive.mods.versions(
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
    return baseInfo(mod)
  }
  if (loader === 'vanilla') {
    return baseInfo(mod, { incompatible: true })
  }
  try {
    const latest = await fetchLatestCompatibleVersion(mod.projectId, gameVersion, loader)
    if (!latest) {
      return baseInfo(mod, { incompatible: true })
    }
    return baseInfo(mod, {
      hasUpdate: latest.id !== mod.versionId,
      latestVersionId: latest.id,
      latestVersionNumber: latest.version_number,
    })
  } catch (err) {
    return baseInfo(mod, { error: (err as Error).message })
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
      result[mod.projectId] = baseInfo(mod)
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
