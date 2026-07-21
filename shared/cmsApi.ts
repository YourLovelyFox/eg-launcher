/**
 * CMS API base URL (public HTTPS endpoint — not a DB password).
 * Override: EG_CMS_API_BASE
 */
export const DEFAULT_CMS_API_BASE = 'https://client116.ddns.net'

export const CMS_API_FALLBACK_BASES = [
  'https://client116.ddns.net',
  'http://client116.ddns.net',
] as const

export function resolveCmsApiBase(): string {
  if (typeof process !== 'undefined' && process.env?.EG_CMS_API_BASE?.trim()) {
    return process.env.EG_CMS_API_BASE.trim().replace(/\/+$/, '')
  }
  return DEFAULT_CMS_API_BASE.replace(/\/+$/, '')
}
