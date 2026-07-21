import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { isAdminBuild } from '../../shared/features'
import { resolveCmsApiBase } from '../../shared/cmsApi'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { isAdminAvailable, isAdminUnlocked } from './adminUnlock'
import { loadAdminApiKey, setAdminApiKey } from './cms/httpClient'
import { replaceFeedInDb } from './db/newsRepo'
import { applyLocalFeedSnapshot, fetchNews } from './news'

type AdminSession = {
  token: string
  expiresAt: number
}

const sessions = new Map<string, AdminSession>()
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

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

/** Dev Admin unlock — no password (Dev launcher only). */
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
  s.expiresAt = Date.now() + SESSION_TTL_MS
  return true
}

export function getAdminStatus(sessionToken: string | undefined | null) {
  const feedPath = 'HTTPS CMS API'
  const repo = resolveCmsApiBase().replace(/^https?:\/\//, '')
  if (!isAdminAvailable()) {
    return {
      authenticated: false,
      hasCmsApiKey: false,
      feedPath,
      feedUrl: resolveCmsApiBase(),
      repo,
      adminEnabled: false,
    }
  }
  const authed = requireAdmin(sessionToken)
  return {
    authenticated: authed,
    hasCmsApiKey: Boolean(loadAdminApiKey()),
    feedPath,
    feedUrl: resolveCmsApiBase(),
    repo,
    adminEnabled: true,
  }
}

export function setCmsApiKeyForAdmin(
  sessionToken: string,
  key: string,
): { ok: boolean; error?: string } {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  return setAdminApiKey(key)
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
