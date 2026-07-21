import crypto from 'crypto'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { cmsRequest } from './cms/httpClient'
import { applyLocalFeedSnapshot, fetchNews } from './news'

const SESSION_TTL_MS = 8 * 60 * 60 * 1000

export type PartnerAuthRecord = {
  id: string
  username: string
  passwordHash: string
  newsTag: string
  displayName: string
}

type PartnerSession = {
  partnerId: string
  username: string
  newsTag: string
  displayName: string
  expiresAt: number
  token: string
}

const sessions = new Map<string, PartnerSession>()

export function hashPartnerPassword(username: string, password: string): string {
  return crypto
    .createHash('sha256')
    .update(`eg-partner-auth-v1:${username}:${password}`)
    .digest('hex')
}

function purgeSessions() {
  const now = Date.now()
  for (const [k, v] of sessions) {
    if (v.expiresAt < now) sessions.delete(k)
  }
}

/** Password checked on server over HTTPS — hashes never sent to the client. */
export async function partnerLogin(
  username: string,
  password: string,
): Promise<
  | { ok: true; sessionToken: string; partnerId: string; newsTag: string; displayName: string }
  | { ok: false; error: string }
> {
  const u = (username || '').trim()
  const p = (password || '').trim()
  if (!u || !p) return { ok: false, error: 'Enter username and password' }

  try {
    const r = await cmsRequest<{
      sessionToken?: string
      partnerId?: string
      newsTag?: string
      displayName?: string
      error?: string
    }>({
      path: 'partner_auth.php?action=login',
      method: 'POST',
      body: { username: u, password: p },
    })

    if (!r.sessionToken || !r.partnerId) {
      return { ok: false, error: r.error || 'Invalid credentials' }
    }

    purgeSessions()
    sessions.set(r.sessionToken, {
      partnerId: r.partnerId,
      username: u,
      newsTag: r.newsTag || '',
      displayName: r.displayName || u,
      expiresAt: Date.now() + SESSION_TTL_MS,
      token: r.sessionToken,
    })

    return {
      ok: true,
      sessionToken: r.sessionToken,
      partnerId: r.partnerId,
      newsTag: r.newsTag || '',
      displayName: r.displayName || u,
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function partnerLogout(sessionToken: string): void {
  sessions.delete(sessionToken)
  void cmsRequest({
    path: 'partner_auth.php?action=logout',
    method: 'POST',
    sessionToken,
  }).catch(() => undefined)
}

export function requirePartner(sessionToken: string | null | undefined): PartnerSession | null {
  if (!sessionToken) return null
  purgeSessions()
  const s = sessions.get(sessionToken)
  if (!s) return null
  s.expiresAt = Date.now() + SESSION_TTL_MS
  return s
}

export function getPartnerSessionInfo(sessionToken: string | null | undefined) {
  const s = requirePartner(sessionToken)
  return s
    ? {
        authenticated: true as const,
        partnerId: s.partnerId,
        username: s.username,
        newsTag: s.newsTag,
        displayName: s.displayName,
      }
    : { authenticated: false as const }
}

function buildPartnersFeedJson(items: NewsItem[], title = 'EG Partner News'): string {
  const sorted = [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  return (
    JSON.stringify(
      {
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
      },
      null,
      2,
    ) + '\n'
  )
}

export async function publishPartnerNews(
  sessionToken: string,
  partnerItems: NewsItem[],
): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> {
  const session = requirePartner(sessionToken)
  if (!session) return { ok: false, error: 'Not authenticated as partner' }

  try {
    await cmsRequest({
      path: 'partner_news.php',
      method: 'POST',
      sessionToken,
      body: { items: partnerItems },
    })
    const feed = await fetchNews({ force: true, kind: 'partners' })
    applyLocalFeedSnapshot(buildPartnersFeedJson(feed.items, feed.title), 'partners')
    return {
      ok: true,
      message: 'Partner news published. Live clients update within a few seconds.',
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function loadPartnerNewsForEditor(
  sessionToken: string,
): Promise<{ ok: true; feed: NewsFeedResult; newsTag: string } | { ok: false; error: string }> {
  const session = requirePartner(sessionToken)
  if (!session) return { ok: false, error: 'Not authenticated' }
  const feed = await fetchNews({ force: true, kind: 'partners', tag: session.newsTag })
  return { ok: true, feed, newsTag: session.newsTag }
}

export function newPartnerNewsId(): string {
  return `pnews-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

export async function mirrorPartnerAuthToPublic(): Promise<{ ok: boolean; error?: string }> {
  return { ok: true }
}
