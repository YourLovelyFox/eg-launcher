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

  const load = useCallback(async () => {
    const res = await window.hive.admin.adsListClaims(session)
    if (!res.ok) {
      showToast('error', res.error)
      return
    }
    setClaims((res.claims || []) as typeof claims)
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

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>PayPal remove-ads</h2>
        <p className="hint">
          Users pay <strong>€5 / month</strong> via PayPal <strong>Friends & Family</strong> to{' '}
          <span className="mono">{PAYPAL}</span>, then redeem a code you generate — or submit a claim
          for you to grant manually.
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
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void createCode()}>
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
