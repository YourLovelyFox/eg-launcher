import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { MinecraftAccount, OfflineAuthFile, OfflineAuthUser } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import {
  cmsCreateOfflineUser,
  cmsDeleteOfflineUser,
  cmsListOfflineUsersAdmin,
  cmsOfflineLogin,
  cmsOfflineUnlock,
  cmsSetOfflineUnlock,
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

export function isOfflineModeEnabled(): boolean {
  return Boolean(loadSettings().offlineModeEnabled)
}

export function getOfflineModeStatus(): {
  enabled: boolean
  hasUnlockPasswordConfigured: boolean
} {
  const local = loadLocalFile()
  return {
    enabled: isOfflineModeEnabled(),
    hasUnlockPasswordConfigured: Boolean(local.unlockPasswordHash),
  }
}

export async function unlockOfflineMode(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = (password || '').trim()
  if (!p) return { ok: false, error: 'Enter the offline unlock password' }

  const remote = await cmsOfflineUnlock(p)
  if (!remote.ok) {
    const bootstrap = loadBootstrapUnlockPassword()
    if (bootstrap && bootstrap === p) {
      saveSettings({ ...loadSettings(), offlineModeEnabled: true })
      saveLocalFile({ version: 1, unlockPasswordHash: 'local-bootstrap', users: [] })
      return { ok: true }
    }
    return remote
  }

  saveSettings({ ...loadSettings(), offlineModeEnabled: true })
  saveLocalFile({
    version: 1,
    unlockPasswordHash: 'configured',
    users: loadLocalFile().users,
  })
  return { ok: true }
}

export function lockOfflineMode(): void {
  saveSettings({ ...loadSettings(), offlineModeEnabled: false })
}

function loadBootstrapUnlockPassword(): string | null {
  try {
    for (const p of [
      path.join(process.cwd(), 'admin.local.json'),
      path.join(appPathNearby(), 'admin.local.json'),
    ]) {
      try {
        if (!fs.existsSync(p)) continue
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { offlineUnlockPassword?: string }
        if (raw.offlineUnlockPassword?.trim()) return raw.offlineUnlockPassword.trim()
      } catch {
        /* next */
      }
    }
  } catch {
    /* ignore */
  }
  return process.env.EG_OFFLINE_UNLOCK_PASSWORD || null
}

function appPathNearby(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron')
    return electron.app?.getAppPath?.() || process.cwd()
  } catch {
    return process.cwd()
  }
}

export async function setOfflineUnlockPassword(
  newPassword: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  return cmsSetOfflineUnlock(newPassword)
}

function assertOfflineUnlocked(): { ok: true } | { ok: false; error: string } {
  if (!isOfflineModeEnabled()) {
    return {
      ok: false,
      error: 'Offline mode is locked. Unlock it in Settings (hidden) with the password first.',
    }
  }
  return { ok: true }
}

export async function loginOfflineAccount(
  username: string,
  password: string,
): Promise<{ ok: true; account: MinecraftAccount } | { ok: false; error: string }> {
  const gate = assertOfflineUnlocked()
  if (!gate.ok) return gate

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
  const settings = loadSettings()
  const local = loadLocalFile()
  const accounts = getAccounts()
  const active = accounts.accounts.find((a) => a.id === accounts.activeAccountId) || null
  return {
    offlineModeEnabled: Boolean(settings.offlineModeEnabled),
    unlockConfigured: Boolean(local.unlockPasswordHash) || Boolean(loadBootstrapUnlockPassword()),
    activeIsOffline: isOfflineAccount(active),
    activeUsername: active?.username || null,
  }
}
