/**
 * Staff Menu is available in every build.
 * Access is gated by CMS staff accounts (login), not local unlock files.
 */

export type AdminUnlockInfo = {
  unlocked: boolean
  reason: string
  checkedPaths: string[]
}

/** Always true — no local unlock file required. */
export function isAdminUnlocked(): boolean {
  return true
}

export function getAdminUnlockInfo(): AdminUnlockInfo {
  return {
    unlocked: true,
    reason: 'Staff Menu uses CMS staff accounts (Settings → Staff).',
    checkedPaths: [],
  }
}

/** Staff Menu IPC is always registered. */
export function isAdminAvailable(): boolean {
  return true
}
