import type { GameInstance, InstalledMod, MinecraftAccount } from './types'

/** Offline (non-premium) accounts: hard caps for a light free tier. */
export const OFFLINE_MAX_INSTANCES = 2
/** User-chosen mods per instance. Required dependency mods do not count. */
export const OFFLINE_MAX_PRIMARY_MODS = 10

export function isPrimaryMod(mod: InstalledMod): boolean {
  return mod.isDependency !== true
}

export function countPrimaryMods(mods: InstalledMod[] | undefined | null): number {
  if (!mods?.length) return 0
  return mods.filter(isPrimaryMod).length
}

export function quotasForAccount(
  account: MinecraftAccount | null | undefined,
): { instances: number; mods: number } {
  const offline =
    account?.type === 'offline' || String(account?.id || '').startsWith('offline-')
  if (!account || !offline) {
    return { instances: Number.MAX_SAFE_INTEGER, mods: Number.MAX_SAFE_INTEGER }
  }
  const instances = Number(account.instanceQuota)
  const mods = Number(account.modQuota)
  return {
    instances: Number.isFinite(instances) ? Math.max(0, Math.floor(instances)) : OFFLINE_MAX_INSTANCES,
    mods: Number.isFinite(mods) ? Math.max(0, Math.floor(mods)) : OFFLINE_MAX_PRIMARY_MODS,
  }
}

export function offlineInstanceLimitMessage(currentCount: number, max = OFFLINE_MAX_INSTANCES): string {
  return (
    `Offline accounts are limited to ${max} instances ` +
    `(you have ${currentCount}). Sign in with Microsoft for full access.`
  )
}

export function offlineModLimitMessage(
  currentPrimary: number,
  tryingToAdd = 1,
  max = OFFLINE_MAX_PRIMARY_MODS,
): string {
  const room = Math.max(0, max - currentPrimary)
  if (tryingToAdd <= 1) {
    return (
      `Offline accounts are limited to ${max} mods per instance ` +
      `(dependencies do not count). You have ${currentPrimary}/${max}. ` +
      `Sign in with Microsoft for full access.`
    )
  }
  return (
    `Offline accounts are limited to ${max} mods per instance ` +
    `(dependencies do not count). You have ${currentPrimary}/${max} ` +
    `and only ${room} slot${room === 1 ? '' : 's'} free, but this action needs ${tryingToAdd}. ` +
    `Sign in with Microsoft for full access.`
  )
}

export function offlinePackModLimitMessage(
  packModCount: number,
  max = OFFLINE_MAX_PRIMARY_MODS,
): string {
  return (
    `This pack has ${packModCount} mods. Offline accounts may only add up to ` +
    `${max} mods per instance (dependencies excluded for catalog installs). ` +
    `Sign in with Microsoft to install larger packs.`
  )
}

/** How many *new* primary slots an install would consume (existing projectIds reuse a slot). */
export function newPrimarySlotsNeeded(
  instance: GameInstance,
  projectIds: string[],
): number {
  const existing = new Set(instance.mods.map((m) => m.projectId))
  let n = 0
  for (const id of projectIds) {
    if (!id) continue
    if (!existing.has(id)) n++
  }
  return n
}
