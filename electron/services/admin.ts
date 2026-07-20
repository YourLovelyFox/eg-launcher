import crypto from 'crypto'
import fs from 'fs'
import https from 'https'
import path from 'path'
import { DEFAULT_NEWS_FEED_URL } from '../../shared/branding'
import { isAdminBuild } from '../../shared/features'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import { applyLocalFeedSnapshot, clearNewsCache, fetchNews } from './news'

/** Salted SHA-256 of the admin password (not the password itself). */
const ADMIN_PASSWORD_HASH =
  'ab478006bff10354fd8a8b5792f0630ccb358698c32522a6af2a9eb681995c62'
const ADMIN_SALT = 'eg-launcher-admin-v1'

const GH_OWNER = 'YourLovelyFox'
const GH_REPO = 'eg-launcher'
const GH_PATH = 'news/feed.json'
const GH_BRANCH = 'master'

type AdminSession = {
  token: string
  expiresAt: number
}

type AdminSecrets = {
  githubToken?: string
}

const sessions = new Map<string, AdminSession>()
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(ADMIN_SALT + password).digest('hex')
}

function secretsPath(): string {
  return path.join(getDataRoot(), 'admin-secrets.json')
}

/**
 * Dev-only GitHub token sources (never shipped in public builds).
 * Priority: env → admin.local.json (project) → Desktop secret file → userData cache
 */
function loadDevGithubTokenFromDisk(): string | null {
  if (!isAdminBuild()) return null

  if (process.env.EG_GITHUB_TOKEN?.trim()) {
    return process.env.EG_GITHUB_TOKEN.trim()
  }

  const candidates = [
    path.join(process.cwd(), 'admin.local.json'),
    path.join(__dirname, '../../admin.local.json'),
    path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', 'New folder', 'eg-launcher-github-token.txt'),
  ]

  for (const p of candidates) {
    try {
      if (!p || !fs.existsSync(p)) continue
      if (p.endsWith('.json')) {
        const j = JSON.parse(fs.readFileSync(p, 'utf-8')) as { githubToken?: string }
        if (j.githubToken?.trim()) return j.githubToken.trim()
      } else {
        const t = fs.readFileSync(p, 'utf-8').trim().split(/\r?\n/).find((l) => l && !l.startsWith('#'))
        if (t) return t.trim()
      }
    } catch {
      /* try next */
    }
  }

  return null
}

function loadSecrets(): AdminSecrets {
  const stored = readJsonFile<AdminSecrets>(secretsPath(), {})
  const fromDisk = loadDevGithubTokenFromDisk()
  // Prefer explicit local dev token file over stale cached token
  if (fromDisk) return { ...stored, githubToken: fromDisk }
  return stored
}

function saveSecrets(s: AdminSecrets): void {
  if (!isAdminBuild()) return
  writeJsonFile(secretsPath(), s)
}

export function assertAdminBuild(): { ok: true } | { ok: false; error: string } {
  if (!isAdminBuild()) {
    return { ok: false, error: 'Admin is not available in the public Live launcher.' }
  }
  return { ok: true }
}

function purgeExpiredSessions() {
  const now = Date.now()
  for (const [k, v] of sessions) {
    if (v.expiresAt < now) sessions.delete(k)
  }
}

export function verifyAdminPassword(password: string): { ok: true; sessionToken: string } | { ok: false; error: string } {
  const gate = assertAdminBuild()
  if (!gate.ok) return gate

  const input = (password || '').trim()
  if (!input) return { ok: false, error: 'Enter the admin password' }

  const hash = hashPassword(input)
  // timing-safe compare
  const a = Buffer.from(hash, 'utf8')
  const b = Buffer.from(ADMIN_PASSWORD_HASH, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Incorrect password' }
  }

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
  if (!isAdminBuild()) {
    return {
      authenticated: false,
      hasGithubToken: false,
      tokenFromLocalFile: false,
      feedPath: GH_PATH,
      feedUrl: DEFAULT_NEWS_FEED_URL,
      repo: `${GH_OWNER}/${GH_REPO}`,
      adminEnabled: false,
    }
  }
  const authed = requireAdmin(sessionToken)
  const secrets = loadSecrets()
  const fromDisk = Boolean(loadDevGithubTokenFromDisk())
  return {
    authenticated: authed,
    hasGithubToken: Boolean(secrets.githubToken && secrets.githubToken.length > 8),
    tokenFromLocalFile: fromDisk,
    feedPath: GH_PATH,
    feedUrl: DEFAULT_NEWS_FEED_URL,
    repo: `${GH_OWNER}/${GH_REPO}`,
    adminEnabled: true,
  }
}

export function setGithubToken(sessionToken: string, githubToken: string): { ok: boolean; error?: string } {
  if (!isAdminBuild()) return { ok: false, error: 'Admin is not available in the public Live launcher.' }
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

function ghRequest(
  method: string,
  apiPath: string,
  token: string,
  body?: object,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'User-Agent': 'EGLauncher-Admin',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          let json: any = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            json = { message: text }
          }
          resolve({ status: res.statusCode || 0, json })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * Publish full news feed to GitHub (updates raw.githubusercontent.com for all clients).
 */
export async function publishNewsFeed(
  sessionToken: string,
  items: NewsItem[],
  title?: string,
): Promise<{ ok: true; commitUrl?: string; message: string } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }

  const secrets = loadSecrets()
  const token = secrets.githubToken?.trim()
  if (!token) {
    return {
      ok: false,
      error:
        'Add a GitHub Personal Access Token (Contents: Read & Write) in Admin before publishing.',
    }
  }

  const content = buildFeedJson(items, title)
  const contentB64 = Buffer.from(content, 'utf8').toString('base64')

  // Get current file SHA (required for update)
  const getPath = `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`
  const existing = await ghRequest('GET', getPath, token)
  if (existing.status !== 200 && existing.status !== 404) {
    return {
      ok: false,
      error: existing.json?.message || `GitHub GET failed (${existing.status})`,
    }
  }

  const sha = existing.status === 200 ? existing.json?.sha : undefined
  const put = await ghRequest('PUT', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`, token, {
    message: `chore(news): update feed via EG Launcher Admin (${new Date().toISOString()})`,
    content: contentB64,
    branch: GH_BRANCH,
    ...(sha ? { sha } : {}),
  })

  if (put.status !== 200 && put.status !== 201) {
    return {
      ok: false,
      error: put.json?.message || `GitHub PUT failed (${put.status})`,
    }
  }

  // Apply immediately on this PC (don't wait for GitHub CDN)
  clearNewsCache()
  applyLocalFeedSnapshot(content)

  // Write local repo file when developing from source tree
  try {
    const local = path.join(appPathGuess(), 'news', 'feed.json')
    if (fs.existsSync(path.dirname(local))) {
      fs.writeFileSync(local, content, 'utf8')
    }
  } catch {
    /* ignore */
  }

  // Confirm via API (best-effort)
  try {
    await fetchNews({ force: true })
  } catch {
    /* ignore — local snapshot already applied */
  }

  return {
    ok: true,
    commitUrl: put.json?.commit?.html_url,
    message:
      'News published. This PC updates now; other launchers refresh via GitHub API within a few seconds.',
  }
}

function appPathGuess(): string {
  // dist-electron -> project root in dev; packaged uses resources
  return path.join(__dirname, '../..')
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
