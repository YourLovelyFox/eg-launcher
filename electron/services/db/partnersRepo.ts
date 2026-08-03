import type { PartnerConfig } from '../../../shared/types'
import { cmsRequest } from '../cms/httpClient'
import { getStaffSessionToken } from '../staffSession'

export async function listPartnerConfigsFromDb(): Promise<PartnerConfig[]> {
  const r = await cmsRequest<{ partners?: PartnerConfig[] }>({ path: 'partners.php' })
  return Array.isArray(r.partners) ? r.partners : []
}

export async function upsertPartnerConfigInDb(
  p: PartnerConfig,
  newsPassword?: string,
): Promise<void> {
  const staffTok = getStaffSessionToken()
  await cmsRequest({
    path: 'partners.php',
    method: 'POST',
    admin: true,
    sessionToken: staffTok,
    body: {
      action: 'upsert',
      partner: p,
      newsPassword: newsPassword || undefined,
      // Body fallback if host strips custom headers
      sessionToken: staffTok || undefined,
    },
  })
}

export async function deletePartnerConfigFromDb(id: string): Promise<void> {
  const staffTok = getStaffSessionToken()
  if (!staffTok) {
    throw new Error(
      'Session timed out or not signed in. Open Settings → Staff and sign in again.',
    )
  }
  await cmsRequest({
    path: 'partners.php',
    method: 'POST',
    admin: true,
    sessionToken: staffTok,
    body: {
      action: 'delete',
      id,
      // Body fallback if host strips custom headers
      sessionToken: staffTok,
    },
  })
}
