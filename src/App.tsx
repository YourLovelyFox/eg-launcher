import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import {
  APP_FULL_NAME,
  APP_NAME,
  APP_VERSION,
  IS_PRE_RELEASE,
  RELEASE_CHANNEL_LABEL,
} from '../shared/branding'
import appIcon from './assets/app-icon.png'
import { Layout } from './components/Layout'
import { useAppStore } from './store'
import { applyTheme } from './theme'

/** Route-level code split — admin/browse/etc. never block first paint. */
const HomePage = lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage })),
)
const BrowsePage = lazy(() =>
  import('./pages/BrowsePage').then((m) => ({ default: m.BrowsePage })),
)
const InstancesPage = lazy(() =>
  import('./pages/InstancesPage').then((m) => ({ default: m.InstancesPage })),
)
const InstanceDetailPage = lazy(() =>
  import('./pages/InstanceDetailPage').then((m) => ({ default: m.InstanceDetailPage })),
)
const BeesSmpPage = lazy(() =>
  import('./pages/BeesSmpPage').then((m) => ({ default: m.BeesSmpPage })),
)
const PartnerPage = lazy(() =>
  import('./pages/PartnerPage').then((m) => ({ default: m.PartnerPage })),
)
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const AdminPage = lazy(() =>
  import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })),
)

function RouteFallback() {
  return (
    <div className="page route-fallback" role="status" aria-live="polite">
      <div className="muted">Loading…</div>
    </div>
  )
}

/**
 * Cold-start only: shown when there is no boot cache.
 * Cached launches skip this entirely and paint the shell immediately.
 */
function ColdBootScreen({ phase }: { phase: number }) {
  const labels = [
    'Starting…',
    'Loading accounts…',
    'Loading instances…',
    'Almost ready…',
    'Ready',
  ]
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <div className="boot-inner">
        <div className="boot-glow" aria-hidden />
        <img
          src={appIcon}
          alt=""
          className="boot-mark boot-mark-img boot-pulse"
          width={80}
          height={80}
          draggable={false}
        />
        <div className="boot-text">
          Loading {APP_NAME}
          {IS_PRE_RELEASE ? (
            <span className="badge badge-beta" style={{ marginLeft: 8 }}>
              {RELEASE_CHANNEL_LABEL}
            </span>
          ) : null}
        </div>
        <div className="boot-sub">
          {labels[Math.min(phase, labels.length - 1)]}
          {IS_PRE_RELEASE ? ` · v${APP_VERSION} pre-release` : ''}
        </div>
        <div className="boot-bar" aria-hidden>
          <div
            className="boot-bar-fill"
            style={{ width: `${Math.min(100, 22 + phase * 22)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const refreshCore = useAppStore((s) => s.refreshCore)
  const refreshRunning = useAppStore((s) => s.refreshRunning)
  const loading = useAppStore((s) => s.loading)
  const hydrating = useAppStore((s) => s.hydrating)
  const settings = useAppStore((s) => s.settings)
  const [bootPhase, setBootPhase] = useState(0)
  const [shellVisible, setShellVisible] = useState(!loading)

  useEffect(() => {
    document.title = APP_FULL_NAME
    const needsColdBoot = useAppStore.getState().loading

    // Critical path only — no artificial min delay
    const safety = window.setTimeout(() => {
      useAppStore.getState().setLoading(false)
      setShellVisible(true)
    }, 6000)

    const phases = needsColdBoot
      ? window.setInterval(() => {
          setBootPhase((p) => (p < 3 ? p + 1 : p))
        }, 140)
      : 0

    void refreshCore()
      .finally(() => {
        window.clearTimeout(safety)
        if (phases) window.clearInterval(phases)
        setBootPhase(4)
        setShellVisible(true)
        // Running status is non-critical — after first paint
        void refreshRunning()
      })

    return () => {
      window.clearTimeout(safety)
      if (phases) window.clearInterval(phases)
    }
    // Mount-once boot path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (settings?.theme) applyTheme(settings.theme)
  }, [settings?.theme])

  // Cold start only
  if (loading && !shellVisible) {
    return <ColdBootScreen phase={bootPhase} />
  }

  return (
    <div className={`app-fade-in is-visible${hydrating ? ' is-hydrating' : ''}`}>
      <HashRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="browse" element={<BrowsePage />} />
              <Route path="instances" element={<InstancesPage />} />
              <Route path="instances/:id" element={<InstanceDetailPage />} />
              <Route path="bees-smp" element={<BeesSmpPage />} />
              <Route path="partners/:id" element={<PartnerPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </div>
  )
}
