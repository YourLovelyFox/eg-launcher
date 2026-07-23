import crypto from 'crypto'
import path from 'path'
import type { MinecraftAccount, OfflineAuthFile, OfflineAuthUser } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import {
  cmsCreateOfflineUser,
  cmsDeleteOfflineUser,
  cmsListOfflineUsersAdmin,
  cmsOfflineLogin,
  loadOfflineAuthFromDb,
} from './db/authRepo'
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

export async function listOfflineUsersAdmin(): Promise<{
  ok: true
  users: Array<Omit<OfflineAuthUser, 'passwordHash'>>
  unlockPasswordConfigured: boolean
  remoteSynced: boolean
}> {
  try {
    return await cmsListOfflineUsersAdmin()
  } catch {
    return { ok: true, users: [], unlockPasswordConfigured: false, remoteSynced: false }
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
    'servers only. Bee’s SMP requires a paid Microsoft account and cannot be installed while offline.'
  )
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
