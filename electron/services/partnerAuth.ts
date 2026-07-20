import crypto from 'crypto'
import {
  AUTH_PARTNERS_PRIVATE,
  AUTH_PARTNERS_PUBLIC,
  CONTENT_BRANCH,
  CONTENT_OWNER,
  CONTENT_REPO,
  FEED_PARTNERS_PRIVATE,
  FEED_PARTNERS_PUBLIC,
  PUBLIC_BRANCH,
  PUBLIC_OWNER,
  PUBLIC_REPO,
} from '../../shared/contentRepo'
// crypto.randomBytes used for session / ids
import { isAdminBuild } from '../../shared/features'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { applyLocalFeedSnapshot, fetchNews } from './news'
import {
  getRepoFileText,
  privateRepo,
  publicRepo,
  putRepoFile,
} from './githubContent'
import { loadDevGithubToken } from './devToken'

const PARTNER_SALT = 'eg-partner-auth-v1'
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
}

const sessions = new Map<string, PartnerSession>()

export function hashPartnerPassword(username: string, password: string): string {
  return crypto
    .createHash('sha256')
    .update(`${PARTNER_SALT}:${username}:${password}`)
    .digest('hex')
}

function purgeSessions() {
  const now = Date.now()
  for (const [k, v] of sessions) {
    if (v.expiresAt < now) sessions.delete(k)
  }
}

/** Strip UTF-8 BOM (PowerShell / Windows editors often add it). */
function stripBom(text: string): string {
  if (!text) return text
  // EF BB BF / U+FEFF
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text.replace(/^\uFEFF/, '')
}

function parseJsonSafe<T>(text: string): T {
  return JSON.parse(stripBom(text)) as T
}

function normalizeAuthRecords(raw: unknown): PartnerAuthRecord[] {
  const data = raw as { partners?: PartnerAuthRecord[] }
  return (data.partners || [])
    .filter((x) => x && x.username && x.passwordHash)
    .map((x) => ({
      id: String(x.id || ''),
      username: String(x.username).trim(),
      passwordHash: String(x.passwordHash).trim().toLowerCase(),
      newsTag: String(x.newsTag || '').trim(),
      displayName: String(x.displayName || x.username).trim(),
    }))
}

async function loadPartnerAuthList(): Promise<PartnerAuthRecord[]> {
  const token = loadDevGithubToken()

  // Prefer public mirror (hashes only) so Live works without private token.
  // Use token when available to avoid unauthenticated rate limits.
  const publicFile = await getRepoFileText({
    token: token || undefined,
    owner: PUBLIC_OWNER,
    repo: PUBLIC_REPO,
    branch: PUBLIC_BRANCH,
    path: AUTH_PARTNERS_PUBLIC,
  })
  if (publicFile.ok) {
    try {
      return normalizeAuthRecords(parseJsonSafe(publicFile.text))
    } catch {
      /* fall through */
    }
  }

  // Dev / staff PC: private auth file
  if (token) {
    const priv = await getRepoFileText({
      token,
      owner: CONTENT_OWNER,
      repo: CONTENT_REPO,
      branch: CONTENT_BRANCH,
      path: AUTH_PARTNERS_PRIVATE,
    })
    if (priv.ok) {
      try {
        return normalizeAuthRecords(parseJsonSafe(priv.text))
      } catch {
        /* fall through */
      }
    }
  }

  return []
}

function hashesMatch(expectedHex: string, actualHex: string): boolean {
  const a = Buffer.from(expectedHex.trim().toLowerCase(), 'utf8')
  const b = Buffer.from(actualHex.trim().toLowerCase(), 'utf8')
  if (a.length !== b.length || a.length === 0) return false
  return crypto.timingSafeEqual(a, b)
}

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

  let list: PartnerAuthRecord[]
  try {
    list = await loadPartnerAuthList()
  } catch (err) {
    return { ok: false, error: `Could not load partner accounts: ${(err as Error).message}` }
  }

  if (!list.length) {
    return {
      ok: false,
      error:
        'No partner accounts found (auth file missing or unreadable). Use Admin → Partners to create one, or check news/partner-auth.json.',
    }
  }

  const rec = list.find((x) => x.username.toLowerCase() === u.toLowerCase())
  if (!rec) return { ok: false, error: 'Invalid credentials' }

  // Hash is bound to the stored username (case-sensitive salt input)
  const hash = hashPartnerPassword(rec.username, p)
  if (!hashesMatch(hash, rec.passwordHash)) {
    return { ok: false, error: 'Invalid credentials' }
  }

  purgeSessions()
  const sessionToken = crypto.randomBytes(24).toString('hex')
  sessions.set(sessionToken, {
    partnerId: rec.id,
    username: rec.username,
    newsTag: rec.newsTag,
    displayName: rec.displayName,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })
  return {
    ok: true,
    sessionToken,
    partnerId: rec.id,
    newsTag: rec.newsTag,
    displayName: rec.displayName,
  }
}

export function partnerLogout(sessionToken: string): void {
  sessions.delete(sessionToken)
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

/**
 * Partner publishes only their tagged posts; other tags preserved from full feed.
 */
export async function publishPartnerNews(
  sessionToken: string,
  partnerItems: NewsItem[],
): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> {
  const session = requirePartner(sessionToken)
  if (!session) return { ok: false, error: 'Not authenticated as partner' }

  const token = loadDevGithubToken()
  if (!token) {
    return {
      ok: false,
      error: isAdminBuild()
        ? 'GitHub write token missing (admin.local.json or Desktop token file).'
        : 'Partner publishing requires the Dev Launcher with a write token on this PC.',
    }
  }

  // Load full partners feed
  const current = await fetchNews({ force: true, kind: 'partners' })
  const tag = session.newsTag
  const others = current.items.filter((i) => (i.tag || '').toLowerCase() !== tag.toLowerCase())
  const own = partnerItems.map((i) => ({
    ...i,
    tag, // force partner tag
  }))
  const merged = [...own, ...others]
  const content = buildPartnersFeedJson(merged)

  const msg = `chore(partners): ${session.newsTag} news via partner portal (${new Date().toISOString()})`

  // Private CMS
  const priv = await putRepoFile({
    token,
    ...privateRepo,
    path: FEED_PARTNERS_PRIVATE,
    content,
    message: msg,
  })
  if (!priv.ok) return { ok: false, error: `Private repo: ${priv.error}` }

  // Public mirror for Live clients
  const pub = await putRepoFile({
    token,
    ...publicRepo,
    path: FEED_PARTNERS_PUBLIC,
    content,
    message: msg,
  })
  if (!pub.ok) return { ok: false, error: `Public mirror: ${pub.error}` }

  // Pin + push UI immediately (do not re-fetch GitHub; avoids stale overwrite)
  applyLocalFeedSnapshot(content, 'partners')

  return {
    ok: true,
    message: 'Partner news published. This PC updates immediately; others on the next poll.',
    commitUrl: pub.commitUrl || priv.commitUrl,
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

/** Ensure public partner-auth mirror exists (hashes only). Call from admin if needed. */
export async function mirrorPartnerAuthToPublic(): Promise<{ ok: boolean; error?: string }> {
  const token = loadDevGithubToken()
  if (!token) return { ok: false, error: 'No write token' }
  const priv = await getRepoFileText({
    token,
    owner: CONTENT_OWNER,
    repo: CONTENT_REPO,
    branch: CONTENT_BRANCH,
    path: AUTH_PARTNERS_PRIVATE,
  })
  if (!priv.ok) return { ok: false, error: priv.error }
  const put = await putRepoFile({
    token,
    ...publicRepo,
    path: AUTH_PARTNERS_PUBLIC,
    content: priv.text.endsWith('\n') ? priv.text : priv.text + '\n',
    message: 'chore(auth): mirror partner password hashes for Live login',
  })
  return put.ok ? { ok: true } : { ok: false, error: put.error }
}
