import { randomUUID } from 'crypto'
import path from 'path'
import { cmsRequest } from './cms/httpClient'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'

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
  try {
    const r = await cmsRequest<{
      adFree?: boolean
      paidUntil?: string | null
      paypalEmail?: string
      priceEur?: number
      checkoutUrl?: string | null
      paypalAutomatic?: boolean
      days?: number
    }>({ path: `ads.php?action=status&device_id=${encodeURIComponent(deviceId)}` })
    if (r.paidUntil && Date.parse(r.paidUntil) > Date.now()) {
      setLocalPaidUntil(r.paidUntil)
    }
    const local = getLocalAdFree()
    return {
      adFree: local.adFree || Boolean(r.adFree),
      paidUntil: local.paidUntil || r.paidUntil || null,
      deviceId,
      paypalEmail: r.paypalEmail || 'beethegirl12fox@gmail.com',
      priceEur: r.priceEur || 5,
      checkoutUrl: r.checkoutUrl || null,
      paypalAutomatic: r.paypalAutomatic !== false,
      days: r.days || 30,
    }
  } catch {
    const local = getLocalAdFree()
    return {
      ...local,
      paypalEmail: 'beethegirl12fox@gmail.com',
      priceEur: 5,
      checkoutUrl: null,
      paypalAutomatic: true,
      days: 30,
    }
  }
}

export async function getPaypalCheckoutUrl(): Promise<
  { ok: true; checkoutUrl: string } | { ok: false; error: string }
> {
  try {
    const deviceId = getDeviceId()
    const r = await cmsRequest<{ checkoutUrl?: string; error?: string }>({
      path: `ads.php?action=paypal_checkout&device_id=${encodeURIComponent(deviceId)}`,
    })
    if (!r.checkoutUrl) return { ok: false, error: r.error || 'Could not create PayPal checkout' }
    return { ok: true, checkoutUrl: r.checkoutUrl }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
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
