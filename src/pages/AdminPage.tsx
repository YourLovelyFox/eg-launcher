import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewsItem } from '../../shared/types'
import { useAppStore } from '../store'
import { AdminOfflinePanel } from './AdminOfflinePanel'
import { AdminPartnersPanel } from './AdminPartnersPanel'

const SESSION_KEY = 'eg-admin-session'

function emptyItem(id: string): NewsItem {
  return {
    id,
    title: '',
    summary: '',
    body: '',
    date: new Date().toISOString(),
    tag: 'announcement',
    url: null,
  }
}

function toLocalInput(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}

/**
 * Dev-only Home News editor (no password — only compiled into Dev launcher).
 */
export function AdminPage() {
  const { showToast } = useAppStore()
  const [session, setSession] = useState<string>(() => sessionStorage.getItem(SESSION_KEY) || '')
  const [bootError, setBootError] = useState('')
  const [booting, setBooting] = useState(!sessionStorage.getItem(SESSION_KEY))

  const [hasGithubToken, setHasGithubToken] = useState(false)
  const [tokenFromFile, setTokenFromFile] = useState(false)
  const [githubTokenInput, setGithubTokenInput] = useState('')
  const [repo, setRepo] = useState('')
  const [feedPath, setFeedPath] = useState('news/feed.json')

  const [items, setItems] = useState<NewsItem[]>([])
  const [title, setTitle] = useState('EG Launcher News')
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NewsItem | null>(null)
  const [tab, setTab] = useState<'news' | 'partners' | 'offline'>('news')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editingRef = useRef(false)

  const refreshStatus = useCallback(async (token: string) => {
    if (!token) return
    const st = await window.hive.admin.status(token)
    if (!st.authenticated) {
      sessionStorage.removeItem(SESSION_KEY)
      setSession('')
      return
    }
    setHasGithubToken(st.hasGithubToken)
    setTokenFromFile(Boolean(st.tokenFromLocalFile))
    setRepo(st.repo)
    setFeedPath(st.feedPath)
  }, [])

  const loadNews = useCallback(
    async (token: string, opts?: { keepSelection?: boolean }) => {
      setLoading(true)
      try {
        const res = await window.hive.admin.loadNews(token)
        if (!res.ok) {
          showToast('error', res.error)
          return
        }
        const list = res.feed.items || []
        setItems(list)
        setTitle(res.feed.title || 'EG Launcher News')

        setSelectedId((prev) => {
          if (opts?.keepSelection && prev && list.some((i) => i.id === prev)) {
            if (!editingRef.current) {
              const found = list.find((i) => i.id === prev)!
              setDraft({ ...found })
            }
            return prev
          }
          const first = list[0] || null
          setDraft(first ? { ...first } : null)
          return first?.id ?? null
        })
      } catch (err) {
        showToast('error', (err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [showToast],
  )

  // Auto-unlock on open (Dev only — Live build has no Admin route)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!window.hive.admin.isEnabled()) {
        setBootError(
          'Admin is locked on this PC. Create admin.local.json with "enableAdmin": true, or Desktop\\New folder\\eg-launcher-admin-unlock',
        )
        setBooting(false)
        return
      }
      let token = sessionStorage.getItem(SESSION_KEY) || ''
      if (token) {
        const st = await window.hive.admin.status(token)
        if (!st.authenticated) token = ''
      }
      if (!token) {
        const res = await window.hive.admin.login('')
        if (!res.ok) {
          if (!cancelled) {
            setBootError(res.error)
            setBooting(false)
          }
          return
        }
        token = res.sessionToken
        sessionStorage.setItem(SESSION_KEY, token)
      }
      if (cancelled) return
      setSession(token)
      setBooting(false)
      await refreshStatus(token)
      await loadNews(token, { keepSelection: false })
    })().catch((err) => {
      if (!cancelled) {
        setBootError((err as Error).message)
        setBooting(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [refreshStatus, loadNews])

  function selectPost(id: string) {
    editingRef.current = false
    setSelectedId(id)
    const found = items.find((i) => i.id === id)
    setDraft(found ? { ...found } : null)
    window.setTimeout(() => {
      titleInputRef.current?.focus({ preventScroll: true })
    }, 0)
  }

  function updateDraft(patch: Partial<NewsItem>) {
    editingRef.current = true
    setDraft((d) => {
      if (!d) return d
      const next = { ...d, ...patch }
      setItems((list) => list.map((i) => (i.id === next.id ? next : i)))
      return next
    })
  }

  async function logout() {
    if (session) await window.hive.admin.logout(session)
    sessionStorage.removeItem(SESSION_KEY)
    setSession('')
    setItems([])
    setDraft(null)
    setSelectedId(null)
    setGithubTokenInput('')
    editingRef.current = false
    // Immediately re-open (still Dev)
    setBooting(true)
    const res = await window.hive.admin.login('')
    if (res.ok) {
      sessionStorage.setItem(SESSION_KEY, res.sessionToken)
      setSession(res.sessionToken)
      setBooting(false)
      await refreshStatus(res.sessionToken)
      await loadNews(res.sessionToken, { keepSelection: false })
    } else {
      setBootError(res.error)
      setBooting(false)
    }
  }

  async function saveToken() {
    if (!session) return
    const res = await window.hive.admin.setGithubToken(session, githubTokenInput)
    if (!res.ok) {
      showToast('error', res.error || 'Failed to save token')
      return
    }
    const hadValue = Boolean(githubTokenInput.trim())
    setGithubTokenInput('')
    await refreshStatus(session)
    showToast('success', hadValue ? 'GitHub token saved' : 'GitHub token cleared')
  }

  async function addItem() {
    const id = await window.hive.admin.newId()
    const item = emptyItem(id)
    setItems((list) => [item, ...list])
    setSelectedId(id)
    setDraft({ ...item })
    editingRef.current = false
    window.setTimeout(() => titleInputRef.current?.focus({ preventScroll: true }), 0)
  }

  function cleanItems(list: NewsItem[], { allowEmpty }: { allowEmpty: boolean }): NewsItem[] | null {
    const withDraft =
      draft && list.some((i) => i.id === draft.id)
        ? list.map((i) => (i.id === draft.id ? draft : i))
        : list

    const cleaned = withDraft
      .map((i) => ({
        ...i,
        title: i.title.trim(),
        summary: (i.summary || '').trim(),
        body: (i.body || '').trim(),
        tag: (i.tag || 'info').trim() || 'info',
        url: null,
      }))
      .filter((i) => i.title)

    if (!allowEmpty && cleaned.length === 0) return null
    return cleaned
  }

  async function publishList(list: NewsItem[], opts?: { allowEmpty?: boolean; successMsg?: string }) {
    if (!session) return false
    const cleaned = cleanItems(list, { allowEmpty: Boolean(opts?.allowEmpty) })
    if (cleaned === null) {
      showToast('error', 'Add at least one news item with a title')
      return false
    }

    setPublishing(true)
    editingRef.current = false
    try {
      const res = await window.hive.admin.publishNews(
        session,
        cleaned,
        title.trim() || 'EG Launcher News',
      )
      if (!res.ok) {
        showToast('error', res.error)
        return false
      }
      showToast('success', opts?.successMsg || res.message)
      await loadNews(session, { keepSelection: true })
      return true
    } catch (err) {
      showToast('error', (err as Error).message)
      return false
    } finally {
      setPublishing(false)
    }
  }

  async function removeSelected() {
    if (!selectedId || !session) return
    const doomed = draft?.id === selectedId ? draft : items.find((i) => i.id === selectedId)
    const label = doomed?.title?.trim() || 'this post'
    if (
      !window.confirm(
        `Delete "${label}" from the launcher AND from the CMS on GitHub?\n\nThis cannot be undone.`,
      )
    ) {
      return
    }

    const next = items.filter((i) => i.id !== selectedId)
    setItems(next)
    const nextSel = next[0] || null
    setSelectedId(nextSel?.id ?? null)
    setDraft(nextSel ? { ...nextSel } : null)
    editingRef.current = false

    const ok = await publishList(next, {
      allowEmpty: true,
      successMsg: 'Post deleted and feed updated on GitHub.',
    })
    if (!ok) {
      showToast('error', 'Delete was not saved to GitHub — reloading feed')
      await loadNews(session, { keepSelection: false })
    }
  }

  async function publish() {
    const list =
      draft && items.some((i) => i.id === draft.id)
        ? items.map((i) => (i.id === draft.id ? draft : i))
        : items
    setItems(list)
    await publishList(list, { allowEmpty: false })
  }

  if (booting) {
    return (
      <div className="page">
        <div className="empty" style={{ padding: 40 }}>
          <h3>Opening Admin…</h3>
        </div>
      </div>
    )
  }

  if (bootError || !session) {
    return (
      <div className="page">
        <div className="empty" style={{ padding: 40 }}>
          <h3>Admin unavailable</h3>
          <p>{bootError || 'Could not open Admin session.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="kicker">Dev only · unlock file required</div>
          <h1>Admin</h1>
          <p>
            CMS: private <span className="mono">eg-launcher-content</span> + public mirrors. Token from{' '}
            <span className="mono">admin.local.json</span> / Desktop token file.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tab === 'news' && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  editingRef.current = false
                  loadNews(session, { keepSelection: true })
                }}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Reload news'}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void publish()} disabled={publishing}>
                {publishing ? 'Publishing…' : 'Publish news'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="admin-tabs" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={`btn ${tab === 'news' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('news')}
        >
          Home News
        </button>
        <button
          type="button"
          className={`btn ${tab === 'partners' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('partners')}
        >
          Partners
        </button>
        <button
          type="button"
          className={`btn ${tab === 'offline' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('offline')}
        >
          Offline accounts
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16 }}>GitHub token (this PC only)</h2>
        <p className="hint">
          Needed for publish. File: <span className="mono">Desktop\New folder\eg-launcher-github-token.txt</span> or{' '}
          <span className="mono">admin.local.json</span> with enableAdmin + githubToken.
        </p>
        <div className="badge-row" style={{ marginBottom: 10 }}>
          <span className={`badge${hasGithubToken ? ' badge-green' : ' badge-orange'}`}>
            {hasGithubToken
              ? tokenFromFile
                ? 'Token loaded from local file'
                : 'Token saved on this PC'
              : 'Token required to publish'}
          </span>
          <span className="badge">{feedPath}</span>
          <span className="badge">{repo}</span>
        </div>
        {!tokenFromFile && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 220 }}
              type="password"
              name="github-token"
              autoComplete="off"
              placeholder={hasGithubToken ? 'Paste new token to replace' : 'ghp_… or github_pat_…'}
              value={githubTokenInput}
              onChange={(e) => setGithubTokenInput(e.target.value)}
            />
            <button type="button" className="btn btn-secondary" onClick={() => void saveToken()}>
              Save token
            </button>
          </div>
        )}
      </div>

      {tab === 'partners' && <AdminPartnersPanel session={session} />}
      {tab === 'offline' && <AdminOfflinePanel session={session} />}

      {tab === 'news' && (
      <div className="admin-news-layout">
        <div className="panel admin-news-list-panel">
          <div className="page-header" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Posts</h2>
            <button type="button" className="btn btn-secondary" onClick={() => void addItem()}>
              Add post
            </button>
          </div>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <label htmlFor="feed-title">Feed title</label>
            <input
              id="feed-title"
              className="input"
              type="text"
              name="feed-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="admin-news-list">
            {items.length === 0 && <p className="hint">No posts yet. Click Add post.</p>}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`admin-news-list-item${selectedId === item.id ? ' active' : ''}`}
                onClick={() => selectPost(item.id)}
              >
                <strong>{item.title || '(untitled)'}</strong>
                <span>
                  {item.tag || 'info'} · {item.date ? new Date(item.date).toLocaleDateString() : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel admin-news-editor">
          {!draft ? (
            <div className="empty" style={{ padding: 28 }}>
              <h3>Select a post</h3>
              <p>Or add a new one to start writing.</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void publish()
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="page-header" style={{ marginBottom: 12 }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>Edit post</h2>
                <button type="button" className="btn btn-danger" onClick={() => void removeSelected()}>
                  Delete
                </button>
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label htmlFor="news-title">Title</label>
                  <input
                    ref={titleInputRef}
                    id="news-title"
                    className="input"
                    type="text"
                    name="news-title"
                    autoComplete="off"
                    value={draft.title}
                    onChange={(e) => updateDraft({ title: e.target.value })}
                    onFocus={() => {
                      editingRef.current = true
                    }}
                    onBlur={() => {
                      window.setTimeout(() => {
                        editingRef.current = false
                      }, 200)
                    }}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="news-tag">Tag</label>
                  <select
                    id="news-tag"
                    className="input"
                    name="news-tag"
                    value={draft.tag || 'info'}
                    onChange={(e) => updateDraft({ tag: e.target.value })}
                  >
                    <option value="announcement">announcement</option>
                    <option value="update">update</option>
                    <option value="partner">partner</option>
                    <option value="event">event</option>
                    <option value="info">info</option>
                  </select>
                </div>
                <div className="form-row">
                  <label htmlFor="news-date">Date</label>
                  <input
                    id="news-date"
                    className="input"
                    type="datetime-local"
                    name="news-date"
                    value={toLocalInput(draft.date)}
                    onChange={(e) =>
                      updateDraft({
                        date: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : new Date().toISOString(),
                      })
                    }
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="news-summary">Summary (card preview)</label>
                  <input
                    id="news-summary"
                    className="input"
                    type="text"
                    name="news-summary"
                    autoComplete="off"
                    value={draft.summary || ''}
                    onChange={(e) => updateDraft({ summary: e.target.value })}
                    onFocus={() => {
                      editingRef.current = true
                    }}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="news-body">Body</label>
                  <textarea
                    id="news-body"
                    className="input admin-textarea"
                    name="news-body"
                    rows={8}
                    value={draft.body || ''}
                    onChange={(e) => updateDraft({ body: e.target.value })}
                    onFocus={() => {
                      editingRef.current = true
                    }}
                  />
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
