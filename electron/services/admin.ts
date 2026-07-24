import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { resolveCmsApiBase } from '../../shared/cmsApi'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { setAdminApiKey } from './cms/httpClient'
import {
  clearStaffSession,
  getStaffInfo,
  getStaffSessionExpiresAt,
  getStaffSessionToken,
  STAFF_SESSION_TTL_MS,
  touchStaffSession,
  touchStaffSessionRemote,
} from './staffSession'
import { replaceFeedInDb } from './db/newsRepo'
import { applyLocalFeedSnapshot, fetchNews } from './news'

type AdminSession = {
  token: string
  expiresAt: number
}

const sessions = new Map<string, AdminSession>()
/** Idle timeout: 5 minutes without activity. */
const SESSION_TTL_MS = STAFF_SESSION_TTL_MS

export function assertAdminBuild(): { ok: true } | { ok: false; error: string } {
  // Staff Menu is always available; real auth is CMS staff login.
  return { ok: true }
}

function purgeExpiredSessions() {
  const now = Date.now()
  for (const [k, v] of sessions) {
    if (v.expiresAt < now) sessions.delete(k)
  }
}

/**
 * Local session after successful CMS staff login.
 * Password is not checked here — Staff Menu uses staffLogin() first.
 */
export function verifyAdminPassword(
  _password?: string,
): { ok: true; sessionToken: string; expiresAt: number } | { ok: false; error: string } {
  purgeExpiredSessions()
  // Align local expiry with CMS staff session if present
  const staffExp = getStaffSessionExpiresAt()
  const expiresAt = staffExp && staffExp > Date.now() ? staffExp : Date.now() + SESSION_TTL_MS
  const sessionToken = crypto.randomBytes(24).toString('hex')
  sessions.set(sessionToken, {
    token: sessionToken,
    expiresAt,
  })
  return { ok: true, sessionToken, expiresAt }
}

export function logoutAdmin(sessionToken: string): void {
  sessions.delete(sessionToken)
}

/** Slide idle deadline on activity (local admin + staff session). */
export function touchAdminSession(sessionToken: string | undefined | null): number | null {
  if (!sessionToken) return null
  purgeExpiredSessions()
  const s = sessions.get(sessionToken)
  if (!s) return null
  if (s.expiresAt <= Date.now()) {
    sessions.delete(sessionToken)
    clearStaffSession()
    return null
  }
  if (!getStaffSessionToken()) {
    sessions.delete(sessionToken)
    return null
  }
  const expiresAt = Date.now() + SESSION_TTL_MS
  s.expiresAt = expiresAt
  touchStaffSession()
  return expiresAt
}

let lastRemoteTouchMs = 0
const REMOTE_TOUCH_MIN_MS = 20_000

/**
 * Activity heartbeat: always slides local idle timer.
 * CMS session is extended at most every 20s so typing doesn't spam the server.
 */
export async function touchAdminSessionRemote(
  sessionToken: string | undefined | null,
): Promise<{ ok: true; expiresAt: number } | { ok: false; error: string }> {
  const local = touchAdminSession(sessionToken)
  if (!local) return { ok: false, error: 'Session expired' }
  const now = Date.now()
  if (now - lastRemoteTouchMs < REMOTE_TOUCH_MIN_MS) {
    return { ok: true, expiresAt: local }
  }
  lastRemoteTouchMs = now
  try {
    const remote = await touchStaffSessionRemote()
    const expiresAt = remote || local
    const s = sessions.get(sessionToken || '')
    if (s) s.expiresAt = expiresAt
    return { ok: true, expiresAt }
  } catch {
    return { ok: true, expiresAt: local }
  }
}

export function requireAdmin(sessionToken: string | undefined | null): boolean {
  if (!sessionToken) return false
  purgeExpiredSessions()
  const s = sessions.get(sessionToken)
  if (!s) return false
  if (s.expiresAt <= Date.now()) {
    sessions.delete(sessionToken)
    clearStaffSession()
    return false
  }
  // Staff CMS token must still be valid
  if (!getStaffSessionToken()) {
    sessions.delete(sessionToken)
    return false
  }
  // Any authenticated IPC use counts as activity (sliding idle)
  s.expiresAt = Date.now() + SESSION_TTL_MS
  touchStaffSession()
  return true
}

export function getAdminStatus(sessionToken: string | undefined | null) {
  const feedPath = 'HTTPS CMS API'
  const repo = resolveCmsApiBase().replace(/^https?:\/\//, '')
  const staffTok = getStaffSessionToken()
  const staff = getStaffInfo()
  const authed = requireAdmin(sessionToken) && Boolean(staffTok && staff)
  const expiresAt = sessions.get(sessionToken || '')?.expiresAt ?? getStaffSessionExpiresAt()
  return {
    authenticated: authed,
    hasCmsApiKey: false,
    feedPath,
    feedUrl: resolveCmsApiBase(),
    repo,
    adminEnabled: true,
    staffRole: staff?.role || null,
    expiresAt: authed ? expiresAt : null,
    sessionTtlSeconds: Math.round(SESSION_TTL_MS / 1000),
  }
}

export function setCmsApiKeyForAdmin(
  _sessionToken: string,
  _key: string,
): { ok: boolean; error?: string } {
  // CMS API keys are not used — staff account sessions only
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

/** Publish launcher Home news via CMS API (MariaDB on server). */
export async function publishNewsFeed(
  sessionToken: string,
  items: NewsItem[],
  title?: string,
): Promise<{ ok: true; commitUrl?: string; message: string } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }

  const content = buildFeedJson(items, title)
  try {
    await replaceFeedInDb('launcher', items, title)
  } catch (err) {
    return { ok: false, error: `CMS publish failed: ${(err as Error).message}` }
  }

  applyLocalFeedSnapshot(content, 'launcher')

  try {
    const local = path.join(__dirname, '../..', 'news', 'feed.json')
    if (fs.existsSync(path.dirname(local))) {
      fs.writeFileSync(local, content, 'utf8')
    }
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    message: 'News published to CMS. This PC updates immediately; Live clients within a few seconds.',
  }
}

/** Admin can replace full partner feed via CMS. */
export async function publishPartnersFeedAsAdmin(
  sessionToken: string,
  items: NewsItem[],
  title?: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  const content = buildFeedJson(items, title || 'EG Partner News')
  try {
    await replaceFeedInDb('partners', items, title || 'EG Partner News')
  } catch (err) {
    return { ok: false, error: `CMS: ${(err as Error).message}` }
  }
  applyLocalFeedSnapshot(content, 'partners')
  return { ok: true, message: 'Partner feed published to CMS.' }
}

export async function loadNewsForAdmin(sessionToken: string): Promise<
  { ok: true; feed: NewsFeedResult } | { ok: false; error: string }
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
