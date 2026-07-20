import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { DEFAULT_NEWS_FEED_URL } from '../../shared/branding'
import {
  AUTH_PARTNERS_PRIVATE,
  AUTH_PARTNERS_PUBLIC,
  FEED_LAUNCHER_PRIVATE,
  FEED_LAUNCHER_PUBLIC,
  FEED_PARTNERS_PRIVATE,
  FEED_PARTNERS_PUBLIC,
} from '../../shared/contentRepo'
import { isAdminBuild } from '../../shared/features'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import { isAdminAvailable, isAdminUnlocked } from './adminUnlock'
import { loadDevGithubToken } from './devToken'
import { privateRepo, publicRepo, putRepoFile } from './githubContent'
import { applyLocalFeedSnapshot, fetchNews } from './news'
import { mirrorPartnerAuthToPublic } from './partnerAuth'

type AdminSession = {
  token: string
  expiresAt: number
}

type AdminSecrets = {
  githubToken?: string
}

const sessions = new Map<string, AdminSession>()
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

function secretsPath(): string {
  return path.join(getDataRoot(), 'admin-secrets.json')
}

function loadSecrets(): AdminSecrets {
  const stored = readJsonFile<AdminSecrets>(secretsPath(), {})
  const fromDisk = loadDevGithubToken()
  if (fromDisk) return { ...stored, githubToken: fromDisk }
  return stored
}

function saveSecrets(s: AdminSecrets): void {
  if (!isAdminAvailable()) return
  writeJsonFile(secretsPath(), s)
}

export function assertAdminBuild(): { ok: true } | { ok: false; error: string } {
  if (!isAdminBuild()) {
    return { ok: false, error: 'Admin is not available in the public Live launcher.' }
  }
  if (!isAdminUnlocked()) {
    return {
      ok: false,
      error:
        'Admin is locked. Add admin.local.json with "enableAdmin": true (or Desktop\\New folder\\eg-launcher-admin-unlock).',
    }
  }
  return { ok: true }
}

function purgeExpiredSessions() {
  const now = Date.now()
  for (const [k, v] of sessions) {
    if (v.expiresAt < now) sessions.delete(k)
  }
}

/**
 * Dev Admin unlock — no password (Dev launcher only).
 * Kept as login() for API compatibility; Live builds never expose Admin.
 */
export function verifyAdminPassword(
  _password?: string,
): { ok: true; sessionToken: string } | { ok: false; error: string } {
  const gate = assertAdminBuild()
  if (!gate.ok) return gate

  purgeExpiredSessions()
  const sessionToken = crypto.randomBytes(24).toString('hex')
  sessions.set(sessionToken, {
    token: sessionToken,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })
  return { ok: true, sessionToken }
}

export function logoutAdmin(sessionToken: string): void {
  sessions.delete(sessionToken)
}

export function requireAdmin(sessionToken: string | undefined | null): boolean {
  if (!sessionToken) return false
  purgeExpiredSessions()
  const s = sessions.get(sessionToken)
  if (!s) return false
  // sliding expiry
  s.expiresAt = Date.now() + SESSION_TTL_MS
  return true
}

export function getAdminStatus(sessionToken: string | undefined | null) {
  const feedPath = `${FEED_LAUNCHER_PRIVATE} → ${FEED_LAUNCHER_PUBLIC}`
  const repo = `${privateRepo.owner}/${privateRepo.repo} + public mirror`
  if (!isAdminAvailable()) {
    return {
      authenticated: false,
      hasGithubToken: false,
      tokenFromLocalFile: false,
      feedPath,
      feedUrl: DEFAULT_NEWS_FEED_URL,
      repo,
      adminEnabled: false,
    }
  }
  const authed = requireAdmin(sessionToken)
  const secrets = loadSecrets()
  const fromDisk = Boolean(loadDevGithubToken())
  return {
    authenticated: authed,
    hasGithubToken: Boolean(secrets.githubToken && secrets.githubToken.length > 8),
    tokenFromLocalFile: fromDisk,
    feedPath,
    feedUrl: DEFAULT_NEWS_FEED_URL,
    repo,
    adminEnabled: true,
  }
}

export function setGithubToken(sessionToken: string, githubToken: string): { ok: boolean; error?: string } {
  if (!isAdminAvailable()) return { ok: false, error: 'Admin is locked or unavailable on this PC.' }
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  const t = (githubToken || '').trim()
  if (!t) {
    saveSecrets({ ...loadSecrets(), githubToken: undefined })
    return { ok: true }
  }
  saveSecrets({ ...loadSecrets(), githubToken: t })
  return { ok: true }
}

function buildFeedJson(items: NewsItem[], title = 'EG Launcher News'): string {
  const sorted = [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  const body = {
    version: 1,
    title,
    updated: new Date().toISOString(),
    items: sorted.map((i) => ({
      id: i.id,
      title: i.title,
      summary: i.summary || '',
      body: i.body || i.summary || '',
      date: i.date,
      tag: i.tag || 'info',
      url: i.url ?? null,
    })),
  }
  return JSON.stringify(body, null, 2) + '\n'
}

/**
 * Publish launcher Home news to:
 *  1) private CMS repo (eg-launcher-content)
 *  2) public mirror (eg-launcher/news/feed.json) for Live clients
 */
export async function publishNewsFeed(
  sessionToken: string,
  items: NewsItem[],
  title?: string,
): Promise<{ ok: true; commitUrl?: string; message: string } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }

  const token = loadSecrets().githubToken?.trim() || loadDevGithubToken()
  if (!token) {
    return {
      ok: false,
      error:
        'Add a GitHub Personal Access Token (Contents: Read & Write) for both eg-launcher and eg-launcher-content.',
    }
  }

  const content = buildFeedJson(items, title)
  const msg = `chore(news): launcher feed via EG Admin (${new Date().toISOString()})`

  const priv = await putRepoFile({
    token,
    ...privateRepo,
    path: FEED_LAUNCHER_PRIVATE,
    content,
    message: msg,
  })
  if (!priv.ok) return { ok: false, error: `Private CMS: ${priv.error}` }

  const pub = await putRepoFile({
    token,
    ...publicRepo,
    path: FEED_LAUNCHER_PUBLIC,
    content,
    message: msg,
  })
  if (!pub.ok) return { ok: false, error: `Public mirror: ${pub.error}` }

  // Best-effort: keep partner auth hashes mirrored for Live partner login
  await mirrorPartnerAuthToPublic().catch(() => undefined)

  // Pin local snapshot + push to UI — do NOT re-fetch GitHub here (can overwrite with stale CDN)
  applyLocalFeedSnapshot(content, 'launcher')

  try {
    const local = path.join(appPathGuess(), 'news', 'feed.json')
    if (fs.existsSync(path.dirname(local))) {
      fs.writeFileSync(local, content, 'utf8')
    }
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    commitUrl: pub.commitUrl || priv.commitUrl,
    message:
      'News published. This PC updates immediately; Live clients on the next poll (~few seconds).',
  }
}

function appPathGuess(): string {
  return path.join(__dirname, '../..')
}

/** Admin can also edit full partner feed if needed */
export async function publishPartnersFeedAsAdmin(
  sessionToken: string,
  items: NewsItem[],
  title?: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  const token = loadSecrets().githubToken?.trim() || loadDevGithubToken()
  if (!token) return { ok: false, error: 'GitHub token missing' }
  const content = buildFeedJson(items, title || 'EG Partner News')
  const msg = `chore(partners): full feed via EG Admin (${new Date().toISOString()})`
  const priv = await putRepoFile({
    token,
    ...privateRepo,
    path: FEED_PARTNERS_PRIVATE,
    content,
    message: msg,
  })
  if (!priv.ok) return { ok: false, error: priv.error }
  const pub = await putRepoFile({
    token,
    ...publicRepo,
    path: FEED_PARTNERS_PUBLIC,
    content,
    message: msg,
  })
  if (!pub.ok) return { ok: false, error: pub.error }
  applyLocalFeedSnapshot(content, 'partners')
  return { ok: true, message: 'Partner feed published. This PC updates immediately.' }
}

export async function loadNewsForAdmin(sessionToken: string): Promise<
  | { ok: true; feed: NewsFeedResult }
  | { ok: false; error: string }
> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  try {
    const feed = await fetchNews({ force: true })
    return { ok: true, feed }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function newNewsId(): string {
  return `news-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}
