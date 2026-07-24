import { useEffect, useState } from 'react'
import { useAppStore } from '../store'

/**
 * Low-key sponsor strip — PayPal checkout auto-grants ad-free via CMS IPN.
 */
export function AdsBanner() {
  const { showToast } = useAppStore()
  const [adFree, setAdFree] = useState(true)
  const [paidUntil, setPaidUntil] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [priceEur, setPriceEur] = useState(5)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const s = await window.hive.ads.status()
    setAdFree(Boolean(s.adFree))
    setPaidUntil(s.paidUntil || null)
    setDeviceId(s.deviceId || '')
    if (typeof s.priceEur === 'number') setPriceEur(s.priceEur)
  }

  useEffect(() => {
    void refresh()
  }, [])

  if (adFree) return null

  async function payWithPaypal() {
    setBusy(true)
    try {
      const res = await window.hive.ads.paypalCheckout()
      if (!res.ok || !res.checkoutUrl) {
        showToast('error', res.error || 'Could not open PayPal')
        return
      }
      await window.hive.shell.openExternal(res.checkoutUrl)
      showToast('success', 'PayPal opened — after payment, click “I paid — refresh”')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function afterPayRefresh() {
    setBusy(true)
    try {
      await refresh()
      const s = await window.hive.ads.status()
      if (s.adFree) {
        setAdFree(true)
        setPaidUntil(s.paidUntil || null)
        setOpen(false)
        showToast('success', 'Ads removed — thank you!')
      } else {
        showToast(
          'error',
          'Payment not applied yet. Wait a few seconds after PayPal confirms, then try again.',
        )
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className="panel"
        style={{
          marginBottom: 16,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          borderColor: 'rgba(106, 168, 255, 0.35)',
          background: 'var(--green-soft)',
        }}
      >
        <div className="grow">
          <strong style={{ fontSize: 13 }}>Sponsored · EG Launcher</strong>
          <div className="sub" style={{ marginTop: 2 }}>
            Support development — remove ads for €{priceEur}/month via PayPal (automatic unlock).
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          Remove ads · €{priceEur}/mo
        </button>
      </div>

      {open && (
        <div className="update-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="update-modal panel" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Remove ads · €{priceEur} / month</h2>
            <p className="hint">
              Pay with PayPal. Your device is linked automatically — ads unlock when PayPal confirms
              the payment (usually within a few seconds).
            </p>
            <p className="muted mono" style={{ fontSize: 12 }}>
              Device: {deviceId || '…'}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void payWithPaypal()}
              >
                {busy ? '…' : `Pay €${priceEur} with PayPal`}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void afterPayRefresh()}
              >
                I paid — refresh
              </button>
            </div>
            {paidUntil && (
              <p className="muted" style={{ marginTop: 12 }}>
                Current entitlement until {new Date(paidUntil).toLocaleString()}
              </p>
            )}
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
