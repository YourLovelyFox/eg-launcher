/**
 * Direct MySQL pool disabled — CMS uses HTTPS API only.
 */
export async function ensureSchema(): Promise<void> {
  /* server-side */
}

export async function pingCmsDb(): Promise<
  { ok: true; database: string; host: string } | { ok: false; error: string }
> {
  const { cmsHealth, getCmsApiBase } = await import('../cms/httpClient')
  const h = await cmsHealth()
  if (!h.ok) return { ok: false, error: h.error || 'CMS unreachable' }
  return { ok: true, database: 'via-https-api', host: getCmsApiBase() }
}

export async function closePool(): Promise<void> {
  /* no-op */
}
