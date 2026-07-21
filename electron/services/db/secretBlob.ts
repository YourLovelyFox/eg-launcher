/**
 * Direct DB credentials are NOT used by the Live/Dev client anymore.
 * CMS traffic goes to HTTPS: https://client116.ddns.net (PHP → MariaDB localhost).
 *
 * This module remains only so accidental imports fail clearly.
 */

export type CmsDbConfig = {
  host: string
  hosts: string[]
  port: number
  user: string
  password: string
  database: string
}

export function resolveCmsDbConfig(): CmsDbConfig {
  throw new Error(
    'Direct MariaDB access is disabled. The launcher uses the HTTPS CMS API (shared/cmsApi.ts).',
  )
}
