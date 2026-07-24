import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store'

const PAYPAL = 'beethegirl12fox@gmail.com'

export function AdminAdsPanel({ session }: { session: string }) {
  const { showToast } = useAppStore()
  const [claims, setClaims] = useState<
    Array<{ id: string; deviceId: string; email?: string; message?: string; createdAt: string }>
  >([])
  const [code, setCode] = useState('')
  const [days, setDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const [netEnabled, setNetEnabled] = useState(false)
  const [adsenseClient, setAdsenseClient] = useState('')
  const [adsenseSlot, setAdsenseSlot] = useState('')

  const load = useCallback(async () => {
    const [cRes, nRes] = await Promise.all([
      window.hive.admin.adsListClaims(session),
      window.hive.admin.adsGetNetwork(session),
    ])
    if (!cRes.ok) showToast('error', cRes.error)
    else setClaims((cRes.claims || []) as typeof claims)
    if (nRes.ok && nRes.network) {
      const n = nRes.network as {
        enabled?: boolean
        provider?: string
        adsenseClient?: string
        adsenseSlot?: string
      }
      setNetEnabled(Boolean(n.enabled) && String(n.provider || '') === 'adsense')
      setAdsenseClient(String(n.adsenseClient || ''))
      setAdsenseSlot(String(n.adsenseSlot || ''))
    }
  }, [session, showToast])

  useEffect(() => {
    void load()
  }, [load])

  async function createCode() {
    setBusy(true)
    try {
      const res = await window.hive.admin.adsCreateCode(session, {
        days: Number(days) || 30,
        code: code.trim() || undefined,
      })
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', `Code ${res.code} (${res.days} days)`)
      setCode(res.code || '')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveNetwork() {
    setBusy(true)
    try {
      const res = await window.hive.admin.adsSaveNetwork(session, {
        enabled: netEnabled,
        provider: netEnabled ? 'adsense' : 'none',
        adsenseClient: adsenseClient.trim(),
        adsenseSlot: adsenseSlot.trim(),
        customHtml: '',
      })
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', 'AdSense settings saved')
      await load()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Google AdSense</h2>
        <p className="hint">
          Only AdSense is shown in the launcher (no house/EG ads). Users can still pay to remove
          ads via PayPal.
        </p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={netEnabled}
            onChange={(e) => setNetEnabled(e.target.checked)}
          />
          Enable AdSense in launcher
        </label>
        <div className="form-grid" style={{ gap: 10, marginBottom: 12 }}>
          <div className="form-row">
            <label>AdSense client (ca-pub-…)</label>
            <input
              className="input"
              value={adsenseClient}
              onChange={(e) => setAdsenseClient(e.target.value)}
              placeholder="ca-pub-xxxxxxxxxxxxxxxx"
            />
          </div>
          <div className="form-row">
            <label>Ad unit slot ID</label>
            <input
              className="input"
              value={adsenseSlot}
              onChange={(e) => setAdsenseSlot(e.target.value)}
              placeholder="1234567890"
            />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void saveNetwork()}
        >
          Save AdSense settings
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>PayPal remove-ads</h2>
        <p className="hint">
          Users pay <strong>€5 / month</strong> via PayPal to <span className="mono">{PAYPAL}</span>.
          IPN auto-grants when configured; otherwise use redeem codes / claims below.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Optional custom code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ maxWidth: 180 }}
          />
          <input
            className="input"
            placeholder="Days"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            style={{ maxWidth: 80 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void createCode()}
          >
            Generate redeem code
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="page-header" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Pending payment claims</h2>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {claims.length === 0 ? (
          <p className="hint">No pending claims.</p>
        ) : (
          <div className="list">
            {claims.map((c) => (
              <div key={c.id} className="list-item">
                <div className="grow">
                  <div className="title mono">{c.deviceId}</div>
                  <div className="sub">
                    {c.email || 'no email'} · {c.message || '—'} ·{' '}
                    {new Date(c.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    const res = await window.hive.admin.adsGrant(session, {
                      deviceId: c.deviceId,
                      days: 30,
                      claimId: c.id,
                      note: 'paypal-f&f',
                    })
                    if (!res.ok) showToast('error', res.error)
                    else {
                      showToast('success', `Granted until ${res.paidUntil}`)
                      await load()
                    }
                  }}
                >
                  Grant 30 days
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
