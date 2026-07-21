import type { OfflineAuthFile, OfflineAuthUser } from '../../../shared/types'
import { cmsRequest } from '../cms/httpClient'

export type PartnerAuthRecord = {
  id: string
  username: string
  passwordHash: string
  newsTag: string
  displayName: string
}

/** Hashes never leave the server — client cannot list them. */
export async function listPartnerAuth(): Promise<PartnerAuthRecord[]> {
  return []
}

export async function getPartnerAuthByUsername(
  _username: string,
): Promise<PartnerAuthRecord | null> {
  return null
}

export async function upsertPartnerAuth(_rec: PartnerAuthRecord): Promise<void> {
  /* written with partners.php */
}

export async function deletePartnerAuth(_id: string): Promise<void> {
  /* written with partners.php delete */
}

export async function loadOfflineAuthFromDb(): Promise<OfflineAuthFile> {
  try {
    const st = await cmsRequest<{ unlockConfigured?: boolean }>({
      path: 'offline_auth.php?action=status',
    })
    return {
      version: 1,
      unlockPasswordHash: st.unlockConfigured ? 'configured' : null,
      users: [],
    }
  } catch {
    return { version: 1, unlockPasswordHash: null, users: [] }
  }
}

export async function saveOfflineAuthToDb(_file: OfflineAuthFile): Promise<void> {
  throw new Error('Use Admin offline API actions')
}

export async function cmsOfflineUnlock(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await cmsRequest({
      path: 'offline_auth.php?action=unlock',
      method: 'POST',
      body: { password },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function cmsOfflineLogin(
  username: string,
  password: string,
): Promise<
  | {
      ok: true
      account: {
        id: string
        username: string
        uuid: string
        displayName: string
        type: 'offline'
      }
    }
  | { ok: false; error: string }
> {
  try {
    const r = await cmsRequest<{
      account?: {
        id: string
        username: string
        uuid: string
        displayName: string
      }
      error?: string
    }>({
      path: 'offline_auth.php?action=login',
      method: 'POST',
      body: { username, password },
    })
    if (!r.account) return { ok: false, error: r.error || 'Login failed' }
    return {
      ok: true,
      account: {
        id: r.account.id,
        username: r.account.username,
        uuid: r.account.uuid,
        displayName: r.account.displayName,
        type: 'offline',
      },
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function cmsListOfflineUsersAdmin(): Promise<{
  ok: true
  users: Array<Omit<OfflineAuthUser, 'passwordHash'>>
  unlockPasswordConfigured: boolean
  remoteSynced: boolean
}> {
  const r = await cmsRequest<{
    users?: Array<{
      id: string
      username: string
      uuid: string
      displayName: string
      createdAt: string
    }>
    unlockPasswordConfigured?: boolean
  }>({ path: 'offline_auth.php?action=list', admin: true })
  return {
    ok: true,
    users: (r.users || []).map((u) => ({
      id: u.id,
      username: u.username,
      uuid: u.uuid,
      displayName: u.displayName,
      createdAt: u.createdAt,
    })),
    unlockPasswordConfigured: Boolean(r.unlockPasswordConfigured),
    remoteSynced: true,
  }
}

export async function cmsSetOfflineUnlock(
  password: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const r = await cmsRequest<{ message?: string }>({
      path: 'offline_auth.php?action=set_unlock',
      method: 'POST',
      admin: true,
      body: { password },
    })
    return { ok: true, message: r.message || 'Unlock password set' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function cmsCreateOfflineUser(
  username: string,
  password: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const r = await cmsRequest<{ message?: string }>({
      path: 'offline_auth.php?action=create_user',
      method: 'POST',
      admin: true,
      body: { username, password },
    })
    return { ok: true, message: r.message || 'User created' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function cmsDeleteOfflineUser(
  id: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const r = await cmsRequest<{ message?: string }>({
      path: 'offline_auth.php?action=delete_user',
      method: 'POST',
      admin: true,
      body: { id },
    })
    return { ok: true, message: r.message || 'User deleted' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
