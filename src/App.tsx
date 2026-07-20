import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { APP_FULL_NAME, APP_NAME } from '../shared/branding'
import { Layout } from './components/Layout'
import { AccountPage } from './pages/AccountPage'
import { BeesSmpPage } from './pages/BeesSmpPage'
import { HorizonsSmpPage } from './pages/HorizonsSmpPage'
import { BrowsePage } from './pages/BrowsePage'
import { HomePage } from './pages/HomePage'
import { InstanceDetailPage } from './pages/InstanceDetailPage'
import { InstancesPage } from './pages/InstancesPage'
import { SettingsPage } from './pages/SettingsPage'
import { useAppStore } from './store'

export default function App() {
  const refreshAll = useAppStore((s) => s.refreshAll)
  const loading = useAppStore((s) => s.loading)

  useEffect(() => {
    document.title = APP_FULL_NAME
    // Don't leave the boot screen forever if IPC is slow
    const safety = window.setTimeout(() => {
      useAppStore.getState().setLoading(false)
    }, 8000)
    refreshAll().finally(() => window.clearTimeout(safety))
    return () => window.clearTimeout(safety)
  }, [refreshAll])

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">EG</div>
        <div className="boot-text">Loading {APP_NAME}…</div>
      </div>
    )
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="browse" element={<BrowsePage />} />
          <Route path="instances" element={<InstancesPage />} />
          <Route path="instances/:id" element={<InstanceDetailPage />} />
          <Route path="bees-smp" element={<BeesSmpPage />} />
          <Route path="partners/horizons-smp" element={<HorizonsSmpPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
