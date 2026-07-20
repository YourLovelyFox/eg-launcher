import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewsFeedResult, NewsItem } from '../../shared/types'
import { useAppStore } from '../store'

const POLL_MS = 8_000

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

function feedFingerprint(feed: NewsFeedResult | null): string {
  if (!feed) return ''
  // Include body/summary so edits (not only new titles) refresh the UI
  return [
    feed.updated || '',
    feed.items.length,
    feed.items
      .map(
        (i) =>
          `${i.id}|${i.date}|${i.title}|${i.tag || ''}|${i.summary || ''}|${i.body || ''}|${i.url || ''}`,
      )
      .join('||'),
  ].join('::')
}

function filterTag(feed: NewsFeedResult, newsTag: string): NewsFeedResult {
  const t = newsTag.toLowerCase()
  return {
    ...feed,
    items: (feed.items || []).filter((i) => (i.tag || '').toLowerCase() === t),
  }
}

type Props = {
  /** Partner news tag, e.g. HorizonsSMP */
  newsTag: string
  partnerTitle: string
}

/**
 * Public partner news list + partner login editor (same feed mechanic as Home News).
 */
export function PartnerNews({ newsTag, partnerTitle }: Props) {
  const { showToast } = useAppStore()
  const [feed, setFeed] = useState<NewsFeedResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fingerprintRef = useRef('')

  // Partner auth
  const [session, setSession] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [items, setItems] = useState<NewsItem[]>([])
  const [draft, setDraft] = useState<NewsItem | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  const applyPublicFeed = useCallback(
    (data: NewsFeedResult, always = false) => {
      const tagged = filterTag(data, newsTag)
      const fp = feedFingerprint(tagged)
      if (always || fp !== fingerprintRef.current || !fingerprintRef.current) {
        fingerprintRef.current = fp
        setFeed(tagged)
      }
    },
    [newsTag],
  )

  const loadPublic = useCallback(
    async (force: boolean, silent: boolean, opts?: { alwaysSet?: boolean }) => {
      if (!silent) setLoading(true)
      try {
        const data = await window.hive.news.fetch({
          force,
          kind: 'partners',
          tag: newsTag,
        })
        applyPublicFeed(data, opts?.alwaysSet)
      } catch (err) {
        if (!silent) {
          setFeed({
            title: 'Partner News',
            updated: null,
            sourceUrl: '',
            sourceType: 'json',
            items: [],
            fromCache: false,
            error: (err as Error).message,
          })
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [newsTag, applyPublicFeed],
  )

  useEffect(() => {
    let cancelled = false
    void loadPublic(true, false)
    const interval = window.setInterval(() => {
      if (!cancelled) void loadPublic(true, true)
    }, POLL_MS)

    const onFocus = () => {
      if (!cancelled) void loadPublic(true, true)
    }
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') void loadPublic(true, true)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    const offUpdated = window.hive.news.onUpdated((payload) => {
      if (payload.kind !== 'partners') return
      applyPublicFeed(payload.feed, true)
      setLoading(false)
    })

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      offUpdated()
    }
  }, [loadPublic, applyPublicFeed])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoginBusy(true)
    setAuthError('')
    try {
      const res = await window.hive.partnerAuth.login(username, password)
      if (!res.ok) {
        setAuthError(res.error)
        return
      }
      if (res.newsTag.toLowerCase() !== newsTag.toLowerCase()) {
        setAuthError('This account is not for this partner page.')
        await window.hive.partnerAuth.logout(res.sessionToken)
        return
      }
      setSession(res.sessionToken)
      setPassword('')
      setEditorOpen(true)
      const news = await window.hive.partnerAuth.loadNews(res.sessionToken)
      if (news.ok) {
        setItems(news.feed.items)
        setSelectedId(news.feed.items[0]?.id ?? null)
        setDraft(news.feed.items[0] ? { ...news.feed.items[0] } : null)
      }
      showToast('success', `Logged in as ${res.displayName}`)
    } catch (err) {
      setAuthError((err as Error).message)
    } finally {
      setLoginBusy(false)
    }
  }

  async function logout() {
    if (session) await window.hive.partnerAuth.logout(session)
    setSession('')
    setEditorOpen(false)
    setItems([])
    setDraft(null)
  }

  function selectPost(id: string) {
    setSelectedId(id)
    const found = items.find((i) => i.id === id)
    setDraft(found ? { ...found } : null)
  }

  function updateDraft(patch: Partial<NewsItem>) {
    setDraft((d) => {
      if (!d) return d
      const next = { ...d, ...patch, tag: newsTag }
      setItems((list) => list.map((i) => (i.id === next.id ? next : i)))
      return next
    })
  }

  async function addPost() {
    const id = await window.hive.partnerAuth.newId()
    const item: NewsItem = {
      id,
      title: '',
      summary: '',
      body: '',
      date: new Date().toISOString(),
      tag: newsTag,
      url: null,
    }
    setItems((list) => [item, ...list])
    setSelectedId(id)
    setDraft(item)
  }

  async function deletePost() {
    if (!selectedId || !session) return
    if (!window.confirm('Delete this post from partner news on GitHub?')) return
    const next = items.filter((i) => i.id !== selectedId)
    setItems(next)
    setSelectedId(next[0]?.id ?? null)
    setDraft(next[0] ? { ...next[0] } : null)
    setPublishing(true)
    try {
      const res = await window.hive.partnerAuth.publish(session, next)
      if (!res.ok) {
        showToast('error', res.error)
        const news = await window.hive.partnerAuth.loadNews(session)
        if (news.ok) setItems(news.feed.items)
        return
      }
      showToast('success', 'Post deleted on GitHub')
      fingerprintRef.current = ''
      await loadPublic(true, false, { alwaysSet: true })
      // Also refresh editor from server snapshot
      const news = await window.hive.partnerAuth.loadNews(session)
      if (news.ok) {
        setItems(news.feed.items)
        const first = news.feed.items[0]
        setSelectedId(first?.id ?? null)
        setDraft(first ? { ...first } : null)
      }
    } finally {
      setPublishing(false)
    }
  }

  async function publish() {
    if (!session) return
    const list =
      draft && items.some((i) => i.id === draft.id)
        ? items.map((i) => (i.id === draft.id ? { ...draft, tag: newsTag } : i))
        : items.map((i) => ({ ...i, tag: newsTag }))
    const cleaned = list
      .map((i) => ({
        ...i,
        title: i.title.trim(),
        summary: (i.summary || '').trim(),
        body: (i.body || '').trim(),
        tag: newsTag,
        url: i.url && String(i.url).trim() ? String(i.url).trim() : null,
      }))
      .filter((i) => i.title)
    if (cleaned.length === 0) {
      showToast('error', 'Add at least one post with a title')
      return
    }
    setPublishing(true)
    try {
      const res = await window.hive.partnerAuth.publish(session, cleaned)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', res.message)
      setItems(cleaned)
      // Immediately show published posts in the public list (don't wait for poll)
      fingerprintRef.current = ''
      setFeed({
        title: 'EG Partner News',
        updated: new Date().toISOString(),
        sourceUrl: 'local-publish',
        sourceType: 'json',
        items: cleaned,
        fromCache: false,
      })
      await loadPublic(true, true, { alwaysSet: true })
    } finally {
      setPublishing(false)
    }
  }

  const publicItems = feed?.items || []

  return (
    <section className="panel partner-news-panel" style={{ marginTop: 16 }}>
      <div className="home-news-header">
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 2 }}>Partner News</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            Tag: <span className="mono">{newsTag}</span>
          </p>
        </div>
        {!session ? (
          <button type="button" className="btn btn-ghost" onClick={() => setEditorOpen((v) => !v)}>
            {editorOpen ? 'Close login' : 'Partner login'}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Log out partner
          </button>
        )}
      </div>

      {/* Public feed */}
      {loading && !feed && <div className="skeleton" style={{ height: 100, borderRadius: 14 }} />}
      {!loading && publicItems.length === 0 && (
        <div className="empty" style={{ padding: 20 }}>
          <h3>No partner news yet</h3>
          <p>Announcements for {partnerTitle} will appear here.</p>
        </div>
      )}
      {publicItems.length > 0 && (
        <div className="home-news-list" style={{ marginBottom: session ? 18 : 0 }}>
          {publicItems.map((item) => {
            const open = expandedId === item.id
            return (
              <article key={item.id} className={`home-news-card${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="home-news-card-head"
                  onClick={() => setExpandedId(open ? null : item.id)}
                >
                  <div className="home-news-card-meta">
                    <span className="badge badge-blue">{item.tag || newsTag}</span>
                    <time dateTime={item.date}>{formatNewsDate(item.date)}</time>
                  </div>
                  <h3 className="home-news-title">{item.title}</h3>
                  {!open && (item.summary || item.body) && (
                    <p className="home-news-preview">{item.summary || item.body}</p>
                  )}
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

      {/* Partner login */}
      {editorOpen && !session && (
        <form className="partner-login-form" onSubmit={login} onClick={(e) => e.stopPropagation()}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Partner news login</h3>
          <div className="form-grid">
            <div className="form-row">
              <label htmlFor="p-user">Username</label>
              <input
                id="p-user"
                className="input"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="p-pass">Password</label>
              <input
                id="p-pass"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          {authError && (
            <p className="hint" style={{ color: 'var(--red)', marginTop: 8 }}>
              {authError}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={loginBusy || !username || !password}
          >
            {loginBusy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}

      {/* Partner editor */}
      {session && (
        <div className="partner-editor" style={{ marginTop: 8 }}>
          <div className="page-header" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 15, margin: 0 }}>Edit {newsTag} posts</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => void addPost()}>
                Add post
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={publishing}
                onClick={() => void publish()}
              >
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
          <div className="admin-news-layout">
            <div className="admin-news-list">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`admin-news-list-item${selectedId === item.id ? ' active' : ''}`}
                  onClick={() => selectPost(item.id)}
                >
                  <strong>{item.title || '(untitled)'}</strong>
                  <span>{formatNewsDate(item.date)}</span>
                </button>
              ))}
            </div>
            <div>
              {!draft ? (
                <p className="hint">Select or add a post.</p>
              ) : (
                <form className="form-grid" onSubmit={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
                  <div className="form-row">
                    <label>Title</label>
                    <input
                      className="input"
                      type="text"
                      value={draft.title}
                      onChange={(e) => updateDraft({ title: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label>Tag (fixed)</label>
                    <input className="input" type="text" value={newsTag} readOnly />
                  </div>
                  <div className="form-row">
                    <label>Summary</label>
                    <input
                      className="input"
                      type="text"
                      value={draft.summary || ''}
                      onChange={(e) => updateDraft({ summary: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label>Body</label>
                    <textarea
                      className="input admin-textarea"
                      rows={6}
                      value={draft.body || ''}
                      onChange={(e) => updateDraft({ body: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <label>Link (optional)</label>
                    <input
                      className="input"
                      type="url"
                      value={draft.url || ''}
                      onChange={(e) => updateDraft({ url: e.target.value || null })}
                    />
                  </div>
                  <button type="button" className="btn btn-danger" onClick={() => void deletePost()}>
                    Delete post
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
