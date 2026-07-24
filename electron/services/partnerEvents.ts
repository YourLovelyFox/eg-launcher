import type { PartnerEvent } from '../../shared/types'
import { cmsRequest } from './cms/httpClient'

export async function listPartnerEvents(partnerId?: string): Promise<PartnerEvent[]> {
  const path = partnerId
    ? `partner_events.php?partner_id=${encodeURIComponent(partnerId)}`
    : 'partner_events.php'
  const r = await cmsRequest<{ events?: PartnerEvent[] }>({ path })
  return Array.isArray(r.events) ? r.events : []
}

export async function adminUpsertPartnerEvent(
  sessionToken: string,
  input: {
    id?: string
    partnerId: string
    title: string
    description?: string
    startsAt: string
    endsAt?: string | null
    location?: string | null
  },
  requireAdmin: (t: string) => boolean,
): Promise<{ ok: true; event: PartnerEvent; message?: string } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  try {
    const r = await cmsRequest<{ event?: PartnerEvent; message?: string; error?: string }>({
      path: 'partner_events.php',
      method: 'POST',
      admin: true,
      body: { action: 'upsert', ...input },
    })
    if (!r.event) return { ok: false, error: r.error || 'Save failed' }
    return { ok: true, event: r.event, message: r.message }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function adminDeletePartnerEvent(
  sessionToken: string,
  id: string,
  requireAdmin: (t: string) => boolean,
): Promise<{ ok: true; message?: string } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  try {
    const r = await cmsRequest<{ message?: string; error?: string }>({
      path: 'partner_events.php',
      method: 'POST',
      admin: true,
      body: { action: 'delete', id },
    })
    return { ok: true, message: r.message || 'Deleted' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
