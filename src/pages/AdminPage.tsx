import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewsItem } from '../../shared/types'
import { useAppStore } from '../store'
import { AdminOfflinePanel } from './AdminOfflinePanel'
import { AdminPartnersPanel } from './AdminPartnersPanel'
import { AdminHealthPanel } from './AdminHealthPanel'
import { AdminFeaturedPanel } from './AdminFeaturedPanel'
import { AdminApprovalsPanel } from './AdminApprovalsPanel'
import { AdminStaffUsersPanel } from './AdminStaffUsersPanel'
import { AdminAdsPanel } from './AdminAdsPanel'

const SESSION_KEY = 'eg-admin-session'
const SESSION_EXPIRES_KEY = 'eg-admin-session-expires'

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

  const [repo, setRepo] = useState('')
  const [feedPath, setFeedPath] = useState('CMS')

  const [items, setItems] = useState<NewsItem[]>([])
  const [title, setTitle] = useState('EG Launcher News')
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NewsItem | null>(null)
  const [tab, setTab] = useState<
    'news' | 'partners' | 'offline' | 'health' | 'featured' | 'approvals' | 'staff' | 'ads'
  >('news')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editingRef = useRef(false)
  const [staffUser, setStaffUser] = useState('')
  const [staffPass, setStaffPass] = useState('')
  const [staffInfo, setStaffInfo] = useState<{
    username: string
    role: string
    offlineQuota: number
    offlineUsed: number
  } | null>(null)
  const [mustQueue, setMustQueue] = useState(false)
  const [sessionEndsAt, setSessionEndsAt] = useState<number | null>(() => {
    const raw = sessionStorage.getItem(SESSION_EXPIRES_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? n : null
  })
  const [remainLabel, setRemainLabel] = useState('')

  const forceLogout = useCallback(
    async (reason?: string) => {
      const tok = sessionStorage.getItem(SESSION_KEY) || session
      if (tok) {
        try {
          await window.hive.admin.logout(tok)
        } catch {
          /* ignore */
        }
      }
      try {
        await window.hive.admin.staffLogout()
      } catch {
        /* ignore */
      }
      sessionStorage.removeItem(SESSION_KEY)
      sessionStorage.removeItem(SESSION_EXPIRES_KEY)
      setSession('')
      setStaffInfo(null)
      setMustQueue(false)
      setSessionEndsAt(null)
      setItems([])
      setDraft(null)
      if (reason) showToast('error', reason)
    },
    [session, showToast],
  )

  const refreshStatus = useCallback(async (token: string) => {
    if (!token) return
    const st = await window.hive.admin.status(token)
    if (!st.authenticated) {
      sessionStorage.removeItem(SESSION_KEY)
      sessionStorage.removeItem(SESSION_EXPIRES_KEY)
      setSession('')
      setStaffInfo(null)
      setSessionEndsAt(null)
      return
    }
    setRepo(st.repo)
    setFeedPath(st.feedPath)
    if (st.expiresAt && typeof st.expiresAt === 'number') {
      setSessionEndsAt(st.expiresAt)
      sessionStorage.setItem(SESSION_EXPIRES_KEY, String(st.expiresAt))
    }
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

  // CMS staff account required (no local unlock files)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setBootError('')
      // Absolute 5‑minute timeout stored at login
      const expRaw = sessionStorage.getItem(SESSION_EXPIRES_KEY)
      const exp = expRaw ? Number(expRaw) : 0
      if (exp && Date.now() >= exp) {
        sessionStorage.removeItem(SESSION_KEY)
        sessionStorage.removeItem(SESSION_EXPIRES_KEY)
      }
      let token = sessionStorage.getItem(SESSION_KEY) || ''
      if (token) {
        const st = await window.hive.admin.status(token)
        if (!st.authenticated) {
          token = ''
          sessionStorage.removeItem(SESSION_KEY)
          sessionStorage.removeItem(SESSION_EXPIRES_KEY)
        }
      }
      if (cancelled) return
      if (!token) {
        setSession('')
        setBooting(false)
        setStaffInfo(null)
        setMustQueue(false)
        setSessionEndsAt(null)
        return
      }
      setSession(token)
      setBooting(false)
      await refreshStatus(token)
      try {
        const me = await window.hive.admin.staffMe()
        if (!me?.staff) {
          sessionStorage.removeItem(SESSION_KEY)
          sessionStorage.removeItem(SESSION_EXPIRES_KEY)
          setSession('')
          setStaffInfo(null)
          return
        }
        setStaffInfo(me.staff)
        setMustQueue(Boolean(me.mustQueue))
      } catch {
        setStaffInfo(null)
        setMustQueue(false)
      }
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

  // Idle countdown + auto sign-out after 5 minutes without activity
  useEffect(() => {
    if (!session || !sessionEndsAt) {
      setRemainLabel('')
      return
    }
    const tick = () => {
      const left = sessionEndsAt - Date.now()
      if (left <= 0) {
        setRemainLabel('0:00')
        void forceLogout('Session timed out. Please sign in again under Settings → Staff.')
        return
      }
      const m = Math.floor(left / 60000)
      const s = Math.floor((left % 60000) / 1000)
      setRemainLabel(`${m}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [session, sessionEndsAt, forceLogout])

  // Clicks, typing, scrolling, tab switches → reset idle timer (30 min staff session)
  useEffect(() => {
    if (!session) return
    let lastLocal = 0
    const onActivity = () => {
      const now = Date.now()
      if (now - lastLocal < 1000) return
      lastLocal = now
      void window.hive.admin.touchSession(session).then((res) => {
        if (!res.ok) {
          if (res.error?.toLowerCase().includes('expired')) {
            void forceLogout('Session timed out. Please sign in again under Settings → Staff.')
          }
          return
        }
        setSessionEndsAt(res.expiresAt)
        sessionStorage.setItem(SESSION_EXPIRES_KEY, String(res.expiresAt))
      })
    }
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('pointerdown', onActivity, opts)
    window.addEventListener('keydown', onActivity, opts)
    window.addEventListener('input', onActivity, opts)
    window.addEventListener('scroll', onActivity, opts)
    window.addEventListener('wheel', onActivity, opts)
    window.addEventListener('focus', onActivity, opts)
    return () => {
      window.removeEventListener('pointerdown', onActivity, opts)
      window.removeEventListener('keydown', onActivity, opts)
      window.removeEventListener('input', onActivity, opts)
      window.removeEventListener('scroll', onActivity, opts)
      window.removeEventListener('wheel', onActivity, opts)
      window.removeEventListener('focus', onActivity, opts)
    }
  }, [session, forceLogout])

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
    await forceLogout()
    setSelectedId(null)
    editingRef.current = false
    setBooting(false)
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
      const me = await window.hive.admin.staffMe()
      if (me?.mustQueue) {
        const sub = await window.hive.admin.submitApproval(session, {
          type: 'news_launcher',
          summary: `Home news update (${cleaned.length} posts)`,
          payload: { title: title.trim() || 'EG Launcher News', items: cleaned },
        })
        if (!sub.ok) {
          showToast('error', sub.error)
          return false
        }
        showToast('success', sub.message || 'Submitted for admin verification')
        return true
      }
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
        `Delete "${label}" from the launcher CMS?\n\nThis cannot be undone.`,
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
      successMsg: 'Post deleted and feed updated on CMS.',
    })
    if (!ok) {
      showToast('error', 'Delete was not saved to CMS — reloading feed')
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

  async function doStaffLogin() {
    const res = await window.hive.admin.staffLogin(staffUser, staffPass)
    if (!res.ok) {
      showToast('error', res.error)
      return
    }
    const local = await window.hive.admin.login('')
    if (!local.ok) {
      showToast('error', local.error)
      return
    }
    const expiresAt =
      typeof local.expiresAt === 'number'
        ? local.expiresAt
        : typeof res.expiresAt === 'number'
          ? res.expiresAt
          : Date.now() + 5 * 60 * 1000
    sessionStorage.setItem(SESSION_KEY, local.sessionToken)
    sessionStorage.setItem(SESSION_EXPIRES_KEY, String(expiresAt))
    setSessionEndsAt(expiresAt)
    setSession(local.sessionToken)
    setStaffInfo(res.staff)
    setMustQueue(res.staff.role === 'staff')
    setStaffPass('')
    setBootError('')
    showToast(
      'success',
      `Signed in as ${res.staff.username} (${res.staff.role}) · idle timeout 30 min`,
    )
    await refreshStatus(local.sessionToken)
    await loadNews(local.sessionToken, { keepSelection: false })
  }

  if (booting) {
    return (
      <div className="page">
        <div className="empty" style={{ padding: 40 }}>
          <h3>Opening Staff Menu…</h3>
        </div>
      </div>
    )
  }

  if (!session || !staffInfo) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <div className="kicker">CMS accounts</div>
            <h1>Staff Menu</h1>
            <p>Sign in with a Staff or Admin account. Multiple admins are supported.</p>
          </div>
        </div>
        <div className="panel" style={{ maxWidth: 420 }}>
          <h2 style={{ fontSize: 15 }}>Staff / Admin login</h2>
          {bootError && <p className="hint" style={{ color: 'var(--danger, #f66)' }}>{bootError}</p>}
          <div className="form-row">
            <label>Username</label>
            <input
              className="input"
              value={staffUser}
              onChange={(e) => setStaffUser(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="form-row">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={staffPass}
              onChange={(e) => setStaffPass(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doStaffLogin()
              }}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={!staffUser.trim() || !staffPass}
            onClick={() => void doStaffLogin()}
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="kicker">CMS · account based</div>
          <h1>Staff Menu</h1>
          <p>
            Signed in as <strong>{staffInfo.username}</strong> · role{' '}
            <strong>{staffInfo.role}</strong>
            {mustQueue ? ' · changes require Admin verification' : ' · full admin access'}
            {remainLabel ? (
              <>
                {' '}
                · session ends in <strong className="mono">{remainLabel}</strong>
              </>
            ) : null}
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
                {publishing ? '…' : mustQueue ? 'Submit for review' : 'Publish news'}
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>

      <div className="admin-tabs" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
          {staffInfo?.role === 'staff'
            ? ` (${staffInfo.offlineUsed ?? 0}/${staffInfo.offlineQuota ?? 3})`
            : ''}
        </button>
        <button
          type="button"
          className={`btn ${tab === 'featured' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('featured')}
        >
          Featured packs
        </button>
        {/* Admin-only: review queue, staff accounts, ads monetization */}
        {(!staffInfo || staffInfo.role === 'admin') && (
          <>
            <button
              type="button"
              className={`btn ${tab === 'approvals' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('approvals')}
            >
              Approvals
            </button>
            <button
              type="button"
              className={`btn ${tab === 'staff' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('staff')}
            >
              Staff users
            </button>
            <button
              type="button"
              className={`btn ${tab === 'ads' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('ads')}
            >
              Ads / PayPal
            </button>
          </>
        )}
        <button
          type="button"
          className={`btn ${tab === 'health' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('health')}
        >
          Health
        </button>
      </div>

      <div className="badge-row" style={{ marginBottom: 12 }}>
        <span className="badge badge-green">CMS session active</span>
        <span className="badge">{feedPath}</span>
        <span className="badge">{repo}</span>
      </div>

      {tab === 'partners' && <AdminPartnersPanel session={session} />}
      {tab === 'offline' && <AdminOfflinePanel session={session} />}
      {tab === 'health' && <AdminHealthPanel session={session} />}
      {tab === 'featured' && <AdminFeaturedPanel session={session} />}
      {tab === 'approvals' && <AdminApprovalsPanel session={session} />}
      {tab === 'staff' && <AdminStaffUsersPanel session={session} />}
      {tab === 'ads' && <AdminAdsPanel session={session} />}

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
