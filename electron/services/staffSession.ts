import { cmsRequest } from './cms/httpClient'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import path from 'path'

export type StaffRole = 'admin' | 'staff'

export type StaffInfo = {
  id: string
  username: string
  role: StaffRole
  offlineQuota: number
  offlineUsed: number
}

/** Idle timeout: 5 minutes without activity, then re-login. */
export const STAFF_SESSION_TTL_MS = 5 * 60 * 1000

type Stored = {
  staffSessionToken: string | null
  staff: StaffInfo | null
  /** Unix ms when the session becomes invalid (idle deadline) */
  expiresAt: number | null
}

function storePath(): string {
  return path.join(getDataRoot(), 'staff-session.json')
}

export function loadStaffSession(): Stored {
  const data = readJsonFile<Stored>(storePath(), {
    staffSessionToken: null,
    staff: null,
    expiresAt: null,
  })
  if (data.staffSessionToken && data.expiresAt && Date.now() >= data.expiresAt) {
    clearStaffSession()
    return { staffSessionToken: null, staff: null, expiresAt: null }
  }
  return data
}

export function saveStaffSession(data: Stored): void {
  writeJsonFile(storePath(), data)
}

export function clearStaffSession(): void {
  saveStaffSession({ staffSessionToken: null, staff: null, expiresAt: null })
}

export function getStaffSessionExpiresAt(): number | null {
  return loadStaffSession().expiresAt
}

/**
 * Reset the idle deadline (local). Call on user activity in Staff Menu.
 * Returns the new expiresAt, or null if no session.
 */
export function touchStaffSession(): number | null {
  const s = loadStaffSession()
  if (!s.staffSessionToken) return null
  if (s.expiresAt && Date.now() >= s.expiresAt) {
    clearStaffSession()
    return null
  }
  const expiresAt = Date.now() + STAFF_SESSION_TTL_MS
  saveStaffSession({
    staffSessionToken: s.staffSessionToken,
    staff: s.staff,
    expiresAt,
  })
  return expiresAt
}

export function getStaffSessionToken(): string | null {
  const s = loadStaffSession()
  if (!s.staffSessionToken) return null
  if (s.expiresAt && Date.now() >= s.expiresAt) {
    clearStaffSession()
    return null
  }
  return s.staffSessionToken
}

export function getStaffInfo(): StaffInfo | null {
  const s = loadStaffSession()
  if (!s.staffSessionToken) return null
  if (s.expiresAt && Date.now() >= s.expiresAt) {
    clearStaffSession()
    return null
  }
  return s.staff
}

export function isStaffAdmin(): boolean {
  return getStaffInfo()?.role === 'admin'
}

export async function staffLogin(
  username: string,
  password: string,
): Promise<{ ok: true; staff: StaffInfo; expiresAt: number } | { ok: false; error: string }> {
  try {
    const r = await cmsRequest<{
      ok?: boolean
      sessionToken?: string
      staff?: StaffInfo
      expiresIn?: number
      expiresAt?: string
      error?: string
    }>({
      path: 'staff.php?action=login',
      method: 'POST',
      body: { username, password },
    })
    if (!r.sessionToken || !r.staff) {
      return { ok: false, error: r.error || 'Login failed' }
    }
    const expiresAt =
      typeof r.expiresIn === 'number' && r.expiresIn > 0
        ? Date.now() + r.expiresIn * 1000
        : Date.now() + STAFF_SESSION_TTL_MS
    saveStaffSession({
      staffSessionToken: r.sessionToken,
      staff: r.staff,
      expiresAt,
    })
    return { ok: true, staff: r.staff, expiresAt }
  } catch (err) {
    return { ok: false, error: sanitizeAuthError((err as Error).message) }
  }
}

export async function staffLogout(): Promise<void> {
  const tok = getStaffSessionToken()
  if (tok) {
    try {
      await cmsRequest({
        path: 'staff.php?action=logout',
        method: 'POST',
        sessionToken: tok,
      })
    } catch {
      /* ignore */
    }
  }
  clearStaffSession()
}

export async function refreshStaffMe(): Promise<StaffInfo | null> {
  const tok = getStaffSessionToken()
  if (!tok) return null
  try {
    const r = await cmsRequest<{ staff?: StaffInfo; expiresIn?: number }>({
      path: 'staff.php?action=me',
      sessionToken: tok,
    })
    if (r.staff) {
      // Server slides session on me; keep local idle clock in sync
      const expiresAt =
        typeof r.expiresIn === 'number' && r.expiresIn > 0
          ? Date.now() + r.expiresIn * 1000
          : Date.now() + STAFF_SESSION_TTL_MS
      saveStaffSession({
        staffSessionToken: tok,
        staff: r.staff,
        expiresAt,
      })
      return r.staff
    }
  } catch {
    clearStaffSession()
  }
  return null
}

/**
 * Extend idle timeout on CMS (via me) + locally. Throttle at caller.
 */
export async function touchStaffSessionRemote(): Promise<number | null> {
  const local = touchStaffSession()
  if (!local) return null
  try {
    await refreshStaffMe()
    return getStaffSessionExpiresAt()
  } catch {
    return local
  }
}

function sanitizeAuthError(msg: string): string {
  if (/api key|admin key|cms key/i.test(msg)) {
    return 'Staff login required. Open Settings → Staff and sign in (idle timeout: 5 minutes).'
  }
  return msg
}
