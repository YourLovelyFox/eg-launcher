import type { FeedKind } from '../../../shared/contentRepo'
import type { NewsFeedResult, NewsItem } from '../../../shared/types'
import { cmsRequest } from '../cms/httpClient'

export async function fetchNewsFromDb(kind: FeedKind, _tag?: string): Promise<NewsFeedResult> {
  const r = await cmsRequest<{
    ok?: boolean
    title?: string
    updated?: string | null
    items?: NewsItem[]
    error?: string
  }>({ path: `news.php?kind=${encodeURIComponent(kind)}` })

  if (r.ok === false) throw new Error(r.error || 'Failed to load news')

  return {
    title: r.title || (kind === 'launcher' ? 'EG Launcher News' : 'EG Partner News'),
    updated: r.updated ?? null,
    sourceUrl: 'https://cms/news',
    sourceType: 'json',
    items: Array.isArray(r.items) ? r.items : [],
    fromCache: false,
  }
}

export async function replaceFeedInDb(
  kind: FeedKind,
  items: NewsItem[],
  title?: string,
): Promise<void> {
  await cmsRequest({
    path: `news.php?kind=${encodeURIComponent(kind)}`,
    method: 'POST',
    admin: true,
    body: {
      title: title || (kind === 'launcher' ? 'EG Launcher News' : 'EG Partner News'),
      items,
    },
  })
}

export async function mergePartnerNewsInDb(
  newsTag: string,
  partnerItems: NewsItem[],
): Promise<NewsItem[]> {
  // Used only if admin path replaces full feed; partners use partner_news.php via partnerAuth
  const current = await fetchNewsFromDb('partners')
  const tag = newsTag.toLowerCase()
  const others = current.items.filter((i) => (i.tag || '').toLowerCase() !== tag)
  const own = partnerItems.map((i) => ({ ...i, tag: newsTag }))
  const merged = [...own, ...others].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  await replaceFeedInDb('partners', merged, current.title || 'EG Partner News')
  return merged
}

export async function deleteNewsByTag(kind: FeedKind, newsTag: string): Promise<void> {
  const feed = await fetchNewsFromDb(kind)
  const next = feed.items.filter((i) => (i.tag || '').toLowerCase() !== newsTag.toLowerCase())
  await replaceFeedInDb(kind, next, feed.title)
}
