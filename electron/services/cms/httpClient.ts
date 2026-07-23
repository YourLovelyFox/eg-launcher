import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { CMS_API_FALLBACK_BASES, resolveCmsApiBase } from '../../../shared/cmsApi'
import { getDataRoot, readJsonFile, writeJsonFile } from '../../paths'

const USER_AGENT = 'EGLauncher-CMS/1.0'
const MAX_REDIRECTS = 8

export type CmsJson = Record<string, unknown>

/** Resolve admin API key from env, admin.local.json, or userData secrets. */
export function loadAdminApiKey(): string | null {
  if (process.env.EG_CMS_API_KEY?.trim()) return process.env.EG_CMS_API_KEY.trim()

  const candidates: string[] = []

  // CWD (npm run dev / project root)
  candidates.push(path.join(process.cwd(), 'admin.local.json'))

  // Relative to compiled main (dist-electron/) and source (electron/services/cms/)
  candidates.push(path.join(__dirname, '../../admin.local.json')) // dist-electron → project
  candidates.push(path.join(__dirname, '../../../admin.local.json')) // electron/services/cms → project
  candidates.push(path.join(__dirname, '../../../../admin.local.json'))

  // Electron app path (dev)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron')
    if (app?.getAppPath) {
      candidates.push(path.join(app.getAppPath(), 'admin.local.json'))
      candidates.push(path.join(app.getAppPath(), '..', 'admin.local.json'))
    }
  } catch {
    /* not in electron yet */
  }

  for (const p of candidates) {
    try {
      if (!p || !fs.existsSync(p)) continue
      const j = readJsonFile<{ cmsApiKey?: string; adminApiKey?: string }>(p, {})
      const key = (j.cmsApiKey || j.adminApiKey || '').trim()
      if (key) {
        // Cache into userData so later Admin ops work even if cwd changes
        try {
          cacheAdminApiKey(key)
        } catch {
          /* ignore */
        }
        return key
      }
    } catch {
      /* next */
    }
  }

  // Cached key from previous session / Admin UI
  try {
    const secrets = readJsonFile<{ cmsApiKey?: string }>(
      path.join(getDataRoot(), 'admin-secrets.json'),
      {},
    )
    if (secrets.cmsApiKey?.trim()) return secrets.cmsApiKey.trim()
  } catch {
    /* ignore */
  }

  return null
}

export function cacheAdminApiKey(key: string): void {
  const t = key.trim()
  if (!t) return
  const secretsPath = path.join(getDataRoot(), 'admin-secrets.json')
  const prev = readJsonFile<Record<string, unknown>>(secretsPath, {})
  writeJsonFile(secretsPath, { ...prev, cmsApiKey: t })
}

export function setAdminApiKey(key: string): { ok: true } | { ok: false; error: string } {
  const t = (key || '').trim()
  if (t.length < 8) return { ok: false, error: 'CMS API key looks too short' }
  cacheAdminApiKey(t)
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
  }
  if (options.admin) {
    const key = loadAdminApiKey()
    if (!key) {
      throw new Error(
        'CMS API key missing. In project folder create/edit admin.local.json with:\n' +
          '  "cmsApiKey": "<same as server config.php admin_api_key>"\n' +
          'Or set it under Admin → CMS API key. Partner login does NOT need this key.',
      )
    }
    headers['X-EG-Admin-Key'] = key
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
        const err = String(json.error || `HTTP ${res.status}`)
        if (res.status === 404) {
          lastErr = new Error(err)
          continue
        }
        throw new Error(err)
      }
      return json as T
    } catch (err) {
      lastErr = err as Error
      continue
    }
  }

  throw lastErr || new Error('CMS request failed')
}

export async function cmsHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await cmsRequest<{ ok?: boolean; error?: string }>({ path: 'health.php' })
    return { ok: Boolean(r.ok), error: r.error as string | undefined }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
