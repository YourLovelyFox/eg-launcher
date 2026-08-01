import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AdsBanner } from './AdsBanner'
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  FEATURED_PACK,
  IS_PRE_RELEASE,
  PARTNER_LIST,
  RELEASE_CHANNEL_LABEL,
} from '../../shared/branding'
import type { PartnerDefinition } from '../../shared/branding'
import appIcon from '../assets/app-icon.png'
import horizonsIcon from '../assets/horizons-smp.png'
import {
  loadQolPrefs,
  partnerNewsFingerprint,
  togglePinnedPartner,
} from '../qolPrefs'
import { useAppStore } from '../store'
import {
  IconCube,
  IconHome,
  IconPack,
  IconSearch,
  IconSettings,
  IconStop,
  IconUser,
} from './Icons'
import { PlayerHeadWithFallback } from './PlayerHead'
import { UpdateModal } from './UpdateModal'

function partnerNavIcon(p: PartnerDefinition): string | null {
  if (p.iconUrl) return p.iconUrl
  if (p.id === 'horizons-smp') return horizonsIcon
  return null
}

export function Layout() {
  const navigate = useNavigate()
  const {
    accounts,
    activeAccountId,
    toast,
    clearToast,
    running,
    refreshRunning,
    stopGame,
    setAccounts,
    showToast,
    selectedInstanceId,
    setSelectedInstanceId,
    instances,
    refreshAll,
  } = useAppStore()
  const active = accounts.find((a) => a.id === activeAccountId)
  const loggedIn = Boolean(active)
  const [partners, setPartners] = useState<PartnerDefinition[]>(() => [...PARTNER_LIST])
  const [featured, setFeatured] = useState<Array<{ id: string; menuLabel: string; slug: string }>>([
    { id: FEATURED_PACK.id, menuLabel: FEATURED_PACK.menuLabel, slug: FEATURED_PACK.slug },
  ])
  const [prefsTick, setPrefsTick] = useState(0)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [partnerUnread, setPartnerUnread] = useState<Record<string, boolean>>({})

  const loadPartners = useCallback(async () => {
    try {
      const list = await window.hive.partners.list()
      if (Array.isArray(list) && list.length > 0) {
        setPartners(list)
      }
    } catch {
      /* keep fallback */
    }
  }, [])

  const loadFeatured = useCallback(async () => {
    try {
      const packs = await window.hive.featuredPacks.listPublic()
      if (Array.isArray(packs) && packs.length > 0) {
        setFeatured(
          packs.map((p: { id: string; menuLabel?: string; title?: string; slug: string }) => ({
            id: p.id,
            menuLabel: p.menuLabel || p.title || p.slug,
            slug: p.slug,
          })),
        )
      }
    } catch {
      /* keep bees fallback */
    }
  }, [])

  // Defer network chrome until after first paint — never blocks shell
  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (cancelled) return
      void loadPartners()
      void loadFeatured()
    }
    const kick = window.setTimeout(run, 400)
    // Partners/featured change rarely — poll much less often than before
    const id = window.setInterval(run, 5 * 60_000)
    return () => {
      cancelled = true
      window.clearTimeout(kick)
      window.clearInterval(id)
    }
  }, [loadPartners, loadFeatured])

  useEffect(() => {
    // Soft poll while game may be running; start delayed so boot stays light
    const start = window.setTimeout(() => {
      void refreshRunning()
    }, 800)
    const id = window.setInterval(() => {
      void refreshRunning()
    }, 4000)
    return () => {
      window.clearTimeout(start)
      window.clearInterval(id)
    }
  }, [refreshRunning])

  // Partner news unread badges — deferred sequential fetch, not on critical path
  useEffect(() => {
    let cancelled = false
    async function scan() {
      const prefs = loadQolPrefs()
      const next: Record<string, boolean> = {}
      for (const p of partners) {
        if (cancelled) return
        try {
          const feed = await window.hive.news.fetch({
            kind: 'partners',
            tag: p.newsTag,
            force: false,
          })
          const items = (feed.items || []).filter(
            (i) => (i.tag || '').toLowerCase() === (p.newsTag || '').toLowerCase(),
          )
          const fp = partnerNewsFingerprint(items)
          const seen = prefs.partnerNewsSeen[p.id]
          next[p.id] = Boolean(fp && fp !== 'empty' && seen !== fp)
        } catch {
          next[p.id] = false
        }
      }
      if (!cancelled) setPartnerUnread(next)
    }
    if (!partners.length) return
    const kick = window.setTimeout(() => void scan(), 2000)
    const id = window.setInterval(() => void scan(), 3 * 60_000)
    return () => {
      cancelled = true
      window.clearTimeout(kick)
      window.clearInterval(id)
    }
  }, [partners])

  // Ctrl+K or / → Browse search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const tag = (t?.tagName || '').toLowerCase()
      const typing =
        tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate('/browse')
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('.search-box input')?.focus()
        }, 80)
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        navigate('/browse')
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('.search-box input')?.focus()
        }, 80)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const sortedPartners = useMemo(() => {
    const pinned = loadQolPrefs().pinnedPartnerIds
    return [...partners].sort((a, b) => {
      const ap = pinned.includes(a.id) ? 0 : 1
      const bp = pinned.includes(b.id) ? 0 : 1
      if (ap !== bp) return ap - bp
      return (a.menuLabel || a.title).localeCompare(b.menuLabel || b.title)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners, prefsTick])

  async function switchAccount(id: string) {
    try {
      const auth = await window.hive.auth.setActive(id)
      setAccounts(auth.accounts, auth.activeAccountId)
      setAccountMenuOpen(false)
      showToast('success', `Switched to ${auth.accounts.find((a) => a.id === id)?.username || 'account'}`)
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  async function onDropFiles(files: FileList | File[]) {
    const list = Array.from(files)
    const jars = list.filter((f) => f.name.toLowerCase().endsWith('.jar'))
    const packs = list.filter((f) => {
      const n = f.name.toLowerCase()
      return n.endsWith('.egpack') || n.endsWith('.mrpack')
    })
    if (packs.length) {
      const pack = packs[0] as File & { path?: string }
      const filePath = pack.path
      if (!filePath) {
        showToast('error', 'Could not read pack path (use Electron drop)')
      } else {
        showToast('info', `Importing ${pack.name}…`)
        try {
          const off = window.hive.instances.onPackProgress(() => {})
          const res = await window.hive.instances.importPack({ filePath })
          off()
          if (res.ok) {
            setSelectedInstanceId(res.instance.id)
            await refreshAll()
            showToast(
              'success',
              `Imported “${res.instance.name}” (.${res.format === 'egpack' ? 'egpack' : 'mrpack'})`,
            )
            navigate(`/instances/${encodeURIComponent(res.instance.id)}`)
          }
        } catch (err) {
          showToast('error', (err as Error).message)
        }
      }
      if (!jars.length) return
    }
    if (!jars.length) {
      showToast('error', 'Drop a .jar mod, .egpack, or .mrpack onto the launcher')
      return
    }
    const instanceId =
      selectedInstanceId ||
      loadQolPrefs().lastInstanceId ||
      instances[0]?.id ||
      null
    if (!instanceId) {
      showToast('error', 'Create or select an instance first')
      navigate('/instances')
      return
    }
    setSelectedInstanceId(instanceId)
    for (const file of jars) {
      const anyFile = file as File & { path?: string }
      const filePath = anyFile.path
      if (!filePath) {
        showToast('error', 'Could not read file path (use Electron drop)')
        continue
      }
      try {
        await window.hive.instances.installLocalJar(instanceId, filePath)
        showToast('success', `Installed ${file.name}`)
        await refreshAll()
      } catch (err) {
        showToast('error', (err as Error).message)
      }
    }
  }

  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer?.files?.length) void onDropFiles(e.dataTransfer.files)
      }}
    >
      <div className="app-bg" aria-hidden>
        <div className="app-bg-base" />
        <div className="app-bg-mesh" />
        <div className="app-bg-grid" />
        <div className="app-bg-vignette" />
      </div>

      {dragOver && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(15, 159, 110, 0.18)',
            border: '3px dashed var(--green)',
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          Drop .jar mods to install into the selected instance
        </div>
      )}

      <aside className="sidebar">
        <div className="brand">
          <img
            src={appIcon}
            alt=""
            className="brand-mark brand-mark-img"
            width={32}
            height={32}
            draggable={false}
          />
          <div className="brand-text">
            <strong>
              {APP_NAME}
              {IS_PRE_RELEASE ? (
                <span className="badge badge-beta" title="Pre-release build">
                  {RELEASE_CHANNEL_LABEL}
                </span>
              ) : null}
            </strong>
            <span>
              {APP_TAGLINE} · v{APP_VERSION}
              {IS_PRE_RELEASE ? ' (pre-release)' : ''}
            </span>
          </div>
        </div>

        <nav className="nav-scroll">
          <div className="nav-section">
            <div className="nav-label">Library</div>
            <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <IconHome />
              Home
            </NavLink>
            <NavLink
              to="/browse"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              title="Ctrl+K or / to search"
            >
              <IconSearch />
              Browse Mods
            </NavLink>
            <NavLink
              to="/instances"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <IconCube />
              Instances
            </NavLink>
          </div>

          <div className="nav-section">
            <div className="nav-label">Featured</div>
            {featured.map((f) => (
              <NavLink
                key={f.id}
                to={f.slug === 'beessmp' || f.id === 'beessmp' ? '/bees-smp' : `/bees-smp?pack=${encodeURIComponent(f.slug)}`}
                className={({ isActive }) => `nav-item nav-featured${isActive ? ' active' : ''}`}
              >
                <IconPack />
                {f.menuLabel}
              </NavLink>
            ))}
          </div>

          <div className="nav-section">
            <div className="nav-label">Partners</div>
            {sortedPartners.map((p) => {
              const icon = partnerNavIcon(p)
              const pinned = loadQolPrefs().pinnedPartnerIds.includes(p.id)
              const unread = partnerUnread[p.id]
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <NavLink
                    to={`/partners/${p.id}`}
                    className={({ isActive }) =>
                      `nav-item nav-partner${isActive ? ' active' : ''}`
                    }
                    style={{ flex: 1 }}
                  >
                    {icon ? (
                      <img
                        src={icon}
                        alt=""
                        className="nav-partner-icon"
                        width={18}
                        height={18}
                        draggable={false}
                      />
                    ) : (
                      <span
                        className="nav-partner-icon"
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          background: 'var(--bg-3)',
                          display: 'inline-grid',
                          placeItems: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {(p.menuLabel || p.title).slice(0, 1)}
                      </span>
                    )}
                    <span style={{ flex: 1 }}>{p.menuLabel || p.title}</span>
                    {unread && (
                      <span
                        className="badge badge-orange"
                        style={{ fontSize: 9, padding: '1px 5px' }}
                        title="Unread partner news"
                      >
                        New
                      </span>
                    )}
                  </NavLink>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: 4, minWidth: 28 }}
                    title={pinned ? 'Unpin' : 'Pin'}
                    onClick={(e) => {
                      e.preventDefault()
                      togglePinnedPartner(p.id)
                      setPrefsTick((n) => n + 1)
                    }}
                  >
                    {pinned ? '★' : '☆'}
                  </button>
                </div>
              )
            })}
          </div>

          <div className="nav-section">
            <div className="nav-label">Account</div>
            <NavLink
              to="/account"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <IconUser />
              Accounts
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <IconSettings />
              Settings
            </NavLink>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className={`running-panel${running.running ? ' is-live' : ''}`}>
            <div className="running-head">
              <span className={`running-dot${running.running ? ' on' : ''}`} />
              <strong>{running.running ? 'Running' : 'Not running'}</strong>
            </div>
            {running.running ? (
              <>
                <button
                  type="button"
                  className="running-name"
                  onClick={() =>
                    running.instanceId && navigate(`/instances/${running.instanceId}`)
                  }
                  title="Open instance"
                >
                  {running.instanceName || 'Minecraft'}
                </button>
                <div className="running-meta">
                  PID {running.pid ?? '—'}
                  {running.startedAt
                    ? ` · since ${new Date(running.startedAt).toLocaleTimeString()}`
                    : ''}
                </div>
                <button type="button" className="btn btn-danger btn-stop" onClick={() => stopGame()}>
                  <IconStop />
                  Stop
                </button>
              </>
            ) : (
              <p className="running-idle">Play an instance to see it here.</p>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className={`account-chip${loggedIn ? ' signed-in' : ' signed-out'}`}
              onClick={() => setAccountMenuOpen((o) => !o)}
              title={loggedIn ? 'Switch or manage account' : 'Sign in'}
            >
              <PlayerHeadWithFallback uuid={active?.uuid} username={active?.username} size={36} />
              <div className="account-meta">
                <strong>{active?.username || 'Not signed in'}</strong>
                <span>
                  {loggedIn
                    ? active?.type === 'offline' || active?.id.startsWith('offline-')
                      ? 'Offline account · click to switch'
                      : 'Microsoft · click to switch'
                    : 'Sign in required'}
                </span>
              </div>
            </button>
            {accountMenuOpen && (
              <div
                className="panel"
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  right: 0,
                  marginBottom: 8,
                  zIndex: 40,
                  maxHeight: 240,
                  overflow: 'auto',
                  padding: 8,
                }}
              >
                {accounts.length === 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => {
                      setAccountMenuOpen(false)
                      navigate('/account')
                    }}
                  >
                    Sign in
                  </button>
                ) : (
                  <>
                    {accounts.map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        className="btn btn-ghost"
                        style={{
                          width: '100%',
                          justifyContent: 'flex-start',
                          marginBottom: 4,
                          opacity: acc.id === activeAccountId ? 1 : 0.9,
                        }}
                        onClick={() => void switchAccount(acc.id)}
                      >
                        <PlayerHeadWithFallback uuid={acc.uuid} username={acc.username} size={22} />
                        <span style={{ marginLeft: 8 }}>
                          {acc.username}
                          {acc.id === activeAccountId ? ' · active' : ''}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: '100%', marginTop: 4 }}
                      onClick={() => {
                        setAccountMenuOpen(false)
                        navigate('/account')
                      }}
                    >
                      Manage accounts
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="main">
        {!loggedIn && (
          <div className="login-banner">
            <div>
              <strong>Sign in to play</strong>
              <span>Microsoft login or Admin-created offline account (Account → Offline login).</span>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/account')}>
              Accounts
            </button>
          </div>
        )}
        <div className="main-scroll">
          <div className="main-scroll-inner">
            <AdsBanner />
            <Outlet />
          </div>
        </div>
      </main>

      {toast && (
        <div className={`toast ${toast.type}`} onClick={clearToast} role="status">
          {toast.message}
        </div>
      )}

      <UpdateModal />
    </div>
  )
}
