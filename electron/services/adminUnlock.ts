import fs from 'fs'
import path from 'path'
import { isAdminBuild } from '../../shared/features'

/**
 * Admin is only available when:
 *  1) This is a Dev build (EG_ENABLE_ADMIN / npm run dev), AND
 *  2) A local unlock file exists on this PC (not in git)
 *
 * Clones of the public repo without the unlock file never see Admin.
 */

export type AdminUnlockInfo = {
  unlocked: boolean
  reason: string
  checkedPaths: string[]
}

function unlockCandidates(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return [
    path.join(process.cwd(), 'admin.local.json'),
    path.join(__dirname, '../../admin.local.json'),
    path.join(home, 'Desktop', 'New folder', 'eg-launcher-admin-unlock'),
    path.join(home, 'Desktop', 'New folder', 'eg-launcher-admin-unlock.txt'),
  ]
}

function fileUnlocksAdmin(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false
    if (filePath.endsWith('.json')) {
      const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
      const j = JSON.parse(raw) as { enableAdmin?: boolean }
      // Must explicitly enableAdmin: true (token alone is not enough)
      return j.enableAdmin === true
    }
    // Marker file: empty or any content unlocks
    return true
  } catch {
    return false
  }
}

/** True only on this machine when unlock file is present. */
export function isAdminUnlocked(): boolean {
  if (!isAdminBuild()) return false
  if (process.env.EG_ADMIN_UNLOCK === '1' || process.env.EG_ADMIN_UNLOCK === 'true') {
    return true
  }
  return unlockCandidates().some((p) => fileUnlocksAdmin(p))
}

export function getAdminUnlockInfo(): AdminUnlockInfo {
  if (!isAdminBuild()) {
    return {
      unlocked: false,
      reason: 'Live build — Admin is compiled out.',
      checkedPaths: [],
    }
  }
  if (process.env.EG_ADMIN_UNLOCK === '1' || process.env.EG_ADMIN_UNLOCK === 'true') {
    return {
      unlocked: true,
      reason: 'Unlocked via EG_ADMIN_UNLOCK env.',
      checkedPaths: unlockCandidates(),
    }
  }
  const paths = unlockCandidates()
  for (const p of paths) {
    if (fileUnlocksAdmin(p)) {
      return {
        unlocked: true,
        reason: `Unlocked via local file: ${p}`,
        checkedPaths: paths,
      }
    }
  }
  return {
    unlocked: false,
    reason:
      'No unlock file. Create admin.local.json with "enableAdmin": true, or Desktop\\New folder\\eg-launcher-admin-unlock',
    checkedPaths: paths,
  }
}

/** Admin fully available (Dev build + local unlock). */
export function isAdminAvailable(): boolean {
  return isAdminBuild() && isAdminUnlocked()
}
