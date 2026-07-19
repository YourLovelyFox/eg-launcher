import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { APP_NAME, APP_TAGLINE, FEATURED_PACK } from '../../shared/branding'
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

export function Layout() {
  const navigate = useNavigate()
  const { accounts, activeAccountId, toast, clearToast, running, refreshRunning, stopGame } =
    useAppStore()
  const active = accounts.find((a) => a.id === activeAccountId)
  const loggedIn = Boolean(active)

  useEffect(() => {
    refreshRunning()
    const id = window.setInterval(() => {
      refreshRunning()
    }, 2500)
    return () => window.clearInterval(id)
  }, [refreshRunning])

  return (
    <div className="app-shell">
      {/* Static ambient background (no animation) */}
      <div className="app-bg" aria-hidden>
        <div className="app-bg-base" />
        <div className="app-bg-mesh" />
        <div className="app-bg-grid" />
        <div className="app-bg-vignette" />
      </div>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EG</div>
          <div className="brand-text">
            <strong>{APP_NAME}</strong>
            <span>{APP_TAGLINE}</span>
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
            <NavLink
              to="/bees-smp"
              className={({ isActive }) => `nav-item nav-featured${isActive ? ' active' : ''}`}
            >
              <IconPack />
              {FEATURED_PACK.menuLabel}
            </NavLink>
          </div>

          <div className="nav-section">
            <div className="nav-label">Account</div>
            <NavLink
              to="/account"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <IconUser />
              Microsoft Login
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

          <button
            type="button"
            className={`account-chip${loggedIn ? ' signed-in' : ' signed-out'}`}
            onClick={() => navigate('/account')}
            title={loggedIn ? 'Manage Microsoft account' : 'Sign in required to play'}
          >
            <PlayerHeadWithFallback uuid={active?.uuid} username={active?.username} size={36} />
            <div className="account-meta">
              <strong>{active?.username || 'Not signed in'}</strong>
              <span>{loggedIn ? 'Microsoft account' : 'Sign in required'}</span>
            </div>
          </button>
        </div>
      </aside>

      <main className="main">
        {!loggedIn && (
          <div className="login-banner">
            <div>
              <strong>Microsoft login required</strong>
              <span>You must sign in to play. Offline mode is disabled.</span>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/account')}>
              Sign in
            </button>
          </div>
        )}
        <div className="main-scroll">
          <Outlet />
        </div>
      </main>

      {toast && (
        <div className={`toast ${toast.type}`} onClick={clearToast} role="status">
          {toast.message}
        </div>
      )}
    </div>
  )
}
