import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { FeedKind } from '../../shared/contentRepo'
import { resolveCmsApiBase } from '../../shared/cmsApi'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import { fetchNewsFromDb } from './db/newsRepo'

/** Soft memory cache — near-live CMS poll */
const CACHE_TTL_MS = 3_000
/** After Admin/partner publish, prefer local snapshot so UI is instant */
const LOCAL_PIN_MS = 120_000
/** Back off when CMS API is unreachable */
const RATE_LIMIT_BACKOFF_MS = 30_000

type CacheFile = {
  fetchedAt: string
  sourceUrl: string
  contentHash: string
  result: NewsFeedResult
}

type MemoryState = {
  fetchedAt: number
  contentHash: string
  sourceUrl: string
  result: NewsFeedResult
  pinUntil: number
  networkBlockedUntil: number
}

const memory = new Map<FeedKind, MemoryState>()

type NewsListener = (kind: FeedKind, feed: NewsFeedResult) => void
let newsListener: NewsListener | null = null

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
  if (mem) mem.networkBlockedUntil = 0
  else memory.delete(kind)
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
): void {
  const payload: CacheFile = {
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    contentHash,
    result: { ...result, fromCache: true, sourceType: result.sourceType },
  }
  writeJsonFile(cachePath(kind), payload)
}

function remember(
  kind: FeedKind,
  result: NewsFeedResult,
  contentHash: string,
  sourceUrl: string,
  opts?: { pinMs?: number },
): void {
  const prev = memory.get(kind)
  memory.set(kind, {
    fetchedAt: Date.now(),
    contentHash,
    sourceUrl,
    result: { ...result, fromCache: false },
    pinUntil: opts?.pinMs
      ? Date.now() + opts.pinMs
      : prev?.pinUntil && prev.pinUntil > Date.now()
        ? prev.pinUntil
        : 0,
    networkBlockedUntil: 0,
  })
  saveDiskCache(kind, sourceUrl, result, contentHash)
}

function hydrateMemoryFromDisk(kind: FeedKind): MemoryState | null {
  const existing = memory.get(kind)
  if (existing) return existing
  const disk = loadDiskCache(kind)
  if (!disk?.result) return null
  const state: MemoryState = {
    fetchedAt: Date.parse(disk.fetchedAt) || 0,
    contentHash: disk.contentHash || '',
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

/** Immediately apply a published feed so UI updates without waiting for CMS poll. */
export function applyLocalFeedSnapshot(rawJson: string, kind: FeedKind = 'launcher'): NewsFeedResult {
  const result = parseJsonFeed(rawJson, 'local-publish')
  const hash = hashContent(rawJson)
  remember(kind, result, hash, 'local-publish', { pinMs: LOCAL_PIN_MS })
  emitNewsUpdate(kind, filterByTag(result, undefined))
  return result
}

/**
 * Fetch launcher or partner news from the HTTPS CMS API only.
 * Fallbacks: local pin / disk cache / bundled feed.json.
 */
export async function fetchNews(options?: {
  force?: boolean
  kind?: FeedKind
  tag?: string
}): Promise<NewsFeedResult> {
  const kind = options?.kind || 'launcher'
  const force = Boolean(options?.force)
  const tag = options?.tag
  const mem = hydrateMemoryFromDisk(kind)
  const now = Date.now()

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

  if (!force && mem && now - mem.fetchedAt < CACHE_TTL_MS) {
    return filterByTag({ ...mem.result, fromCache: true, sourceType: 'cache' }, tag)
  }

  if (mem && mem.networkBlockedUntil > now) {
    return (
      cachedResult(kind, tag, 'News temporarily using cache (CMS unreachable).') || {
        title: kind === 'launcher' ? 'EG Launcher News' : 'Partner News',
        updated: null,
        sourceUrl: resolveCmsApiBase(),
        sourceType: 'json',
        items: [],
        fromCache: true,
        error: 'CMS unreachable — retry shortly',
      }
    )
  }

  const errors: string[] = []

  try {
    const full = await fetchNewsFromDb(kind)
    const fullBody = JSON.stringify({
      title: full.title,
      updated: full.updated,
      items: full.items,
    })
    const hash = hashContent(fullBody)
    if (mem && hash === mem.contentHash && !force) {
      mem.fetchedAt = now
      mem.networkBlockedUntil = 0
      return filterByTag({ ...mem.result, fromCache: true, sourceType: 'cache' }, tag)
    }
    remember(kind, full, hash, resolveCmsApiBase())
    const out = filterByTag(full, tag)
    emitNewsUpdate(kind, out)
    return out
  } catch (err) {
    const msg = (err as Error).message || String(err)
    errors.push(`CMS: ${msg}`)
    if (mem) mem.networkBlockedUntil = now + RATE_LIMIT_BACKOFF_MS
  }

  const cached = cachedResult(
    kind,
    tag,
    errors.length ? `Using cached news — ${errors.join('; ')}` : undefined,
  )
  if (cached) return cached

  if (kind === 'launcher') {
    const localFallback = tryLoadBundledFeed()
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
    sourceUrl: resolveCmsApiBase(),
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

function tryLoadBundledFeed(): NewsFeedResult | null {
  const candidates = [
    path.join(app.getAppPath(), 'news', 'feed.json'),
    path.join(process.resourcesPath, 'news', 'feed.json'),
    path.join(__dirname, '../../news/feed.json'),
  ]
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf-8')
      return parseJsonFeed(raw, 'bundled://news/feed.json')
    } catch {
      /* try next */
    }
  }
  return null
}

export function getDefaultNewsFeedUrl(): string {
  return `${resolveCmsApiBase()}/news.php?kind=launcher`
}
