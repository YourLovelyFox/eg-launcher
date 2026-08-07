import type { GameInstance, InstalledMod } from './types'

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

export function offlineInstanceLimitMessage(currentCount: number): string {
  return (
    `Offline accounts are limited to ${OFFLINE_MAX_INSTANCES} instances ` +
    `(you have ${currentCount}). Sign in with Microsoft for full access.`
  )
}

export function offlineModLimitMessage(currentPrimary: number, tryingToAdd = 1): string {
  const room = Math.max(0, OFFLINE_MAX_PRIMARY_MODS - currentPrimary)
  if (tryingToAdd <= 1) {
    return (
      `Offline accounts are limited to ${OFFLINE_MAX_PRIMARY_MODS} mods per instance ` +
      `(dependencies do not count). You have ${currentPrimary}/${OFFLINE_MAX_PRIMARY_MODS}. ` +
      `Sign in with Microsoft for full access.`
    )
  }
  return (
    `Offline accounts are limited to ${OFFLINE_MAX_PRIMARY_MODS} mods per instance ` +
    `(dependencies do not count). You have ${currentPrimary}/${OFFLINE_MAX_PRIMARY_MODS} ` +
    `and only ${room} slot${room === 1 ? '' : 's'} free, but this action needs ${tryingToAdd}. ` +
    `Sign in with Microsoft for full access.`
  )
}

export function offlinePackModLimitMessage(packModCount: number): string {
  return (
    `This pack has ${packModCount} mods. Offline accounts may only add up to ` +
    `${OFFLINE_MAX_PRIMARY_MODS} mods per instance (dependencies excluded for catalog installs). ` +
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
