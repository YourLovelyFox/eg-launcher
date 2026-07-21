import type { PartnerConfig } from '../../../shared/types'
import { cmsRequest } from '../cms/httpClient'

export async function listPartnerConfigsFromDb(): Promise<PartnerConfig[]> {
  const r = await cmsRequest<{ partners?: PartnerConfig[] }>({ path: 'partners.php' })
  return Array.isArray(r.partners) ? r.partners : []
}

export async function upsertPartnerConfigInDb(
  p: PartnerConfig,
  newsPassword?: string,
): Promise<void> {
  await cmsRequest({
    path: 'partners.php',
    method: 'POST',
    admin: true,
    body: {
      action: 'upsert',
      partner: p,
      newsPassword: newsPassword || undefined,
    },
  })
}

export async function deletePartnerConfigFromDb(id: string): Promise<void> {
  await cmsRequest({
    path: 'partners.php',
    method: 'POST',
    admin: true,
    body: { action: 'delete', id },
  })
}
