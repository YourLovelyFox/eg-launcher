import { useEffect, useState } from 'react'
import type {
  AppVersionInfo,
  LauncherSettings,
  SystemMemoryInfo,
  UpdateStatus,
} from '../../shared/types'
import { useAppStore } from '../store'

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export function SettingsPage() {
  const { settings, setSettings, showToast } = useAppStore()
  const [form, setForm] = useState<LauncherSettings | null>(settings)
  const [javaInfo, setJavaInfo] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [systemMemory, setSystemMemory] = useState<SystemMemoryInfo | null>(null)

  // Hidden offline mode unlock (7 clicks on version label)
  const [versionClicks, setVersionClicks] = useState(0)
  const [showOfflineUnlock, setShowOfflineUnlock] = useState(false)
  const [offlineEnabled, setOfflineEnabled] = useState(false)
  const [offlinePass, setOfflinePass] = useState('')
  const [offlineBusy, setOfflineBusy] = useState(false)

  useEffect(() => {
    setForm(settings)
    setOfflineEnabled(Boolean(settings?.offlineModeEnabled))
  }, [settings])

  useEffect(() => {
    window.hive.offline.status().then((s) => setOfflineEnabled(s.offlineModeEnabled)).catch(() => undefined)
  }, [])

  useEffect(() => {
    window.hive.settings.systemMemory().then((mem) => {
      setSystemMemory(mem)
      setForm((f) => {
        if (!f) return f
        const ramMaxMb = Math.min(Math.max(2048, f.ramMaxMb), mem.maxAllowedMb)
        const ramMinMb = Math.min(2048, ramMaxMb)
        if (ramMaxMb === f.ramMaxMb && ramMinMb === f.ramMinMb) return f
        return { ...f, ramMinMb, ramMaxMb }
      })
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!form?.javaPath) {
      setJavaInfo('')
      return
    }
    window.hive.java.version(form.javaPath).then((v) => {
      setJavaInfo(v ? `Detected: Java ${v}` : 'Could not read Java version')
    })
  }, [form?.javaPath])

  useEffect(() => {
    window.hive.updater.getVersion().then(setVersionInfo).catch(() => undefined)
    window.hive.updater.getStatus().then(setUpdateStatus).catch(() => undefined)
    return window.hive.updater.onStatus(setUpdateStatus)
  }, [])

  async function checkUpdates() {
    setCheckingUpdate(true)
    try {
      const status = await window.hive.updater.check()
      setUpdateStatus(status)
      if (status.state === 'available') {
        showToast('success', `Update ${status.version} available`)
      } else if (status.state === 'unavailable') {
        showToast('success', 'You are on the latest version')
      } else if (status.state === 'error') {
        showToast('error', status.message)
      } else if (status.state === 'ready') {
        showToast('success', `Update ${status.version} ready to install`)
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setCheckingUpdate(false)
    }
  }

  if (!form) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    )
  }

  async function detectJava() {
    const found = await window.hive.java.find()
    if (!found) {
      showToast('error', 'No Java installation found. Install Java 17+ or 21.')
      return
    }
    setForm((f) => (f ? { ...f, javaPath: found.path } : f))
    setJavaInfo(`Detected: Java ${found.version}`)
    showToast('success', `Found Java ${found.version}`)
  }

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      const saved = await window.hive.settings.save({
        ...form,
        offlineModeEnabled: offlineEnabled,
      })
      setSettings(saved)
      showToast('success', 'Settings saved')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function onVersionClick() {
    const next = versionClicks + 1
    setVersionClicks(next)
    if (next >= 7) {
      setShowOfflineUnlock(true)
      setVersionClicks(0)
    }
  }

  async function submitOfflineUnlock() {
    setOfflineBusy(true)
    try {
      const res = await window.hive.offline.unlock(offlinePass)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      setOfflineEnabled(true)
      setOfflinePass('')
      const s = await window.hive.settings.get()
      setSettings(s)
      setForm(s)
      showToast('success', 'Offline mode unlocked — open Account to log in with an Admin-created account')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setOfflineBusy(false)
    }
  }

  async function lockOffline() {
    if (!window.confirm('Lock offline mode? You will need the password again to unlock.')) return
    setOfflineBusy(true)
    try {
      await window.hive.offline.lock()
      setOfflineEnabled(false)
      setShowOfflineUnlock(false)
      const s = await window.hive.settings.get()
      setSettings(s)
      setForm(s)
      showToast('success', 'Offline mode locked')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setOfflineBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Java, memory, and launcher preferences.</p>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <div className="panel">
        <h2>Java</h2>
        <p className="hint">
          Minecraft 1.20.5+ needs Java 21. Versions 25.x / 26.x need Java 25. If a version needs a
          newer Java, EG Launcher can download Mojang&apos;s official runtime automatically on Play.
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>Java executable path</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="C:\Program Files\Eclipse Adoptium\jdk-21\bin\javaw.exe"
                value={form.javaPath}
                onChange={(e) => setForm({ ...form, javaPath: e.target.value })}
              />
              <button className="btn btn-secondary" type="button" onClick={detectJava}>
                Auto-detect
              </button>
            </div>
            {javaInfo && <span className="muted">{javaInfo}</span>}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Memory (RAM)</h2>
        <p className="hint">
          Maximum heap allocated when Minecraft launches. Minimum is fixed at 2 GB (not adjustable).
          The launcher detects your PC RAM and caps allocation so the OS keeps headroom
          {systemMemory
            ? ` — ${systemMemory.totalGbRounded} GB detected, max ${systemMemory.allowedPercent}% (${formatMb(systemMemory.maxAllowedMb)}).`
            : '.'}
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>Maximum RAM</label>
            <div className="range-row">
              <input
                type="range"
                min={2048}
                max={systemMemory ? Math.max(2048, systemMemory.maxAllowedMb) : 32768}
                step={256}
                value={Math.min(
                  form.ramMaxMb,
                  systemMemory?.maxAllowedMb ?? form.ramMaxMb,
                )}
                onChange={(e) => {
                  const cap = systemMemory?.maxAllowedMb ?? 32768
                  const floor = Math.min(2048, cap)
                  const next = Math.min(Math.max(Number(e.target.value), floor), cap)
                  setForm({
                    ...form,
                    ramMaxMb: next,
                    ramMinMb: Math.min(2048, next),
                  })
                }}
              />
              <span className="range-value">{formatMb(form.ramMaxMb)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Mods</h2>
        <p className="hint">
          When you install a mod, EG Launcher reads its Modrinth dependencies and installs required
          ones (including nested dependencies like Fabric API).
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.resolveDependencies}
            onChange={(e) => setForm({ ...form, resolveDependencies: e.target.checked })}
          />
          Automatically install required mod dependencies
        </label>
      </div>

      <div className="panel">
        <h2>Updates</h2>
        <p className="hint">
          EG Launcher checks GitHub Releases for new versions. Windows uses the NSIS installer;
          Linux uses the AppImage. Nothing downloads until you confirm.
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>Installed version</label>
            <div
              className="muted"
              onClick={onVersionClick}
              style={{ cursor: 'default', userSelect: 'none' }}
              title=""
            >
              v{versionInfo?.version || '…'}
              {versionInfo && !versionInfo.isPackaged ? ' (dev build — auto-update disabled)' : ''}
              {versionInfo ? ` · ${versionInfo.platform}/${versionInfo.arch}` : ''}
            </div>
          </div>
          <div className="form-row">
            <label>Status</label>
            <div className="muted">
              {updateStatus.state === 'idle' && 'Not checked yet'}
              {updateStatus.state === 'checking' && 'Checking…'}
              {updateStatus.state === 'unavailable' && 'Up to date'}
              {updateStatus.state === 'available' && `Update ${updateStatus.version} available`}
              {updateStatus.state === 'downloading' &&
                `Downloading ${updateStatus.version}… ${Math.round(updateStatus.percent)}%`}
              {updateStatus.state === 'ready' &&
                `Update ${updateStatus.version} ready — restart to install`}
              {updateStatus.state === 'error' && `Error: ${updateStatus.message}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={checkUpdates}
            disabled={checkingUpdate}
          >
            {checkingUpdate ? 'Checking…' : 'Check for updates'}
          </button>
          {updateStatus.state === 'available' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.hive.updater.download()}
            >
              Download & install
            </button>
          )}
          {updateStatus.state === 'ready' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.hive.updater.install()}
            >
              Restart & install
            </button>
          )}
        </div>
      </div>

      {(showOfflineUnlock || offlineEnabled) && (
        <div
          className="panel"
          style={{
            marginTop: 16,
            borderColor: offlineEnabled
              ? 'rgba(245, 158, 11, 0.45)'
              : 'rgba(148, 163, 184, 0.35)',
          }}
        >
          <h2>Offline mode {offlineEnabled ? '(unlocked)' : ''}</h2>
          <p className="hint">
            Offline (non-premium) accounts let you use the launcher without Microsoft login.
            You cannot join official Minecraft servers, Realms, or paid-auth servers. Bee&apos;s SMP
            requires a paid Microsoft account and cannot be installed while offline.
          </p>
          {offlineEnabled ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-orange">Offline mode enabled</span>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={offlineBusy}
                onClick={() => lockOffline()}
              >
                Lock offline mode
              </button>
            </div>
          ) : (
            <div className="form-grid">
              <div className="form-row">
                <label>Unlock password</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    type="password"
                    style={{ flex: 1, minWidth: 180 }}
                    value={offlinePass}
                    onChange={(e) => setOfflinePass(e.target.value)}
                    placeholder="Enter unlock password"
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitOfflineUnlock()
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={offlineBusy || !offlinePass}
                    onClick={() => void submitOfflineUnlock()}
                  >
                    {offlineBusy ? '…' : 'Unlock'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
