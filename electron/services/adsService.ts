import { randomUUID } from 'crypto'
import path from 'path'
import { cmsRequest } from './cms/httpClient'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'

const PAYPAL_EMAIL = 'beethegirl12fox@gmail.com'
const PRICE_EUR = 5
const DAYS = 30
const CMS_PUBLIC = 'https://client116.ddns.net'

export type AdCreative = {
  id: string
  title: string
  body?: string | null
  imageUrl?: string | null
  clickUrl: string
  ctaLabel?: string | null
  sponsor?: string | null
  weight?: number
}

type LocalAds = {
  deviceId: string
  paidUntil: string | null
}

function storePath(): string {
  return path.join(getDataRoot(), 'ads-entitlement.json')
}

export function getDeviceId(): string {
  const cur = readJsonFile<LocalAds>(storePath(), { deviceId: '', paidUntil: null })
  if (cur.deviceId) return cur.deviceId
  const deviceId = randomUUID()
  writeJsonFile(storePath(), { deviceId, paidUntil: cur.paidUntil })
  return deviceId
}

export function getLocalAdFree(): { adFree: boolean; paidUntil: string | null; deviceId: string } {
  const cur = readJsonFile<LocalAds>(storePath(), { deviceId: getDeviceId(), paidUntil: null })
  const until = cur.paidUntil
  const adFree = Boolean(until && Date.parse(until) > Date.now())
  return { adFree, paidUntil: adFree ? until : null, deviceId: cur.deviceId || getDeviceId() }
}

export function setLocalPaidUntil(paidUntil: string | null): void {
  const deviceId = getDeviceId()
  writeJsonFile(storePath(), { deviceId, paidUntil })
}

/** Build PayPal Buy Now URL locally (works even if CMS checkout is down). */
export function buildLocalPaypalCheckoutUrl(deviceId?: string): string {
  const device = deviceId || getDeviceId()
  const params = new URLSearchParams({
    cmd: '_xclick',
    business: PAYPAL_EMAIL,
    item_name: 'EG Launcher Remove Ads (1 month)',
    amount: PRICE_EUR.toFixed(2),
    currency_code: 'EUR',
    no_shipping: '1',
    no_note: '1',
    custom: device,
    notify_url: `${CMS_PUBLIC}/ads.php?action=paypal_ipn`,
    return: `${CMS_PUBLIC}/ads.php?action=paypal_thanks`,
    cancel_return: `${CMS_PUBLIC}/ads.php?action=paypal_thanks`,
    rm: '1',
  })
  return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`
}

/** No house/EG creatives — AdSense only. */
function houseAds(): AdCreative[] {
  return []
}

export async function syncAdsStatus(): Promise<{
  adFree: boolean
  paidUntil: string | null
  deviceId: string
  paypalEmail: string
  priceEur: number
  checkoutUrl: string | null
  paypalAutomatic: boolean
  days: number
}> {
  const deviceId = getDeviceId()
  const local = getLocalAdFree()
  // Fast path: only paid if local entitlement is still valid
  const base = {
    deviceId,
    paypalEmail: 'beethegirl12fox@gmail.com',
    priceEur: 5,
    checkoutUrl: null as string | null,
    paypalAutomatic: true,
    days: 30,
  }

  try {
    // Cap wait so the UI never hangs forever waiting for CMS
    const r = await Promise.race([
      cmsRequest<{
        adFree?: boolean
        paidUntil?: string | null
        paypalEmail?: string
        priceEur?: number
        checkoutUrl?: string | null
        paypalAutomatic?: boolean
        days?: number
      }>({ path: `ads.php?action=status&device_id=${encodeURIComponent(deviceId)}` }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
    ])

    if (!r) {
      return {
        ...base,
        adFree: local.adFree,
        paidUntil: local.paidUntil,
      }
    }

    if (r.paidUntil && Date.parse(r.paidUntil) > Date.now()) {
      setLocalPaidUntil(r.paidUntil)
    } else if (r.adFree === false) {
      // Explicitly not paid on server — clear stale local grant
      if (local.paidUntil && Date.parse(local.paidUntil) <= Date.now()) {
        setLocalPaidUntil(null)
      }
    }

    const fresh = getLocalAdFree()
    return {
      adFree: fresh.adFree || Boolean(r.adFree && r.paidUntil && Date.parse(String(r.paidUntil)) > Date.now()),
      paidUntil: fresh.paidUntil || (r.paidUntil && Date.parse(String(r.paidUntil)) > Date.now() ? r.paidUntil : null),
      deviceId,
      paypalEmail: r.paypalEmail || base.paypalEmail,
      priceEur: r.priceEur || base.priceEur,
      checkoutUrl: r.checkoutUrl || null,
      paypalAutomatic: r.paypalAutomatic !== false,
      days: r.days || base.days,
    }
  } catch {
    return {
      ...base,
      adFree: local.adFree,
      paidUntil: local.paidUntil,
    }
  }
}

export async function getPaypalCheckoutUrl(): Promise<
  { ok: true; checkoutUrl: string } | { ok: false; error: string }
> {
  const deviceId = getDeviceId()
  // Always prefer a working local PayPal URL so purchase is never blocked by CMS
  const localUrl = buildLocalPaypalCheckoutUrl(deviceId)
  try {
    const r = await Promise.race([
      cmsRequest<{ checkoutUrl?: string; error?: string }>({
        path: `ads.php?action=paypal_checkout&device_id=${encodeURIComponent(deviceId)}`,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ])
    if (r?.checkoutUrl && String(r.checkoutUrl).startsWith('https://')) {
      return { ok: true, checkoutUrl: String(r.checkoutUrl) }
    }
  } catch {
    /* fall through */
  }
  return { ok: true, checkoutUrl: localUrl }
}

/**
 * EG creatives inventory disabled — launcher uses Google AdSense only.
 */
export async function fetchAdInventory(_limit = 4): Promise<{
  ads: AdCreative[]
  adFree: boolean
  source: 'cms' | 'house'
}> {
  const local = getLocalAdFree()
  return { ads: [], adFree: local.adFree, source: 'house' }
}

export async function trackAdEvent(
  creativeId: string,
  event: 'impression' | 'click',
): Promise<void> {
  try {
    await cmsRequest({
      path: 'ads.php?action=track',
      method: 'POST',
      body: {
        creativeId,
        event,
        deviceId: getDeviceId(),
      },
    })
  } catch {
    /* non-fatal */
  }
}

export type AdNetworkConfig = {
  adFree: boolean
  enabled: boolean
  /** none | adsense | custom | eg */
  provider: string
  adsenseClient: string
  adsenseSlot: string
  hasCustomHtml: boolean
  /** Hosted unit page URL (iframe) — Google AdSense or network tags */
  unitUrl: string | null
  note?: string
}

/**
 * Real ad-network configuration (AdSense / HTML tags hosted on CMS).
 * AdMob is mobile-only; desktop uses AdSense or third-party HTML tags.
 */
export async function fetchAdNetworkConfig(): Promise<AdNetworkConfig> {
  const deviceId = getDeviceId()
  const local = getLocalAdFree()
  const empty: AdNetworkConfig = {
    adFree: local.adFree,
    enabled: false,
    provider: 'none',
    adsenseClient: '',
    adsenseSlot: '',
    hasCustomHtml: false,
    unitUrl: null,
  }
  if (local.adFree) return { ...empty, adFree: true }

  try {
    const r = await Promise.race([
      cmsRequest<{
        adFree?: boolean
        enabled?: boolean
        provider?: string
        adsenseClient?: string
        adsenseSlot?: string
        hasCustomHtml?: boolean
        unitUrl?: string
        note?: string
      }>({ path: `ads.php?action=network&device_id=${encodeURIComponent(deviceId)}` }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
    ])
    if (!r) return empty
    if (r.adFree) return { ...empty, adFree: true }
    return {
      adFree: false,
      enabled: Boolean(r.enabled),
      provider: String(r.provider || 'none'),
      adsenseClient: String(r.adsenseClient || ''),
      adsenseSlot: String(r.adsenseSlot || ''),
      hasCustomHtml: Boolean(r.hasCustomHtml),
      unitUrl: r.unitUrl && String(r.unitUrl).startsWith('https://') ? String(r.unitUrl) : null,
      note: r.note,
    }
  } catch {
    return empty
  }
}

export async function redeemAdCode(
  code: string,
): Promise<{ ok: true; paidUntil: string; message?: string } | { ok: false; error: string }> {
  try {
    const r = await cmsRequest<{ paidUntil?: string; message?: string; error?: string }>({
      path: 'ads.php?action=redeem',
      method: 'POST',
      body: { code, deviceId: getDeviceId() },
    })
    if (!r.paidUntil) return { ok: false, error: r.error || 'Redeem failed' }
    setLocalPaidUntil(r.paidUntil)
    return { ok: true, paidUntil: r.paidUntil, message: r.message }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function submitAdClaim(input: {
  email?: string
  message?: string
}): Promise<{ ok: true; message?: string } | { ok: false; error: string }> {
  try {
    const r = await cmsRequest<{ message?: string }>({
      path: 'ads.php?action=claim',
      method: 'POST',
      body: { deviceId: getDeviceId(), ...input },
    })
    return { ok: true, message: r.message }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
