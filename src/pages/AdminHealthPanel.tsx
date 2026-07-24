import { useCallback, useState } from 'react'
import { useAppStore } from '../store'

type HealthSnap = {
  checkedAt: string
  cmsBase: string
  app: { version: string; isPackaged: boolean; platform: string; arch: string }
  java: { path: string | null; version: string | null }
  checks: Array<{ ok: boolean; name: string; detail: string; latencyMs?: number }>
  partners: Array<{
    id: string
    title: string
    serverAddress: string
    online: boolean
    players?: string
    latencyMs?: number
    error?: string
  }>
  news: {
    launcherItems: number
    partnerItems: number
    launcherUpdated: string | null
    partnerUpdated: string | null
  }
}

export function AdminHealthPanel({ session }: { session: string }) {
  const { showToast } = useAppStore()
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState<HealthSnap | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    try {
      const res = await window.hive.admin.health(session)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      setHealth(res.health as HealthSnap)
      showToast('success', 'Health check complete')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [session, showToast])

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>System health</h2>
            <p className="hint" style={{ marginBottom: 0 }}>
              CMS endpoints, news counts, partner server pings, and local runtime.
            </p>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
            {busy ? 'Checking…' : 'Run health check'}
          </button>
        </div>
        {health && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Last run {new Date(health.checkedAt).toLocaleString()} · CMS {health.cmsBase}
          </p>
        )}
      </div>

      {!health && !busy && (
        <div className="empty" style={{ padding: 28 }}>
          <h3>No data yet</h3>
          <p>Run a health check to probe CMS, news, partners, and servers.</p>
        </div>
      )}

      {health && (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h2>Launcher / Java</h2>
            <div className="list">
              <div className="list-item">
                <div className="grow">
                  <div className="sub">App</div>
                  <div className="title">
                    v{health.app.version} · {health.app.platform}/{health.app.arch}
                    {health.app.isPackaged ? '' : ' · dev'}
                  </div>
                </div>
              </div>
              <div className="list-item">
                <div className="grow">
                  <div className="sub">Java</div>
                  <div className="title">
                    {health.java.version
                      ? `Java ${health.java.version}`
                      : 'Not detected'}
                  </div>
                  {health.java.path && <div className="sub mono">{health.java.path}</div>}
                </div>
              </div>
              <div className="list-item">
                <div className="grow">
                  <div className="sub">News</div>
                  <div className="title">
                    Home {health.news.launcherItems} · Partner {health.news.partnerItems}
                  </div>
                  <div className="sub">
                    Updated launcher {health.news.launcherUpdated || '—'} · partners{' '}
                    {health.news.partnerUpdated || '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <h2>CMS checks</h2>
            <div className="list">
              {health.checks.map((c) => (
                <div key={c.name} className="list-item">
                  <div className="grow">
                    <div className="title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {c.name}
                      <span className={`badge ${c.ok ? 'badge-green' : 'badge-orange'}`}>
                        {c.ok ? 'OK' : 'Fail'}
                      </span>
                    </div>
                    <div className="sub">{c.detail}</div>
                  </div>
                  {c.latencyMs != null && <span className="muted">{c.latencyMs} ms</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Partner servers</h2>
            {health.partners.length === 0 ? (
              <p className="hint">No partners returned.</p>
            ) : (
              <div className="list">
                {health.partners.map((p) => (
                  <div key={p.id} className="list-item">
                    <div className="grow">
                      <div className="title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {p.title}
                        <span className={`badge ${p.online ? 'badge-green' : 'badge-orange'}`}>
                          {p.online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <div className="sub mono">{p.serverAddress}</div>
                      {p.error && <div className="sub">{p.error}</div>}
                    </div>
                    <span className="muted">
                      {p.players || ''}
                      {p.latencyMs != null ? ` · ${p.latencyMs} ms` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
