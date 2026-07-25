import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { APP_FULL_NAME, APP_NAME, APP_VERSION, IS_PRE_RELEASE, RELEASE_CHANNEL_LABEL } from '../shared/branding'
import appIcon from './assets/app-icon.png'
import { Layout } from './components/Layout'
import { AccountPage } from './pages/AccountPage'
import { BeesSmpPage } from './pages/BeesSmpPage'
import { BrowsePage } from './pages/BrowsePage'
import { HomePage } from './pages/HomePage'
import { InstanceDetailPage } from './pages/InstanceDetailPage'
import { InstancesPage } from './pages/InstancesPage'
import { PartnerPage } from './pages/PartnerPage'
import { SettingsPage } from './pages/SettingsPage'
import { AdminPage } from './pages/AdminPage'
import { useAppStore } from './store'
import { applyTheme } from './theme'

const BOOT_MIN_MS = 480
const BOOT_SAFETY_MS = 8000

export default function App() {
  const refreshAll = useAppStore((s) => s.refreshAll)
  const loading = useAppStore((s) => s.loading)
  const settings = useAppStore((s) => s.settings)
  const [bootPhase, setBootPhase] = useState(0)
  const [readyFade, setReadyFade] = useState(false)

  useEffect(() => {
    document.title = APP_FULL_NAME
    const started = Date.now()
    // Gentle progress steps while IPC loads
    const phases = window.setInterval(() => {
      setBootPhase((p) => (p < 3 ? p + 1 : p))
    }, 180)

    const safety = window.setTimeout(() => {
      useAppStore.getState().setLoading(false)
    }, BOOT_SAFETY_MS)

    void refreshAll().finally(() => {
      window.clearTimeout(safety)
      window.clearInterval(phases)
      setBootPhase(4)
      const elapsed = Date.now() - started
      const wait = Math.max(0, BOOT_MIN_MS - elapsed)
      window.setTimeout(() => {
        useAppStore.getState().setLoading(false)
        // One frame later allow fade-in of the shell
        requestAnimationFrame(() => setReadyFade(true))
      }, wait)
    })

    return () => {
      window.clearTimeout(safety)
      window.clearInterval(phases)
    }
  }, [refreshAll])

  useEffect(() => {
    if (settings?.theme) applyTheme(settings.theme)
  }, [settings?.theme])

  if (loading) {
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
            {labels[Math.min(bootPhase, labels.length - 1)]}
            {IS_PRE_RELEASE ? ` · v${APP_VERSION} pre-release` : ''}
          </div>
          <div className="boot-bar" aria-hidden>
            <div
              className="boot-bar-fill"
              style={{ width: `${Math.min(100, 18 + bootPhase * 20)}%` }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`app-fade-in${readyFade ? ' is-visible' : ''}`}>
      <HashRouter>
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
      </HashRouter>
    </div>
  )
}
