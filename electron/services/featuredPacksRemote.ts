import type { FeaturedPackConfig } from '../../shared/types'
import { FEATURED_PACK } from '../../shared/branding'
import { cmsRequest } from './cms/httpClient'
import { getStaffSessionToken } from './staffSession'

function fallbackPacks(): FeaturedPackConfig[] {
  return [
    {
      id: FEATURED_PACK.id,
      slug: FEATURED_PACK.slug,
      projectId: FEATURED_PACK.projectId,
      title: FEATURED_PACK.title,
      description: FEATURED_PACK.description,
      menuLabel: FEATURED_PACK.menuLabel,
      minSystemRamGb: FEATURED_PACK.minSystemRamGb,
      recommendedAllocatedMb: FEATURED_PACK.recommendedAllocatedMb,
      iconUrl: null,
      enabled: true,
      sortOrder: 0,
    },
  ]
}

export async function listFeaturedPacks(all = false): Promise<FeaturedPackConfig[]> {
  try {
    const r = await cmsRequest<{ packs?: FeaturedPackConfig[] }>({
      path: all ? 'featured_packs.php?all=1' : 'featured_packs.php',
      admin: all,
    })
    if (Array.isArray(r.packs) && r.packs.length > 0) return r.packs
  } catch {
    /* fall through */
  }
  return fallbackPacks()
}

export async function saveFeaturedPack(
  pack: Partial<FeaturedPackConfig> & { slug: string; projectId: string; title: string },
): Promise<{ ok: true; pack: FeaturedPackConfig } | { ok: false; error: string }> {
  try {
    const staffTok = getStaffSessionToken()
    const r = await cmsRequest<{ pack?: FeaturedPackConfig; error?: string }>({
      path: 'featured_packs.php',
      method: 'POST',
      admin: true,
      sessionToken: staffTok,
      body: { action: 'upsert', ...pack, sessionToken: staffTok || undefined },
    })
    if (!r.pack) return { ok: false, error: r.error || 'Save failed' }
    return { ok: true, pack: r.pack }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function deleteFeaturedPack(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const staffTok = getStaffSessionToken()
    await cmsRequest({
      path: 'featured_packs.php',
      method: 'POST',
      admin: true,
      sessionToken: staffTok,
      body: { action: 'delete', id, sessionToken: staffTok || undefined },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
