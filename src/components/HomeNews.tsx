import { useEffect, useRef, useState } from 'react'
import type { NewsFeedResult, NewsItem } from '../../shared/types'

/** Poll GitHub API often so Home picks up feed.json edits quickly */
const POLL_MS = 12_000

function formatNewsDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

function tagClass(tag?: string): string {
  switch ((tag || '').toLowerCase()) {
    case 'announcement':
      return 'badge badge-orange'
    case 'update':
      return 'badge badge-green'
    case 'partner':
      return 'badge badge-blue'
    case 'event':
      return 'badge badge-orange'
    default:
      return 'badge'
  }
}

function feedFingerprint(feed: NewsFeedResult | null): string {
  if (!feed) return ''
  return [feed.updated || '', feed.items.map((i) => `${i.id}:${i.date}:${i.title}`).join('|')].join(
    '::',
  )
}

export function HomeNews() {
  const [feed, setFeed] = useState<NewsFeedResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fingerprintRef = useRef('')

  useEffect(() => {
    let cancelled = false

    async function load(force: boolean, silent: boolean) {
      if (!silent) setLoading(true)
      try {
        const data = await window.hive.news.fetch(force)
        if (cancelled) return
        const nextFp = feedFingerprint(data)
        if (nextFp !== fingerprintRef.current || !fingerprintRef.current) {
          fingerprintRef.current = nextFp
          setFeed(data)
        }
      } catch (err) {
        if (!cancelled && !silent) {
          setFeed({
            title: 'News',
            updated: null,
            sourceUrl: '',
            sourceType: 'json',
            items: [],
            fromCache: false,
            error: (err as Error).message,
          })
        }
      } finally {
        if (!cancelled && !silent) setLoading(false)
      }
    }

    load(true, false)

    const interval = window.setInterval(() => {
      load(true, true)
    }, POLL_MS)

    const onFocus = () => load(true, true)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(true, true)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const items = feed?.items || []

  return (
    <section className="home-news panel">
      <div className="home-news-header">
        <h2 style={{ fontSize: 18, marginBottom: 0 }}>News</h2>
      </div>

      {loading && !feed && (
        <div className="skeleton" style={{ height: 120, borderRadius: 14 }} />
      )}

      {!loading && items.length === 0 && !feed?.error && (
        <div className="empty" style={{ padding: 24 }}>
          <h3>No news yet</h3>
          <p>When posts are published to the news feed, they will show up here.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="home-news-list">
          {items.map((item: NewsItem) => {
            const open = expandedId === item.id
            const preview = item.summary || item.body || ''
            return (
              <article key={item.id} className={`home-news-card${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="home-news-card-head"
                  onClick={() => setExpandedId(open ? null : item.id)}
                >
                  <div className="home-news-card-meta">
                    <span className={tagClass(item.tag)}>{item.tag || 'info'}</span>
                    <time dateTime={item.date}>{formatNewsDate(item.date)}</time>
                  </div>
                  <h3 className="home-news-title">{item.title}</h3>
                  {!open && preview && <p className="home-news-preview">{preview}</p>}
                </button>
                {open && (
                  <div className="home-news-body">
                    <p className="home-news-body-text">{item.body || item.summary || ''}</p>
                    {item.url && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginTop: 10 }}
                        onClick={() => window.hive.shell.openExternal(item.url!)}
                      >
                        Open link
                      </button>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
