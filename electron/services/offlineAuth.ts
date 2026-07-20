import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  AUTH_OFFLINE_PRIVATE,
  AUTH_OFFLINE_PUBLIC,
  CONTENT_BRANCH,
  CONTENT_OWNER,
  CONTENT_REPO,
  PUBLIC_BRANCH,
  PUBLIC_OWNER,
  PUBLIC_REPO,
} from '../../shared/contentRepo'
import type { MinecraftAccount, OfflineAuthFile, OfflineAuthUser } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import { getRepoFileText, putRepoFile } from './githubContent'
import { loadDevGithubToken } from './devToken'
import { loadSettings, saveSettings } from './settings'
import {
  getAccounts,
  getActiveAccountSecret,
  removeAccount,
  setActiveAccount,
  upsertAccount,
} from './auth'

const OFFLINE_SALT = 'eg-offline-auth-v1'
const UNLOCK_SALT = 'eg-offline-unlock-v1'

function stripBom(text: string): string {
  if (!text) return text
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text.replace(/^\uFEFF/, '')
}

function localAuthPath(): string {
  return path.join(getDataRoot(), 'offline-auth.json')
}

function emptyFile(): OfflineAuthFile {
  return { version: 1, unlockPasswordHash: null, users: [] }
}

export function hashOfflinePassword(username: string, password: string): string {
  return crypto
    .createHash('sha256')
    .update(`${OFFLINE_SALT}:${username.trim().toLowerCase()}:${password}`)
    .digest('hex')
}

export function hashUnlockPassword(password: string): string {
  return crypto.createHash('sha256').update(`${UNLOCK_SALT}:${password}`).digest('hex')
}

function hashesMatch(expectedHex: string, actualHex: string): boolean {
  const a = Buffer.from(expectedHex.trim().toLowerCase(), 'utf8')
  const b = Buffer.from(actualHex.trim().toLowerCase(), 'utf8')
  if (a.length !== b.length || a.length === 0) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Classic Minecraft offline UUID (nameUUIDFromBytes of "OfflinePlayer:" + name).
 */
export function offlineUuidFromUsername(username: string): string {
  const data = Buffer.from(`OfflinePlayer:${username}`, 'utf8')
  const md5 = crypto.createHash('md5').update(data).digest()
  md5[6] = (md5[6]! & 0x0f) | 0x30
  md5[8] = (md5[8]! & 0x3f) | 0x80
  const hex = md5.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function normalizeFile(raw: unknown): OfflineAuthFile {
  const data = (raw || {}) as Partial<OfflineAuthFile>
  const users = Array.isArray(data.users)
    ? data.users
        .filter((u) => u && u.username && u.passwordHash)
        .map((u) => ({
          id: String(u.id || crypto.randomBytes(8).toString('hex')),
          username: String(u.username).trim(),
          passwordHash: String(u.passwordHash).trim().toLowerCase(),
          uuid: String(u.uuid || offlineUuidFromUsername(String(u.username))).trim(),
          displayName: String(u.displayName || u.username).trim(),
          createdAt: String(u.createdAt || new Date().toISOString()),
        }))
    : []
  return {
    version: 1,
    unlockPasswordHash: data.unlockPasswordHash
      ? String(data.unlockPasswordHash).trim().toLowerCase()
      : null,
    users,
  }
}

function loadLocalFile(): OfflineAuthFile {
  return normalizeFile(readJsonFile<OfflineAuthFile>(localAuthPath(), emptyFile()))
}

function saveLocalFile(file: OfflineAuthFile): void {
  writeJsonFile(localAuthPath(), file)
}

function serializeFile(file: OfflineAuthFile): string {
  return JSON.stringify(
    {
      version: 1 as const,
      unlockPasswordHash: file.unlockPasswordHash,
      users: file.users.map((u) => ({
        id: u.id,
        username: u.username,
        passwordHash: u.passwordHash,
        uuid: u.uuid,
        displayName: u.displayName,
        createdAt: u.createdAt,
      })),
    },
    null,
    2,
  ) + '\n'
}

/** Merge users by lowercase username; prefer `preferred` entry on conflict. */
function mergeUsers(base: OfflineAuthUser[], extra: OfflineAuthUser[]): OfflineAuthUser[] {
  const map = new Map<string, OfflineAuthUser>()
  for (const u of base) map.set(u.username.toLowerCase(), u)
  for (const u of extra) map.set(u.username.toLowerCase(), u)
  return [...map.values()].sort((a, b) => a.username.localeCompare(b.username))
}

async function fetchRemoteFile(): Promise<OfflineAuthFile | null> {
  const token = loadDevGithubToken()
  const publicFile = await getRepoFileText({
    token: token || undefined,
    owner: PUBLIC_OWNER,
    repo: PUBLIC_REPO,
    branch: PUBLIC_BRANCH,
    path: AUTH_OFFLINE_PUBLIC,
  })
  if (publicFile.ok) {
    try {
      return normalizeFile(JSON.parse(stripBom(publicFile.text)))
    } catch {
      /* fall through */
    }
  }
  if (token) {
    const priv = await getRepoFileText({
      token,
      owner: CONTENT_OWNER,
      repo: CONTENT_REPO,
      branch: CONTENT_BRANCH,
      path: AUTH_OFFLINE_PRIVATE,
    })
    if (priv.ok) {
      try {
        return normalizeFile(JSON.parse(stripBom(priv.text)))
      } catch {
        /* fall through */
      }
    }
  }
  return null
}

/**
 * Combined auth file: local users + remote users + unlock hash from remote (else local).
 */
export async function loadOfflineAuthFile(): Promise<OfflineAuthFile> {
  const local = loadLocalFile()
  const remote = await fetchRemoteFile()
  if (!remote) return local
  return {
    version: 1,
    unlockPasswordHash: remote.unlockPasswordHash || local.unlockPasswordHash,
    users: mergeUsers(remote.users, local.users),
  }
}

export async function publishOfflineAuthFile(
  file: OfflineAuthFile,
): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> {
  const token = loadDevGithubToken()
  if (!token) {
    return {
      ok: false,
      error: 'GitHub token required to publish offline auth (set admin.local.json githubToken).',
    }
  }
  const content = serializeFile(file)
  const priv = await putRepoFile({
    token,
    owner: CONTENT_OWNER,
    repo: CONTENT_REPO,
    branch: CONTENT_BRANCH,
    path: AUTH_OFFLINE_PRIVATE,
    content,
    message: 'chore(auth): update offline users',
  })
  if (!priv.ok) return priv

  const pub = await putRepoFile({
    token,
    owner: PUBLIC_OWNER,
    repo: PUBLIC_REPO,
    branch: PUBLIC_BRANCH,
    path: AUTH_OFFLINE_PUBLIC,
    content,
    message: 'chore(auth): mirror offline-auth.json',
  })
  if (!pub.ok) return pub

  saveLocalFile(file)
  return {
    ok: true,
    message: 'Offline auth published to private + public GitHub repos',
    commitUrl: pub.commitUrl || priv.commitUrl,
  }
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

/**
 * Unlock hidden offline mode with password. Checks local then remote unlock hash.
 * If no unlock hash exists yet and a bootstrap password is in admin.local / env, accept once.
 */
export async function unlockOfflineMode(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = (password || '').trim()
  if (!p) return { ok: false, error: 'Enter the offline unlock password' }

  const file = await loadOfflineAuthFile()
  const attempt = hashUnlockPassword(p)

  if (file.unlockPasswordHash) {
    if (!hashesMatch(file.unlockPasswordHash, attempt)) {
      return { ok: false, error: 'Incorrect password' }
    }
  } else {
    // Bootstrap: allow unlock if Admin has not set a password yet, using admin.local.json
    const bootstrap = loadBootstrapUnlockPassword()
    if (!bootstrap || bootstrap !== p) {
      return {
        ok: false,
        error:
          'Offline unlock password is not configured yet. An Admin must set it under Admin → Offline accounts.',
      }
    }
    // Persist bootstrap as the unlock hash locally so next time works offline
    const next: OfflineAuthFile = { ...file, unlockPasswordHash: attempt }
    saveLocalFile(next)
  }

  const settings = loadSettings()
  saveSettings({ ...settings, offlineModeEnabled: true })
  return { ok: true }
}

export function lockOfflineMode(): void {
  const settings = loadSettings()
  saveSettings({ ...settings, offlineModeEnabled: false })
}

function loadBootstrapUnlockPassword(): string | null {
  try {
    // admin.local.json next to app / cwd (same as admin unlock patterns)
    const candidates = [
      path.join(process.cwd(), 'admin.local.json'),
      path.join(appPathNearby(), 'admin.local.json'),
    ]
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
          offlineUnlockPassword?: string
        }
        if (raw.offlineUnlockPassword && String(raw.offlineUnlockPassword).trim()) {
          return String(raw.offlineUnlockPassword).trim()
        }
      } catch {
        /* try next */
      }
    }
  } catch {
    /* ignore */
  }
  if (process.env.EG_OFFLINE_UNLOCK_PASSWORD) {
    return process.env.EG_OFFLINE_UNLOCK_PASSWORD
  }
  return null
}

function appPathNearby(): string {
  try {
    // Dynamic import avoided — electron app may already be ready in main process
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
  const p = (newPassword || '').trim()
  if (p.length < 4) return { ok: false, error: 'Unlock password must be at least 4 characters' }
  const file = await loadOfflineAuthFile()
  file.unlockPasswordHash = hashUnlockPassword(p)
  saveLocalFile(file)
  const pub = await publishOfflineAuthFile(file)
  if (!pub.ok) {
    return {
      ok: true,
      message: `Unlock password saved locally. GitHub publish failed: ${pub.error}`,
    }
  }
  return { ok: true, message: 'Unlock password set and published to GitHub' }
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

/** Offline account creation is Admin-only via `adminCreateOfflineUser`. */

export async function loginOfflineAccount(
  username: string,
  password: string,
): Promise<
  | { ok: true; account: MinecraftAccount }
  | { ok: false; error: string }
> {
  const gate = assertOfflineUnlocked()
  if (!gate.ok) return gate

  const u = (username || '').trim()
  const p = (password || '').trim()
  if (!u || !p) return { ok: false, error: 'Enter username and password' }

  const file = await loadOfflineAuthFile()
  const rec = file.users.find((x) => x.username.toLowerCase() === u.toLowerCase())
  if (!rec) return { ok: false, error: 'Invalid credentials' }

  const hash = hashOfflinePassword(rec.username, p)
  if (!hashesMatch(rec.passwordHash, hash)) {
    return { ok: false, error: 'Invalid credentials' }
  }

  // Ensure local copy for next offline session
  const local = loadLocalFile()
  local.users = mergeUsers(local.users, [rec])
  if (file.unlockPasswordHash) local.unlockPasswordHash = file.unlockPasswordHash
  saveLocalFile(local)

  const account = materializeOfflineAccount(rec)
  upsertAccount(account)
  setActiveAccount(account.id)
  return { ok: true, account: { ...account, accessToken: '***' } }
}

function materializeOfflineAccount(rec: OfflineAuthUser): MinecraftAccount {
  return {
    id: rec.id,
    username: rec.username,
    uuid: rec.uuid.replace(/-/g, ''),
    accessToken: crypto.randomBytes(16).toString('hex'),
    type: 'offline',
  }
}

export async function listOfflineUsersAdmin(): Promise<{
  ok: true
  users: Array<Omit<OfflineAuthUser, 'passwordHash'>>
  unlockPasswordConfigured: boolean
  remoteSynced: boolean
}> {
  const file = await loadOfflineAuthFile()
  return {
    ok: true,
    users: file.users.map(({ passwordHash: _h, ...rest }) => rest),
    unlockPasswordConfigured: Boolean(file.unlockPasswordHash),
    remoteSynced: Boolean(loadDevGithubToken()),
  }
}

export async function adminCreateOfflineUser(
  username: string,
  password: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  // Admin path: temporarily allow register without client unlock
  const u = (username || '').trim()
  const p = (password || '').trim()
  if (!u || u.length < 3 || u.length > 16) {
    return { ok: false, error: 'Username must be 3–16 characters' }
  }
  if (!/^[A-Za-z0-9_]+$/.test(u)) {
    return { ok: false, error: 'Username may only contain letters, numbers, and underscores' }
  }
  if (p.length < 4) return { ok: false, error: 'Password must be at least 4 characters' }

  const file = await loadOfflineAuthFile()
  if (file.users.some((x) => x.username.toLowerCase() === u.toLowerCase())) {
    return { ok: false, error: 'That username already exists' }
  }
  const rec: OfflineAuthUser = {
    id: `offline-${crypto.randomBytes(8).toString('hex')}`,
    username: u,
    passwordHash: hashOfflinePassword(u, p),
    uuid: offlineUuidFromUsername(u),
    displayName: u,
    createdAt: new Date().toISOString(),
  }
  file.users = mergeUsers(file.users, [rec])
  saveLocalFile(file)
  const pub = await publishOfflineAuthFile(file)
  if (!pub.ok) {
    return { ok: true, message: `User created locally. GitHub: ${pub.error}` }
  }
  return { ok: true, message: `User “${u}” created and published to GitHub` }
}

export async function adminDeleteOfflineUser(
  userId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const file = await loadOfflineAuthFile()
  const before = file.users.length
  file.users = file.users.filter((u) => u.id !== userId)
  if (file.users.length === before) return { ok: false, error: 'User not found' }
  saveLocalFile(file)
  // Remove from launcher accounts if present
  try {
    removeAccount(userId)
  } catch {
    /* ignore */
  }
  const pub = await publishOfflineAuthFile(file)
  if (!pub.ok) {
    return { ok: true, message: `Deleted locally. GitHub: ${pub.error}` }
  }
  return { ok: true, message: 'User deleted and published' }
}

export async function adminPublishOfflineAuth(): Promise<
  { ok: true; message: string; commitUrl?: string } | { ok: false; error: string }
> {
  const file = await loadOfflineAuthFile()
  return publishOfflineAuthFile(file)
}

export function isOfflineAccount(account: MinecraftAccount | null | undefined): boolean {
  if (!account) return false
  if (account.type === 'offline') return true
  // Heuristic: offline ids we mint
  return account.id.startsWith('offline-')
}

export function getActiveAccountKind(): 'none' | 'microsoft' | 'offline' {
  const acc = getActiveAccountSecret()
  if (!acc) return 'none'
  return isOfflineAccount(acc) ? 'offline' : 'microsoft'
}

export function offlineMultiplayerWarning(): string {
  return (
    'You are using an offline (non-premium) account. You cannot join official Minecraft servers, ' +
    'Realms, or servers that require a paid Microsoft/Minecraft login. Use cracked-friendly / offline ' +
    'servers only. Bee’s SMP requires a paid Microsoft account and cannot be installed while offline.'
  )
}

/** For UI: public status without secrets */
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
