import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  DEFAULT_NEWS_FEED_URL,
  NEWS_GITHUB_API_URL,
  PARTNER_NEWS_API_URL,
  PARTNER_NEWS_RAW_URL,
} from '../../shared/branding'
import type { FeedKind } from '../../shared/contentRepo'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import { loadDevGithubToken } from './devToken'

const USER_AGENT = 'EGLauncher/1.0 (news-feed)'
/** Soft memory cache — skip network when not forcing */
const CACHE_TTL_MS = 6_000
/** After Admin/partner publish, prefer local snapshot so UI is instant */
const LOCAL_PIN_MS = 120_000
/** Back off network polls when GitHub rate-limits us */
const RATE_LIMIT_BACKOFF_MS = 90_000

type CacheFile = {
  fetchedAt: string
  sourceUrl: string
  contentHash: string
  etag?: string
  result: NewsFeedResult
}

type MemoryState = {
  fetchedAt: number
  contentHash: string
  etag?: string
  sourceUrl: string
  result: NewsFeedResult
  /** Prefer this snapshot until this timestamp (local publish) */
  pinUntil: number
  /** Do not hit network until this timestamp (rate limit) */
  networkBlockedUntil: number
}

const memory = new Map<FeedKind, MemoryState>()

type NewsListener = (kind: FeedKind, feed: NewsFeedResult) => void
let newsListener: NewsListener | null = null

/** Main process registers this to push `news:updated` to the renderer. */
export function setNewsUpdateListener(listener: NewsListener | null): void {
  newsListener = listener
}

function emitNewsUpdate(kind: FeedKind, feed: NewsFeedResult): void {
  try {
    newsListener?.(kind, feed)
  } catch {
    /* ignore */
  }
}

function cachePath(kind: FeedKind = 'launcher'): string {
  return path.join(getDataRoot(), kind === 'launcher' ? 'news-cache.json' : 'partner-news-cache.json')
}

export function clearNewsCache(kind: FeedKind = 'launcher'): void {
  try {
    const p = cachePath(kind)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch {
    /* ignore */
  }
  const mem = memory.get(kind)
  if (mem) {
    // Keep pin if still active; only drop network metadata
    mem.networkBlockedUntil = 0
  } else {
    memory.delete(kind)
  }
}

export function clearAllNewsCaches(): void {
  clearNewsCache('launcher')
  clearNewsCache('partners')
  memory.clear()
}

function hashContent(body: string): string {
  let h = 0
  for (let i = 0; i < body.length; i++) {
    h = (Math.imul(31, h) + body.charCodeAt(i)) | 0
  }
  return `${body.length}:${h}`
}

function httpGetText(
  url: string,
  headers: Record<string, string> = {},
  redirects = 0,
): Promise<{ body: string; finalUrl: string; status: number; etag?: string; notModified?: boolean }> {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('Too many redirects'))
      return
    }
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
          ...headers,
        },
        timeout: 20_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).toString()
          res.resume()
          httpGetText(next, headers, redirects + 1).then(resolve).catch(reject)
          return
        }
        if (res.statusCode === 304) {
          res.resume()
          resolve({
            body: '',
            finalUrl: url,
            status: 304,
            etag: res.headers.etag,
            notModified: true,
          })
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8').slice(0, 200)
            reject(new Error(`News feed HTTP ${res.statusCode}${text ? `: ${text}` : ''}`))
          })
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf-8'),
            finalUrl: url,
            status: res.statusCode || 200,
            etag: res.headers.etag,
          })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('News feed request timed out'))
    })
  })
}

function apiUrlFor(kind: FeedKind): string {
  return kind === 'launcher' ? NEWS_GITHUB_API_URL : PARTNER_NEWS_API_URL
}

function rawUrlFor(kind: FeedKind): string {
  return kind === 'launcher' ? DEFAULT_NEWS_FEED_URL : PARTNER_NEWS_RAW_URL
}

function authHeaders(): Record<string, string> {
  const token = loadDevGithubToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * GitHub Contents API — fresher than raw.githubusercontent CDN.
 * Uses local token when present (higher rate limit).
 */
async function fetchFromGitHubApi(
  kind: FeedKind,
  etag?: string,
): Promise<{ body: string; sourceUrl: string; etag?: string; notModified?: boolean }> {
  const apiUrl = apiUrlFor(kind)
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...authHeaders(),
  }
  if (etag) headers['If-None-Match'] = etag

  try {
    const res = await httpGetText(apiUrl, headers)
    if (res.notModified) {
      return { body: '', sourceUrl: apiUrl, etag: res.etag || etag, notModified: true }
    }
    if (res.body.trim().startsWith('{') || res.body.trim().startsWith('[')) {
      return { body: res.body, sourceUrl: apiUrl, etag: res.etag }
    }
  } catch (err) {
    const msg = (err as Error).message || ''
    // Rate limit / abuse — surface for backoff
    if (msg.includes('HTTP 403') || msg.includes('HTTP 429')) {
      throw err
    }
    /* fall through to JSON content response */
  }

  const jsonHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...authHeaders(),
  }
  if (etag) jsonHeaders['If-None-Match'] = etag

  const res = await httpGetText(apiUrl, jsonHeaders)
  if (res.notModified) {
    return { body: '', sourceUrl: apiUrl, etag: res.etag || etag, notModified: true }
  }
  const meta = JSON.parse(res.body) as { content?: string; encoding?: string; message?: string }
  if (!meta.content) {
    throw new Error(meta.message || 'GitHub API returned no file content')
  }
  const decoded = Buffer.from(meta.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  return { body: decoded, sourceUrl: apiUrl, etag: res.etag }
}

/** Fallback: raw.githubusercontent with cache-buster (can still be CDN-stale). */
async function fetchFromRawUrl(kind: FeedKind): Promise<{ body: string; sourceUrl: string }> {
  const base = rawUrlFor(kind)
  const bust = `${base}${base.includes('?') ? '&' : '?'}_=${Date.now()}`
  const { body } = await httpGetText(bust, {
    Accept: 'application/json, text/plain, */*',
    ...authHeaders(),
  })
  return { body, sourceUrl: base }
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim()
}

function stripTags(s: string): string {
  return decodeXml(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function firstTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = xml.match(re)
  return m ? decodeXml(m[1]!) : null
}

function allBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    out.push(m[1]!)
  }
  return out
}

function parseRssOrAtom(xml: string, sourceUrl: string): NewsFeedResult {
  const isAtom = /<feed[\s>]/i.test(xml)
  const items: NewsItem[] = []

  if (isAtom) {
    const feedTitle = firstTag(xml, 'title') || 'News'
    const entries = allBlocks(xml, 'entry').slice(0, 30)
    for (const entry of entries) {
      const title = firstTag(entry, 'title') || 'Untitled'
      const id = firstTag(entry, 'id') || title
      const updated = firstTag(entry, 'updated') || firstTag(entry, 'published') || new Date().toISOString()
      const summary = firstTag(entry, 'summary') || firstTag(entry, 'content') || ''
      const linkMatch = entry.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)
      items.push({
        id,
        title: stripTags(title),
        summary: stripTags(summary).slice(0, 280),
        body: stripTags(summary),
        date: updated,
        tag: 'info',
        url: linkMatch?.[1] || null,
      })
    }
    return {
      title: stripTags(feedTitle),
      updated: items[0]?.date || null,
      sourceUrl,
      sourceType: 'atom',
      items,
      fromCache: false,
    }
  }

  const channel = firstTag(xml, 'channel') || xml
  const feedTitle = firstTag(channel, 'title') || 'News'
  const channelItems = allBlocks(xml, 'item').slice(0, 30)
  for (const item of channelItems) {
    const title = firstTag(item, 'title') || 'Untitled'
    const guid = firstTag(item, 'guid') || firstTag(item, 'link') || title
    const pubDate = firstTag(item, 'pubDate') || firstTag(item, 'date') || new Date().toISOString()
    const description = firstTag(item, 'description') || firstTag(item, 'content:encoded') || ''
    const link = firstTag(item, 'link')
    let iso = pubDate
    const parsed = Date.parse(pubDate)
    if (!Number.isNaN(parsed)) iso = new Date(parsed).toISOString()
    items.push({
      id: stripTags(guid),
      title: stripTags(title),
      summary: stripTags(description).slice(0, 280),
      body: stripTags(description),
      date: iso,
      tag: 'info',
      url: link ? stripTags(link) : null,
    })
  }

  return {
    title: stripTags(feedTitle),
    updated: items[0]?.date || null,
    sourceUrl,
    sourceType: 'rss',
    items,
    fromCache: false,
  }
}

function stripBom(text: string): string {
  if (!text) return text
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text.replace(/^\uFEFF/, '')
}

function parseJsonFeed(raw: string, sourceUrl: string): NewsFeedResult {
  const data = JSON.parse(stripBom(raw)) as {
    title?: string
    updated?: string
    items?: Array<Partial<NewsItem> & { id?: string; title?: string }>
  }

  const items: NewsItem[] = (data.items || [])
    .filter((i) => i && (i.title || i.id))
    .map((i, idx) => ({
      id: String(i.id || `item-${idx}`),
      title: String(i.title || 'Untitled'),
      summary: i.summary ? String(i.summary) : undefined,
      body: i.body ? String(i.body) : i.summary ? String(i.summary) : undefined,
      date: i.date ? String(i.date) : new Date().toISOString(),
      tag: i.tag ? String(i.tag) : 'info',
      url: i.url === undefined ? null : i.url,
    }))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

  return {
    title: data.title || 'EG Launcher News',
    updated: data.updated || items[0]?.date || null,
    sourceUrl,
    sourceType: 'json',
    items,
    fromCache: false,
  }
}

function loadDiskCache(kind: FeedKind): CacheFile | null {
  return readJsonFile<CacheFile | null>(cachePath(kind), null)
}

function saveDiskCache(
  kind: FeedKind,
  sourceUrl: string,
  result: NewsFeedResult,
  contentHash: string,
  etag?: string,
): void {
  const payload: CacheFile = {
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    contentHash,
    etag,
    result: { ...result, fromCache: true, sourceType: result.sourceType },
  }
  writeJsonFile(cachePath(kind), payload)
}

function remember(
  kind: FeedKind,
  result: NewsFeedResult,
  contentHash: string,
  sourceUrl: string,
  opts?: { etag?: string; pinMs?: number; keepNetworkBlock?: boolean },
): void {
  const prev = memory.get(kind)
  memory.set(kind, {
    fetchedAt: Date.now(),
    contentHash,
    etag: opts?.etag ?? prev?.etag,
    sourceUrl,
    result: { ...result, fromCache: false },
    pinUntil: opts?.pinMs ? Date.now() + opts.pinMs : prev?.pinUntil && prev.pinUntil > Date.now() ? prev.pinUntil : 0,
    networkBlockedUntil: opts?.keepNetworkBlock ? prev?.networkBlockedUntil || 0 : 0,
  })
  saveDiskCache(kind, sourceUrl, result, contentHash, opts?.etag ?? prev?.etag)
}

function hydrateMemoryFromDisk(kind: FeedKind): MemoryState | null {
  const existing = memory.get(kind)
  if (existing) return existing
  const disk = loadDiskCache(kind)
  if (!disk?.result) return null
  const state: MemoryState = {
    fetchedAt: Date.parse(disk.fetchedAt) || 0,
    contentHash: disk.contentHash || '',
    etag: disk.etag,
    sourceUrl: disk.sourceUrl || '',
    result: disk.result,
    pinUntil: disk.sourceUrl === 'local-publish' ? Date.now() + 30_000 : 0,
    networkBlockedUntil: 0,
  }
  memory.set(kind, state)
  return state
}

function cachedResult(kind: FeedKind, tag?: string, error?: string): NewsFeedResult | null {
  const mem = hydrateMemoryFromDisk(kind)
  if (!mem?.result) return null
  const base = {
    ...mem.result,
    fromCache: true as const,
    sourceType: 'cache' as const,
    ...(error ? { error } : {}),
  }
  return filterByTag(base, tag)
}

/** Immediately apply a published feed body so UI updates without waiting for GitHub. */
export function applyLocalFeedSnapshot(rawJson: string, kind: FeedKind = 'launcher'): NewsFeedResult {
  const result = parseJsonFeed(rawJson, 'local-publish')
  const hash = hashContent(rawJson)
  remember(kind, result, hash, 'local-publish', { pinMs: LOCAL_PIN_MS })
  emitNewsUpdate(kind, filterByTag(result, undefined))
  return result
}

/**
 * Fetch launcher or partner news from public mirrors.
 * Local publish pin → memory/disk TTL → GitHub API (token + ETag) → raw CDN → cache.
 */
export async function fetchNews(options?: {
  force?: boolean
  kind?: FeedKind
  /** Only return items with this tag (partner pages) */
  tag?: string
}): Promise<NewsFeedResult> {
  const kind = options?.kind || 'launcher'
  const force = Boolean(options?.force)
  const tag = options?.tag
  const mem = hydrateMemoryFromDisk(kind)
  const now = Date.now()

  // 1) Fresh local publish — never clobber with possibly-stale network
  if (mem && mem.pinUntil > now) {
    return filterByTag(
      {
        ...mem.result,
        fromCache: mem.sourceUrl === 'local-publish',
        sourceType: mem.sourceUrl === 'local-publish' ? 'json' : mem.result.sourceType,
      },
      tag,
    )
  }

  // 2) Soft TTL (non-force)
  if (!force && mem && now - mem.fetchedAt < CACHE_TTL_MS) {
    return filterByTag({ ...mem.result, fromCache: true, sourceType: 'cache' }, tag)
  }

  // 3) Rate-limit backoff
  if (mem && mem.networkBlockedUntil > now) {
    return (
      cachedResult(kind, tag, 'News temporarily using cache (GitHub rate limit).') || {
        title: kind === 'launcher' ? 'EG Launcher News' : 'Partner News',
        updated: null,
        sourceUrl: rawUrlFor(kind),
        sourceType: 'json',
        items: [],
        fromCache: true,
        error: 'GitHub rate limit — retry shortly',
      }
    )
  }

  const errors: string[] = []
  const etag = mem?.etag

  try {
    const remote = await fetchFromGitHubApi(kind, etag)
    if (remote.notModified && mem) {
      mem.fetchedAt = now
      mem.etag = remote.etag || mem.etag
      mem.networkBlockedUntil = 0
      saveDiskCache(kind, mem.sourceUrl, mem.result, mem.contentHash, mem.etag)
      return filterByTag({ ...mem.result, fromCache: true, sourceType: 'cache' }, tag)
    }
    if (remote.body) {
      const trimmed = remote.body.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const hash = hashContent(trimmed)
        // If network is older/same as a very recent local pin that just expired, still OK
        if (mem && hash === mem.contentHash) {
          mem.fetchedAt = now
          mem.etag = remote.etag || mem.etag
          mem.networkBlockedUntil = 0
          return filterByTag({ ...mem.result, fromCache: true, sourceType: 'cache' }, tag)
        }
        const result = parseJsonFeed(trimmed, remote.sourceUrl)
        remember(kind, result, hash, remote.sourceUrl, { etag: remote.etag })
        const out = filterByTag(result, tag)
        emitNewsUpdate(kind, out)
        return out
      }
      errors.push('GitHub API returned non-JSON')
    }
  } catch (err) {
    const msg = (err as Error).message || ''
    errors.push(`GitHub API: ${msg}`)
    if (msg.includes('HTTP 403') || msg.includes('HTTP 429') || /rate limit/i.test(msg)) {
      if (mem) {
        mem.networkBlockedUntil = now + RATE_LIMIT_BACKOFF_MS
      }
      const cached = cachedResult(kind, tag, `Using cached news — ${msg}`)
      if (cached) return cached
    }
  }

  // Raw CDN only if we have no good cache, or force and API failed without rate limit hold
  const haveFreshCache = mem && now - mem.fetchedAt < 60_000
  if (!haveFreshCache || force) {
    try {
      const { body, sourceUrl } = await fetchFromRawUrl(kind)
      const trimmed = body.trim()
      let result: NewsFeedResult
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        result = parseJsonFeed(trimmed, sourceUrl)
      } else if (trimmed.includes('<rss') || trimmed.includes('<feed')) {
        result = parseRssOrAtom(trimmed, sourceUrl)
      } else {
        throw new Error('not JSON/RSS')
      }
      const hash = hashContent(trimmed)
      // Do not replace a newer local snapshot with older CDN content
      if (mem && mem.sourceUrl === 'local-publish' && hash !== mem.contentHash && now - mem.fetchedAt < LOCAL_PIN_MS) {
        return filterByTag(mem.result, tag)
      }
      if (mem && hash === mem.contentHash) {
        mem.fetchedAt = now
        return filterByTag({ ...mem.result, fromCache: true, sourceType: 'cache' }, tag)
      }
      remember(kind, result, hash, sourceUrl)
      const out = filterByTag(result, tag)
      emitNewsUpdate(kind, out)
      return out
    } catch (err) {
      errors.push(`raw: ${(err as Error).message}`)
    }
  }

  const cached = cachedResult(kind, tag, errors.length ? `Using cached news — ${errors.join('; ')}` : undefined)
  if (cached) return cached

  if (kind === 'launcher') {
    const localFallback = tryLoadBundledFeed(DEFAULT_NEWS_FEED_URL)
    if (localFallback) {
      return filterByTag(
        {
          ...localFallback,
          error: `Offline — bundled news. ${errors.join('; ')}`,
        },
        tag,
      )
    }
  }

  return {
    title: kind === 'launcher' ? 'EG Launcher News' : 'Partner News',
    updated: null,
    sourceUrl: rawUrlFor(kind),
    sourceType: 'json',
    items: [],
    fromCache: false,
    error: errors.join('; ') || 'Failed to load news',
  }
}

function filterByTag(feed: NewsFeedResult, tag?: string): NewsFeedResult {
  if (!tag) return feed
  const t = tag.toLowerCase()
  return {
    ...feed,
    items: feed.items.filter((i) => (i.tag || '').toLowerCase() === t),
  }
}

function tryLoadBundledFeed(sourceUrl: string): NewsFeedResult | null {
  const candidates = [
    path.join(app.getAppPath(), 'news', 'feed.json'),
    path.join(process.resourcesPath, 'news', 'feed.json'),
    path.join(__dirname, '../../news/feed.json'),
  ]
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf-8')
      return parseJsonFeed(raw, sourceUrl)
    } catch {
      /* try next */
    }
  }
  return null
}

export function getDefaultNewsFeedUrl(): string {
  return DEFAULT_NEWS_FEED_URL
}
