import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  DEFAULT_NEWS_FEED_URL,
  NEWS_GITHUB_API_URL,
  NEWS_GITHUB_OWNER,
  NEWS_GITHUB_PATH,
  NEWS_GITHUB_REPO,
} from '../../shared/branding'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'

const USER_AGENT = 'EGLauncher/1.0 (news-feed)'
/** Very short soft cache — force polls always hit the network */
const CACHE_TTL_MS = 8_000

type CacheFile = {
  fetchedAt: string
  sourceUrl: string
  contentHash: string
  result: NewsFeedResult
}

function cachePath(): string {
  return path.join(getDataRoot(), 'news-cache.json')
}

export function clearNewsCache(): void {
  try {
    const p = cachePath()
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch {
    /* ignore */
  }
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
): Promise<{ body: string; finalUrl: string; etag?: string }> {
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
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`News feed HTTP ${res.statusCode}`))
          res.resume()
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf-8'),
            finalUrl: url,
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

/**
 * GitHub Contents API — no long CDN cache like raw.githubusercontent.com.
 * Public repos need no token. Accept: raw returns file bytes directly.
 */
async function fetchFromGitHubApi(): Promise<{ body: string; sourceUrl: string }> {
  const apiUrl =
    NEWS_GITHUB_API_URL ||
    `https://api.github.com/repos/${NEWS_GITHUB_OWNER}/${NEWS_GITHUB_REPO}/contents/${NEWS_GITHUB_PATH}?ref=master`

  // Prefer raw media type (fresh file body)
  try {
    const { body } = await httpGetText(apiUrl, {
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
      return { body, sourceUrl: apiUrl }
    }
  } catch {
    /* fall through to JSON content response */
  }

  const { body } = await httpGetText(apiUrl, {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  })
  const meta = JSON.parse(body) as { content?: string; encoding?: string; message?: string }
  if (!meta.content) {
    throw new Error(meta.message || 'GitHub API returned no file content')
  }
  const decoded = Buffer.from(meta.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  return { body: decoded, sourceUrl: apiUrl }
}

/** Fallback: raw.githubusercontent with cache-buster (CDN can still lag) */
async function fetchFromRawUrl(): Promise<{ body: string; sourceUrl: string }> {
  const bust = `${DEFAULT_NEWS_FEED_URL}${DEFAULT_NEWS_FEED_URL.includes('?') ? '&' : '?'}_=${Date.now()}`
  const { body } = await httpGetText(bust, {
    Accept: 'application/json, text/plain, */*',
  })
  return { body, sourceUrl: DEFAULT_NEWS_FEED_URL }
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

function parseJsonFeed(raw: string, sourceUrl: string): NewsFeedResult {
  const data = JSON.parse(raw) as {
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

function loadCache(): CacheFile | null {
  return readJsonFile<CacheFile | null>(cachePath(), null)
}

function saveCache(sourceUrl: string, result: NewsFeedResult, contentHash: string): void {
  const payload: CacheFile = {
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    contentHash,
    result: { ...result, fromCache: true, sourceType: result.sourceType },
  }
  writeJsonFile(cachePath(), payload)
}

/** Immediately apply a published feed body so Home updates without waiting for GitHub. */
export function applyLocalFeedSnapshot(rawJson: string): NewsFeedResult {
  const result = parseJsonFeed(rawJson, 'local-publish')
  saveCache('local-publish', result, hashContent(rawJson))
  return result
}

/**
 * Fetch launcher news.
 * Uses GitHub API first (updates almost immediately when feed.json changes),
 * then raw.githubusercontent.com with cache-bust, then disk cache / bundled.
 */
export async function fetchNews(options?: {
  force?: boolean
}): Promise<NewsFeedResult> {
  const cache = loadCache()

  if (!options?.force && cache?.result) {
    const age = Date.now() - Date.parse(cache.fetchedAt)
    if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
      return { ...cache.result, fromCache: true, sourceType: 'cache' }
    }
  }

  if (options?.force) {
    clearNewsCache()
  }

  const errors: string[] = []

  // 1) GitHub API (best freshness)
  try {
    const { body, sourceUrl } = await fetchFromGitHubApi()
    const trimmed = body.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const result = parseJsonFeed(trimmed, sourceUrl)
      saveCache(sourceUrl, result, hashContent(trimmed))
      return result
    }
    errors.push('GitHub API returned non-JSON')
  } catch (err) {
    errors.push(`GitHub API: ${(err as Error).message}`)
  }

  // 2) raw URL + cache buster
  try {
    const { body, sourceUrl } = await fetchFromRawUrl()
    const trimmed = body.trim()
    let result: NewsFeedResult
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      result = parseJsonFeed(trimmed, sourceUrl)
    } else if (trimmed.includes('<rss') || trimmed.includes('<feed')) {
      result = parseRssOrAtom(trimmed, sourceUrl)
    } else {
      throw new Error('not JSON/RSS')
    }
    saveCache(sourceUrl, result, hashContent(trimmed))
    return result
  } catch (err) {
    errors.push(`raw: ${(err as Error).message}`)
  }

  if (cache?.result) {
    return {
      ...cache.result,
      fromCache: true,
      sourceType: 'cache',
      error: `Using cached news — ${errors.join('; ')}`,
    }
  }

  const localFallback = tryLoadBundledFeed(DEFAULT_NEWS_FEED_URL)
  if (localFallback) {
    return {
      ...localFallback,
      error: `Offline — bundled news. ${errors.join('; ')}`,
    }
  }

  return {
    title: 'EG Launcher News',
    updated: null,
    sourceUrl: DEFAULT_NEWS_FEED_URL,
    sourceType: 'json',
    items: [],
    fromCache: false,
    error: errors.join('; ') || 'Failed to load news',
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
