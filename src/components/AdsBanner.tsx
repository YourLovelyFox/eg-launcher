import { useEffect, useState } from 'react'
import { useAppStore } from '../store'

type NetworkCfg = {
  adFree: boolean
  enabled: boolean
  provider: string
  unitUrl: string | null
}

/**
 * Google AdSense only (via hosted ad-unit.php iframe).
 * No house ads / EG creatives. Remove-ads PayPal still available.
 */
export function AdsBanner() {
  const { showToast } = useAppStore()
  const [adFree, setAdFree] = useState(false)
  const [network, setNetwork] = useState<NetworkCfg | null>(null)
  const [priceEur, setPriceEur] = useState(5)
  const [deviceId, setDeviceId] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function loadAll() {
    try {
      const [net, status] = await Promise.all([
        window.hive.ads.network().catch(() => null),
        window.hive.ads.status().catch(() => null),
      ])

      if (status?.adFree || net?.adFree) {
        setAdFree(true)
        setNetwork(null)
        return
      }
      setAdFree(false)

      if (net) {
        setNetwork({
          adFree: false,
          enabled: Boolean(net.enabled),
          provider: String(net.provider || 'none'),
          unitUrl: net.unitUrl || null,
        })
      }

      if (typeof status?.priceEur === 'number') setPriceEur(status.priceEur)
      if (status?.deviceId) setDeviceId(status.deviceId)
    } catch (err) {
      console.warn('[ads] load failed', err)
      setAdFree(false)
    }
  }

  useEffect(() => {
    void loadAll()
    const t = window.setInterval(() => void loadAll(), 60_000)
    return () => window.clearInterval(t)
  }, [])

  if (adFree) return null

  const showAdSense =
    network?.enabled &&
    network.provider === 'adsense' &&
    Boolean(network.unitUrl)

  async function payWithPaypal() {
    setBusy(true)
    try {
      const res = await window.hive.ads.paypalCheckout()
      if (!res.ok || !res.checkoutUrl) {
        showToast('error', res.error || 'Could not open PayPal')
        return
      }
      if (window.hive.shell.openHttps) await window.hive.shell.openHttps(res.checkoutUrl)
      else await window.hive.shell.openExternal(res.checkoutUrl)
      showToast('success', 'PayPal opened — complete payment, then click “I paid — refresh”')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function afterPayRefresh() {
    setBusy(true)
    try {
      await loadAll()
      const s = await window.hive.ads.status()
      if (s.adFree) {
        setAdFree(true)
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
      <div className="ads-stack" role="complementary" aria-label="Sponsored">
        {showAdSense && network?.unitUrl ? (
          <div className="ads-network-frame-wrap">
            <div className="ads-network-label">
              <span className="ads-banner-badge">AdSense</span>
              <span className="ads-unit-source">Google AdSense</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
                Remove ads · €{priceEur}/mo
              </button>
            </div>
            <iframe
              className="ads-network-frame"
              title="Google AdSense"
              src={network.unitUrl}
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-forms allow-top-navigation-by-user-activation"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allow="attribution-reporting"
            />
          </div>
        ) : (
          <div className="ads-banner">
            <div className="ads-banner-body">
              <span className="ads-banner-badge">AdSense</span>
              <div className="grow">
                <strong className="ads-banner-title">Google AdSense</strong>
                <div className="ads-banner-sub">
                  {network?.enabled
                    ? 'Ad unit loading… (site must be approved in AdSense)'
                    : 'AdSense is not enabled on the server yet.'}
                </div>
              </div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
              Remove ads · €{priceEur}/mo
            </button>
          </div>
        )}
      </div>

      {open ? (
        <div
          className="update-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div className="update-modal panel" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Remove ads · €{priceEur} / month</h2>
            <p className="hint">
              Pay with PayPal. Your device is linked automatically — AdSense is hidden when payment
              confirms.
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
                {busy ? 'Opening…' : `Pay €${priceEur} with PayPal`}
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
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
