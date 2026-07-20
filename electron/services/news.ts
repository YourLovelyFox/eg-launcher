import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { DEFAULT_NEWS_FEED_URL } from '../../shared/branding'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'

const USER_AGENT = 'EGLauncher/1.0 (news-feed)'
/** Soft cache only — UI polls often with force=true to pick up remote JSON changes. */
const CACHE_TTL_MS = 30 * 1000

type CacheFile = {
  fetchedAt: string
  sourceUrl: string
  contentHash: string
  result: NewsFeedResult
}

function cachePath(): string {
  return path.join(getDataRoot(), 'news-cache.json')
}

function resolveFeedUrl(): string {
  return DEFAULT_NEWS_FEED_URL
}

function hashContent(body: string): string {
  // Simple non-crypto fingerprint to detect feed changes
  let h = 0
  for (let i = 0; i < body.length; i++) {
    h = (Math.imul(31, h) + body.charCodeAt(i)) | 0
  }
  return `${body.length}:${h}`
}

function httpGetText(url: string, redirects = 0): Promise<{ body: string; finalUrl: string }> {
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
          Accept: 'application/json, application/feed+json, application/rss+xml, application/atom+xml, text/xml, */*',
          'Cache-Control': 'no-cache',
        },
        timeout: 20_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).toString()
          res.resume()
          httpGetText(next, redirects + 1).then(resolve).catch(reject)
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
          resolve({ body: Buffer.concat(chunks).toString('utf-8'), finalUrl: url })
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

  // RSS 2.0
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

/**
 * Fetch launcher news from a remote JSON or RSS/Atom feed.
 * Falls back to disk cache if the network fails.
 */
export async function fetchNews(options?: {
  force?: boolean
}): Promise<NewsFeedResult> {
  const sourceUrl = resolveFeedUrl()
  const cache = loadCache()

  if (!options?.force && cache?.result && cache.sourceUrl === sourceUrl) {
    const age = Date.now() - Date.parse(cache.fetchedAt)
    if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) {
      return { ...cache.result, fromCache: true, sourceType: 'cache' }
    }
  }

  try {
    const { body } = await httpGetText(sourceUrl)
    const trimmed = body.trim()
    let result: NewsFeedResult

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      result = parseJsonFeed(trimmed, sourceUrl)
    } else if (trimmed.includes('<rss') || trimmed.includes('<feed') || trimmed.includes('<RDF')) {
      result = parseRssOrAtom(trimmed, sourceUrl)
    } else {
      throw new Error('Feed is not JSON or RSS/Atom')
    }

    saveCache(sourceUrl, result, hashContent(trimmed))
    return result
  } catch (err) {
    if (cache?.result) {
      return {
        ...cache.result,
        fromCache: true,
        sourceType: 'cache',
        error: `Using cached news — ${(err as Error).message}`,
      }
    }

    // Bundled / repo fallback for first run offline or before the remote file exists
    const localFallback = tryLoadBundledFeed(sourceUrl)
    if (localFallback) {
      return {
        ...localFallback,
        error: `Offline / remote unavailable — showing bundled news. ${(err as Error).message}`,
      }
    }

    return {
      title: 'EG Launcher News',
      updated: null,
      sourceUrl,
      sourceType: 'json',
      items: [],
      fromCache: false,
      error: (err as Error).message,
    }
  }
}

function tryLoadBundledFeed(sourceUrl: string): NewsFeedResult | null {
  const candidates = [
    path.join(app.getAppPath(), 'news', 'feed.json'),
    path.join(process.resourcesPath, 'news', 'feed.json'),
    // Dev: project root
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
