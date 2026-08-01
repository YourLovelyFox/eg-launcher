import https from 'https'
import http from 'http'
import { CMS_API_FALLBACK_BASES, resolveCmsApiBase } from '../../../shared/cmsApi'

const USER_AGENT = 'EGLauncher-CMS/1.0'
const MAX_REDIRECTS = 8

export type CmsJson = Record<string, unknown>

/**
 * CMS admin API keys are no longer used by the launcher.
 * Staff Menu is 100% CMS staff-account based (X-EG-Session).
 * Kept as no-ops so older call sites compile without errors.
 */
export function loadAdminApiKey(): string | null {
  return null
}

export function cacheAdminApiKey(_key: string): void {
  /* intentionally unused */
}

export function setAdminApiKey(_key: string): { ok: true } | { ok: false; error: string } {
  // No local CMS key — account session only
  return { ok: true }
}

export function getCmsApiBase(): string {
  return resolveCmsApiBase()
}

function buildHeaders(options: {
  bodyStr?: string
  sessionToken?: string | null
  admin?: boolean
}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  }
  if (options.bodyStr !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = String(Buffer.byteLength(options.bodyStr))
  }
  if (options.sessionToken) {
    headers['X-EG-Session'] = options.sessionToken
  } else if (options.admin) {
    // Attach staff session when present (never use CMS API keys)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getStaffSessionToken } = require('../staffSession') as typeof import('../staffSession')
      const st = getStaffSessionToken()
      if (st) headers['X-EG-Session'] = st
    } catch {
      /* ignore */
    }
  }
  if (options.admin && !headers['X-EG-Session']) {
    throw new Error(
      'Session expired or not signed in. Open Settings → Staff and sign in again (idle timeout 30 minutes).',
    )
  }
  return headers
}

function requestOnce(
  url: URL,
  method: string,
  headers: Record<string, string>,
  bodyStr: string | undefined,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const lib = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 60_000,
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('CMS request timed out'))
    })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

async function requestWithRedirects(
  startUrl: URL,
  method: string,
  headers: Record<string, string>,
  bodyStr: string | undefined,
): Promise<{ status: number; body: string; finalUrl: string }> {
  let url = startUrl
  let currentMethod = method
  let currentBody = bodyStr
  let currentHeaders = { ...headers }

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await requestOnce(url, currentMethod, currentHeaders, currentBody)
    const status = res.status

    if (status >= 300 && status < 400 && res.headers.location) {
      const next = new URL(res.headers.location, url)
      if (status === 303 || (status === 302 && currentMethod !== 'GET' && currentMethod !== 'HEAD')) {
        currentMethod = 'GET'
        currentBody = undefined
        const h = { ...currentHeaders }
        delete h['Content-Type']
        delete h['Content-Length']
        currentHeaders = h
      }
      url = next
      continue
    }

    return { status, body: res.body, finalUrl: url.toString() }
  }

  throw new Error('CMS too many redirects')
}

function parseJsonBody(status: number, text: string, finalUrl: string): CmsJson {
  const trimmed = text.trim()
  if (!trimmed) {
    if (status >= 200 && status < 300) return {}
    throw new Error(`CMS empty response (HTTP ${status}) from ${finalUrl}`)
  }
  try {
    return JSON.parse(trimmed) as CmsJson
  } catch {
    const hint =
      status === 302 || status === 301
        ? ' (redirect not followed — check API base URL)'
        : status === 404
          ? ' (API not found)'
          : ''
    throw new Error(
      `CMS invalid JSON (HTTP ${status})${hint}: ${trimmed.replace(/\s+/g, ' ').slice(0, 140)}`,
    )
  }
}

export async function cmsRequest<T extends CmsJson = CmsJson>(options: {
  path: string
  method?: string
  body?: unknown
  sessionToken?: string | null
  admin?: boolean
}): Promise<T> {
  const bases = [
    getCmsApiBase(),
    ...CMS_API_FALLBACK_BASES.filter((b) => b !== getCmsApiBase()),
  ].filter(Boolean)

  const method = options.method || 'GET'
  const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : undefined
  const headers = buildHeaders({
    bodyStr,
    sessionToken: options.sessionToken,
    admin: options.admin,
  })

  let lastErr: Error | null = null

  for (const base of bases) {
    try {
      const url = new URL(
        options.path.startsWith('http')
          ? options.path
          : `${base.replace(/\/+$/, '')}/${options.path.replace(/^\//, '')}`,
      )
      const res = await requestWithRedirects(url, method, headers, bodyStr)
      const json = parseJsonBody(res.status, res.body, res.finalUrl)

      if (res.status >= 400) {
        const err = sanitizeCmsError(String(json.error || `HTTP ${res.status}`))
        // Auth / client errors: CMS is reachable — do not thrash fallback hosts
        if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 409) {
          throw new Error(err)
        }
        if (res.status === 404) {
          lastErr = new Error(err)
          continue
        }
        throw new Error(err)
      }
      return json as T
    } catch (err) {
      const msg = sanitizeCmsError((err as Error).message)
      lastErr = new Error(msg)
      // Do not try alternate bases for auth/session failures
      if (/staff login|admin login|session expired|not signed in|not authenticated/i.test(msg)) {
        throw lastErr
      }
      continue
    }
  }

  throw lastErr || new Error('CMS offline or unreachable')
}

/** Never surface legacy CMS API-key wording to the UI. */
function sanitizeCmsError(msg: string): string {
  if (/api key|admin key|cms key|admin_api_key|X-EG-Admin-Key/i.test(msg)) {
    return 'Staff login required. Open Settings → Staff and sign in again.'
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|getaddrinfo|UNABLE_TO_VERIFY|CERT_|TLS|SSL|self.signed|issuer/i.test(
      msg,
    )
  ) {
    return 'CMS offline or unreachable'
  }
  if (/timed out|timeout/i.test(msg)) {
    return 'CMS offline or unreachable (timeout)'
  }
  return msg
}

export async function cmsHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await cmsRequest<{ ok?: boolean; error?: string }>({ path: 'health.php' })
    return { ok: Boolean(r.ok), error: r.error as string | undefined }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
