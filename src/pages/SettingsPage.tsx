import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  AppVersionInfo,
  LauncherSettings,
  LauncherTheme,
  SystemMemoryInfo,
} from '../../shared/types'
import { useAppStore } from '../store'
import { applyTheme } from '../theme'
import { IS_PRE_RELEASE, RELEASE_CHANNEL_LABEL } from '../../shared/branding'

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export function SettingsPage() {
  const navigate = useNavigate()
  const { settings, setSettings, showToast } = useAppStore()
  const [form, setForm] = useState<LauncherSettings | null>(settings)
  const [javaInfo, setJavaInfo] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [systemMemory, setSystemMemory] = useState<SystemMemoryInfo | null>(null)

  useEffect(() => {
    setForm(settings)
  }, [settings])

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
  }, [])

  async function openUpdateChannel() {
    setCheckingUpdate(true)
    try {
      // Opens Microsoft Store (Windows) or GitHub Releases (other) — no in-app download
      await window.hive.updater.check()
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
      showToast(
        'error',
        'No system Java found yet. Install a pack or press Play — EG downloads Mojang Java automatically.',
      )
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
      const saved = await window.hive.settings.save(form)
      setSettings(saved)
      showToast('success', 'Settings saved')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setSaving(false)
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
          Minecraft 1.20.5+ needs Java 21. Versions 25.x / 26.x need Java 25. If Java is missing or
          too old, EG Launcher downloads Mojang&apos;s official runtime automatically on{' '}
          <strong>Install</strong> and <strong>Play</strong> (no manual setup required).
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
        <h2>Appearance</h2>
        <p className="hint">Theme applies instantly and is saved with your settings.</p>
        <div className="form-grid">
          <div className="form-row">
            <label>Theme</label>
            <select
              className="select"
              value={form.theme || 'dark'}
              onChange={(e) => {
                const theme = e.target.value as LauncherTheme
                setForm({ ...form, theme })
                applyTheme(theme)
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="high-contrast">High contrast</option>
            </select>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Content</h2>
        <p className="hint">
          When you add content to an instance, EG Launcher can resolve catalog dependencies and add
          required ones (including nested dependencies such as Fabric API).
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.resolveDependencies}
            onChange={(e) => setForm({ ...form, resolveDependencies: e.target.checked })}
          />
          Automatically add required content dependencies
        </label>
      </div>

      <div className="panel">
        <h2>Staff</h2>
        <p className="hint">
          Staff and Admin tools (news, partners, offline accounts, featured packs, ads). Sign in with
          a CMS staff account. Idle timeout is <strong>5 minutes</strong> — any click or typing
          resets the timer.
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin')}>
          Open Staff Menu
        </button>
      </div>

      <div className="panel">
        <h2>Updates</h2>
        <p className="hint">
          The in-app auto-updater is <strong>disabled</strong>. On Windows, install and update EG
          Launcher through the <strong>Microsoft Store</strong> only. Linux users can download a new
          AppImage from GitHub Releases when available.
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>Installed version</label>
            <div className="muted">
              v{versionInfo?.version || '…'}
              {IS_PRE_RELEASE ? (
                <>
                  <span className="badge badge-beta" style={{ marginLeft: 8 }}>
                    {RELEASE_CHANNEL_LABEL}
                  </span>
                  <span className="hint" style={{ display: 'block', marginTop: 4, marginBottom: 0 }}>
                    Pre-release (Beta) — features may change; report issues if something breaks.
                  </span>
                </>
              ) : null}
              {versionInfo && !versionInfo.isPackaged ? ' (dev build)' : ''}
              {versionInfo?.microsoftStore ? ' · Microsoft Store' : ''}
              {versionInfo ? ` · ${versionInfo.platform}/${versionInfo.arch}` : ''}
            </div>
          </div>
          <div className="form-row">
            <label>Update channel</label>
            <div className="muted">
              {versionInfo?.microsoftStore || versionInfo?.platform === 'win32'
                ? 'Microsoft Store'
                : 'GitHub Releases (manual AppImage)'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void openUpdateChannel()}
            disabled={checkingUpdate}
          >
            {checkingUpdate
              ? 'Opening…'
              : versionInfo?.microsoftStore || versionInfo?.platform === 'win32'
                ? 'Open Microsoft Store'
                : 'Open GitHub Releases'}
          </button>
        </div>
      </div>

    </div>
  )
}
