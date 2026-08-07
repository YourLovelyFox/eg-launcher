import crypto from 'crypto'
import path from 'path'
import type {
  GameInstance,
  MinecraftAccount,
  OfflineAuthFile,
  OfflineAuthUser,
} from '../../shared/types'
import {
  OFFLINE_MAX_INSTANCES,
  OFFLINE_MAX_PRIMARY_MODS,
  countPrimaryMods,
  offlineInstanceLimitMessage,
  offlineModLimitMessage,
  offlinePackModLimitMessage,
} from '../../shared/offlineLimits'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import {
  cmsCreateOfflineUser,
  cmsDeleteOfflineUser,
  cmsListOfflineUsersAdmin,
  cmsOfflineLogin,
  cmsOfflinePublicStatus,
  loadOfflineAuthFromDb,
} from './db/authRepo'
import { getStaffSessionToken } from './staffSession'
import { loadSettings, saveSettings } from './settings'
import {
  getAccounts,
  removeAccount,
  setActiveAccount,
  upsertAccount,
} from './auth'

function localAuthPath(): string {
  return path.join(getDataRoot(), 'offline-auth.json')
}

function emptyFile(): OfflineAuthFile {
  return { version: 1, unlockPasswordHash: null, users: [] }
}

function loadLocalFile(): OfflineAuthFile {
  return readJsonFile<OfflineAuthFile>(localAuthPath(), emptyFile())
}

function saveLocalFile(file: OfflineAuthFile): void {
  writeJsonFile(localAuthPath(), file)
}

export function offlineUuidFromUsername(username: string): string {
  const data = Buffer.from(`OfflinePlayer:${username}`, 'utf8')
  const md5 = crypto.createHash('md5').update(data).digest()
  md5[6] = (md5[6]! & 0x0f) | 0x30
  md5[8] = (md5[8]! & 0x3f) | 0x80
  const hex = md5.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function loadOfflineAuthFile(): Promise<OfflineAuthFile> {
  const local = loadLocalFile()
  try {
    const remote = await loadOfflineAuthFromDb()
    const merged: OfflineAuthFile = {
      version: 1,
      unlockPasswordHash: remote.unlockPasswordHash || local.unlockPasswordHash,
      users: local.users,
    }
    saveLocalFile(merged)
    return merged
  } catch {
    return local
  }
}

export async function publishOfflineAuthFile(
  _file: OfflineAuthFile,
): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> {
  return { ok: true, message: 'Offline auth managed via secure CMS API' }
}

/** Offline login is always available (no Settings unlock / hidden mode). */
export function isOfflineModeEnabled(): boolean {
  return true
}

export function getOfflineModeStatus(): {
  enabled: boolean
  hasUnlockPasswordConfigured: boolean
} {
  return {
    enabled: true,
    hasUnlockPasswordConfigured: false,
  }
}

/** @deprecated Unlock password removed — always succeeds. */
export async function unlockOfflineMode(
  _password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  saveSettings({ ...loadSettings(), offlineModeEnabled: true })
  return { ok: true }
}

/** @deprecated Lock removed — offline stays available. */
export function lockOfflineMode(): void {
  saveSettings({ ...loadSettings(), offlineModeEnabled: true })
}

/** @deprecated Unlock password removed. */
export async function setOfflineUnlockPassword(
  _newPassword: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  return {
    ok: true,
    message: 'Offline unlock password is no longer used — offline login is always available',
  }
}

export async function loginOfflineAccount(
  username: string,
  password: string,
): Promise<{ ok: true; account: MinecraftAccount } | { ok: false; error: string }> {
  const u = (username || '').trim()
  const p = (password || '').trim()
  if (!u || !p) return { ok: false, error: 'Enter username and password' }

  const res = await cmsOfflineLogin(u, p)
  if (!res.ok) return res

  const account: MinecraftAccount = {
    id: res.account.id,
    username: res.account.username,
    uuid: res.account.uuid.replace(/-/g, ''),
    accessToken: crypto.randomBytes(16).toString('hex'),
    type: 'offline',
  }
  upsertAccount(account)
  setActiveAccount(account.id)
  return { ok: true, account: { ...account, accessToken: '***' } }
}

/**
 * Staff Offline Accounts panel.
 * Distinguishes real CMS downtime from expired staff session / auth errors.
 */
export async function listOfflineUsersAdmin(): Promise<
  | {
      ok: true
      users: Array<Omit<OfflineAuthUser, 'passwordHash'>>
      unlockPasswordConfigured: boolean
      remoteSynced: boolean
      cmsOnline: boolean
      userCount: number
      error?: string
    }
  | { ok: false; error: string; cmsOnline: boolean }
> {
  // 1) Public probe — proves the CMS host + offline_auth.php + DB are up
  let publicStatus: { unlockConfigured: boolean; userCount: number } | null = null
  try {
    const st = await cmsOfflinePublicStatus()
    publicStatus = { unlockConfigured: st.unlockConfigured, userCount: st.userCount }
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message || 'CMS offline or unreachable',
      cmsOnline: false,
    }
  }

  // 2) Staff list — needs X-EG-Session from staff login
  if (!getStaffSessionToken()) {
    return {
      ok: true,
      users: [],
      unlockPasswordConfigured: publicStatus.unlockConfigured,
      remoteSynced: false,
      cmsOnline: true,
      userCount: publicStatus.userCount,
      error: 'Staff session missing — sign in again under Settings → Staff',
    }
  }

  try {
    const listed = await cmsListOfflineUsersAdmin(getStaffSessionToken())
    return {
      ...listed,
      userCount: listed.users.length,
    }
  } catch (err) {
    const msg = (err as Error).message || 'Failed to list offline users'
    return {
      ok: true,
      users: [],
      unlockPasswordConfigured: publicStatus.unlockConfigured,
      remoteSynced: false,
      cmsOnline: true,
      userCount: publicStatus.userCount,
      error: msg,
    }
  }
}

export async function adminCreateOfflineUser(
  username: string,
  password: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  return cmsCreateOfflineUser(username, password)
}

export async function adminDeleteOfflineUser(
  userId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    removeAccount(userId)
  } catch {
    /* ignore */
  }
  return cmsDeleteOfflineUser(userId)
}

export async function adminPublishOfflineAuth(): Promise<
  { ok: true; message: string; commitUrl?: string } | { ok: false; error: string }
> {
  return { ok: true, message: 'Offline auth is live on the CMS API' }
}

export function isOfflineAccount(account: MinecraftAccount | null | undefined): boolean {
  if (!account) return false
  if (account.type === 'offline') return true
  return account.id.startsWith('offline-')
}

export function getActiveAccountKind(): 'none' | 'microsoft' | 'offline' {
  const accounts = getAccounts()
  const active = accounts.accounts.find((a) => a.id === accounts.activeAccountId) || null
  if (!active) return 'none'
  return isOfflineAccount(active) ? 'offline' : 'microsoft'
}

export function offlineMultiplayerWarning(): string {
  return (
    'You are using an offline (non-premium) account. You cannot join official Minecraft servers, ' +
    'Realms, or servers that require a paid Microsoft/Minecraft login. Use cracked-friendly / offline ' +
    'servers only. Bee’s SMP requires a paid Microsoft account and cannot be installed while offline. ' +
    `Limits: up to ${OFFLINE_MAX_INSTANCES} instances and ${OFFLINE_MAX_PRIMARY_MODS} mods per instance ` +
    '(required dependencies do not count toward the mod limit). Sign in with Microsoft for full access.'
  )
}

/** True when the currently active launcher account is offline. */
export function isActiveAccountOffline(): boolean {
  return getActiveAccountKind() === 'offline'
}

/**
 * Offline tier: block creating another instance when already at the cap.
 * Call before createInstance / pack import that creates a new instance.
 */
export function assertOfflineCanCreateInstance(currentInstanceCount: number): void {
  if (!isActiveAccountOffline()) return
  if (currentInstanceCount >= OFFLINE_MAX_INSTANCES) {
    throw new Error(offlineInstanceLimitMessage(currentInstanceCount))
  }
}

/**
 * Offline tier: block adding new user-chosen (primary) mods over the per-instance cap.
 * @param newPrimaryCount how many *new* primary mods this action would add (not updates, not deps)
 */
export function assertOfflineCanAddPrimaryMods(
  instance: GameInstance,
  newPrimaryCount: number,
): void {
  if (!isActiveAccountOffline()) return
  if (newPrimaryCount <= 0) return
  const current = countPrimaryMods(instance.mods)
  if (current + newPrimaryCount > OFFLINE_MAX_PRIMARY_MODS) {
    throw new Error(offlineModLimitMessage(current, newPrimaryCount))
  }
}

/** Offline tier: pack install must fit within primary mod cap (all pack files count as primary). */
export function assertOfflineCanInstallPackModCount(packModCount: number): void {
  if (!isActiveAccountOffline()) return
  if (packModCount > OFFLINE_MAX_PRIMARY_MODS) {
    throw new Error(offlinePackModLimitMessage(packModCount))
  }
}

export function getOfflinePublicStatus() {
  const accounts = getAccounts()
  const active = accounts.accounts.find((a) => a.id === accounts.activeAccountId) || null
  return {
    offlineModeEnabled: true,
    unlockConfigured: false,
    activeIsOffline: isOfflineAccount(active),
    activeUsername: active?.username || null,
  }
}
