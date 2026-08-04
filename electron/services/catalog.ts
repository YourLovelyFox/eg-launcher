import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import type {
  CatalogProject,
  CatalogSearchResult,
  CatalogVersion,
} from '../../shared/types'

/** Third-party mod catalog HTTP API (metadata + file downloads). Host is not hard-coded as plain text. */
const API_BASE = Buffer.from('aHR0cHM6Ly9hcGkubW9kcmludGguY29tL3Yy', 'base64').toString('utf8')
const USER_AGENT = 'EGLauncher/1.0.0 (https://github.com/YourLovelyFox/eg-launcher)'
/** Public site origin for “view project” links (decoded at runtime). */
export const CATALOG_SITE_ORIGIN = Buffer.from('aHR0cHM6Ly9tb2RyaW50aC5jb20=', 'base64').toString('utf8')
/** Standard .mrpack index filename inside pack zips. */
export const PACK_INDEX_FILENAME = Buffer.from('bW9kcmludGguaW5kZXguanNvbg==', 'base64').toString('utf8')

/**
 * True when this id is a real mod project/version id or slug.
 * Pack installs create synthetic `local-*` / `import-*` / `disk-*` ids from filenames —
 * those must never be sent to the API (404 spam).
 */
export function isCatalogApiId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false
  const s = id.trim()
  if (!s) return false
  if (/^(local|import|disk|offline)-/i.test(s)) return false
  // Base62-ish mod catalog ids are 8 chars; slugs are lowercase alnum with hyphens
  return true
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Adaptive mod catalog API throttle:
 * - Up to 3 concurrent requests (update checks stay usable for big packs)
 * - Small gap between starts; widens temporarily after 429
 */
const API_MAX_CONCURRENT = 3
const API_GAP_FAST_MS = 45
const API_GAP_SLOW_MS = 280
let apiActive = 0
let apiGapMs = API_GAP_FAST_MS
let apiSlowUntil = 0
let lastApiStart = 0
const apiWaiters: Array<() => void> = []

function bumpApiSlowMode(ms = 12_000) {
  apiGapMs = API_GAP_SLOW_MS
  apiSlowUntil = Date.now() + ms
}

function currentApiGap(): number {
  if (Date.now() > apiSlowUntil) apiGapMs = API_GAP_FAST_MS
  return apiGapMs
}

function releaseApiSlot() {
  apiActive = Math.max(0, apiActive - 1)
  const next = apiWaiters.shift()
  if (next) next()
}

async function acquireApiSlot(): Promise<void> {
  if (apiActive < API_MAX_CONCURRENT) {
    apiActive++
    return
  }
  await new Promise<void>((resolve) => {
    apiWaiters.push(() => {
      apiActive++
      resolve()
    })
  })
}

async function scheduleApi<T>(fn: () => Promise<T>): Promise<T> {
  await acquireApiSlot()
  try {
    const gap = currentApiGap()
    const wait = Math.max(0, gap - (Date.now() - lastApiStart))
    if (wait > 0) await sleep(wait)
    lastApiStart = Date.now()
    return await fn()
  } finally {
    releaseApiSlot()
  }
}

class CatalogHttpError extends Error {
  status: number
  retryAfterMs: number | null
  constructor(status: number, retryAfterMs: number | null = null) {
    super(status === 429 ? 'Mod catalog rate limit (429)' : `mod catalog API ${status}`)
    this.name = 'CatalogHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

function requestJsonOnce<T>(url: string, options?: { method?: string; body?: string }): Promise<T> {
  return new Promise((resolve, reject) => {
    const method = options?.method || 'GET'
    const lib = url.startsWith('https') ? https : http
    const parsed = new URL(url)
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(options?.body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(options.body) }
            : {}),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          requestJsonOnce<T>(res.headers.location, options).then(resolve).catch(reject)
          return
        }

        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode && res.statusCode >= 400) {
            let retryAfterMs: number | null = null
            const ra = res.headers['retry-after']
            if (ra) {
              const sec = Number(ra)
              if (Number.isFinite(sec) && sec >= 0) retryAfterMs = sec * 1000
            }
            reject(new CatalogHttpError(res.statusCode, retryAfterMs))
            return
          }
          try {
            resolve(JSON.parse(text || 'null') as T)
          } catch (err) {
            reject(err)
          }
        })
      },
    )
    req.setTimeout(12_000, () => {
      req.destroy(new Error('mod catalog request timed out'))
    })
    req.on('error', reject)
    if (options?.body) req.write(options.body)
    req.end()
  })
}

/** Rate-limited mod catalog JSON request with automatic 429 backoff (bounded). */
async function requestJson<T>(url: string, options?: { method?: string; body?: string }): Promise<T> {
  const maxAttempts = 5
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await scheduleApi(() => requestJsonOnce<T>(url, options))
    } catch (err) {
      lastErr = err
      const is429 =
        err instanceof CatalogHttpError
          ? err.status === 429
          : /429|rate limit/i.test((err as Error)?.message || '')
      if (!is429 || attempt === maxAttempts) throw err

      bumpApiSlowMode(15_000)
      const fromHeader =
        err instanceof CatalogHttpError && err.retryAfterMs != null ? err.retryAfterMs : null
      // Bounded backoff — never sit "Checking updates…" for minutes
      const backoff = Math.min(8_000, fromHeader ?? 600 * 2 ** (attempt - 1))
      const jitter = Math.floor(Math.random() * 250)
      await sleep(backoff + jitter)
    }
  }
  throw lastErr
}

export async function searchMods(options: {
  query?: string
  gameVersion?: string
  loader?: string
  /** mod catalog category slugs, e.g. optimization, utility, adventure */
  categories?: string[]
  offset?: number
  limit?: number
  index?: string
}): Promise<CatalogSearchResult> {
  const facets: string[][] = [['project_type:mod']]

  if (options.gameVersion) {
    facets.push([`versions:${options.gameVersion}`])
  }
  if (options.loader && options.loader !== 'vanilla') {
    facets.push([`categories:${options.loader}`])
  }
  // Additional content categories (OR within group, AND with other facets)
  const cats = (options.categories || []).map((c) => c.trim()).filter(Boolean)
  if (cats.length === 1) {
    facets.push([`categories:${cats[0]}`])
  } else if (cats.length > 1) {
    facets.push(cats.map((c) => `categories:${c}`))
  }

  const params = new URLSearchParams()
  if (options.query) params.set('query', options.query)
  params.set('facets', JSON.stringify(facets))
  params.set('offset', String(options.offset ?? 0))
  params.set('limit', String(options.limit ?? 20))
  params.set('index', options.index ?? 'relevance')

  return requestJson<CatalogSearchResult>(`${API_BASE}/search?${params.toString()}`)
}

export async function getProject(idOrSlug: string): Promise<CatalogProject> {
  if (!isCatalogApiId(idOrSlug)) {
    throw new Error('Not a valid catalog project id')
  }
  return requestJson<CatalogProject>(`${API_BASE}/project/${encodeURIComponent(idOrSlug)}`)
}

/**
 * Batch fetch projects (title, slug, icon_url).
 * GET /v2/projects?ids=["…"]
 */
export async function getProjects(ids: string[]): Promise<CatalogProject[]> {
  const unique = [...new Set(ids.filter((id) => isCatalogApiId(id)))]
  if (unique.length === 0) return []

  const out: CatalogProject[] = []
  const chunkSize = 50
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    try {
      const url =
        `${API_BASE}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`
      const batch = await requestJson<CatalogProject[]>(url)
      if (Array.isArray(batch)) out.push(...batch)
    } catch {
      // fall back one-by-one for this chunk
      for (const id of chunk) {
        try {
          out.push(await getProject(id))
        } catch {
          // skip missing
        }
      }
    }
  }
  return out
}

/**
 * Fill title / slug / iconUrl from the mod catalog project metadata.
 * Keeps version ids and file names from the installed mod records.
 */
export async function enrichModsWithProjectMeta(
  mods: import('../../shared/types').InstalledMod[],
): Promise<import('../../shared/types').InstalledMod[]> {
  const needIds = [
    ...new Set(
      mods
        .filter(
          (m) =>
            isCatalogApiId(m.projectId) &&
            (!m.iconUrl || !m.title || m.title === m.projectId || m.slug === m.projectId),
        )
        .map((m) => m.projectId),
    ),
  ]
  if (needIds.length === 0) return mods

  const projects = await getProjects(needIds)
  const byId = new Map<string, CatalogProject>()
  for (const p of projects) {
    byId.set(p.id, p)
    if (p.slug) byId.set(p.slug, p)
  }

  return mods.map((m) => {
    const p = byId.get(m.projectId)
    if (!p) return m
    return {
      ...m,
      projectId: p.id,
      slug: p.slug || m.slug,
      title: p.title || m.title,
      iconUrl: p.icon_url ?? m.iconUrl ?? null,
    }
  })
}

/**
 * Resolve synthetic local-* mods by hashing jars on disk → mod catalog version_files → projects.
 * Also fills missing titles/icons for mods that already have real project ids.
 */
export async function repairInstalledModsMeta(
  mods: import('../../shared/types').InstalledMod[],
  modsDir: string,
): Promise<import('../../shared/types').InstalledMod[]> {
  let next = [...mods]
  const crypto = await import('crypto')

  // 1) Hash local / untracked jars and map to the mod catalog versions
  const localIdx: number[] = []
  const hashes: string[] = []
  for (let i = 0; i < next.length; i++) {
    const m = next[i]!
    if (isCatalogApiId(m.projectId) && m.iconUrl && m.title && m.title !== m.projectId) continue
    if (!isCatalogApiId(m.projectId)) {
      const jarPath = path.join(modsDir, m.fileName)
      const disabled = path.join(modsDir, `${m.fileName}.disabled`)
      const file = fs.existsSync(jarPath) ? jarPath : fs.existsSync(disabled) ? disabled : null
      if (!file) continue
      try {
        const data = fs.readFileSync(file)
        const sha1 = crypto.createHash('sha1').update(data).digest('hex')
        localIdx.push(i)
        hashes.push(sha1)
      } catch {
        // skip unreadable
      }
    }
  }

  if (hashes.length > 0) {
    const byHash = await getVersionsByHashes(hashes, 'sha1')
    for (let h = 0; h < hashes.length; h++) {
      const sha1 = hashes[h]!
      const idx = localIdx[h]!
      const ver = byHash[sha1]
      if (!ver?.project_id || !ver?.id) continue
      const prev = next[idx]!
      next[idx] = {
        ...prev,
        projectId: ver.project_id,
        versionId: ver.id,
        versionNumber: ver.version_number || prev.versionNumber,
        loaders: ver.loaders?.length ? ver.loaders : prev.loaders,
        gameVersions: ver.game_versions?.length ? ver.game_versions : prev.gameVersions,
        title: ver.name || prev.title,
      }
    }
  }

  // 2) Batch project meta (nice titles + icons)
  next = await enrichModsWithProjectMeta(next)
  return next
}

export async function getProjectVersions(
  idOrSlug: string,
  gameVersion?: string,
  loader?: string,
): Promise<CatalogVersion[]> {
  // Never hit the API with synthetic pack-local ids (avoids 404 console spam)
  if (!isCatalogApiId(idOrSlug)) return []

  const params = new URLSearchParams()
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
  if (loader && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]))
  const qs = params.toString()
  const url = `${API_BASE}/project/${encodeURIComponent(idOrSlug)}/version${qs ? `?${qs}` : ''}`
  try {
    return await requestJson<CatalogVersion[]>(url)
  } catch (err) {
    const msg = (err as Error).message || ''
    // Missing project / deleted mod → empty list (update checker treats as "no update")
    if (/API 404|API 410/.test(msg)) return []
    throw err
  }
}

export async function getVersion(versionId: string): Promise<CatalogVersion> {
  if (!isCatalogApiId(versionId)) {
    throw new Error('Not a valid catalog version id')
  }
  return requestJson<CatalogVersion>(`${API_BASE}/version/${encodeURIComponent(versionId)}`)
}

/**
 * Resolve many jar hashes → mod catalog versions (used after pack install).
 * Batch hash → version lookup (catalog version_files API).
 */
export async function getVersionsByHashes(
  hashes: string[],
  algorithm: 'sha1' | 'sha512' = 'sha1',
): Promise<Record<string, CatalogVersion>> {
  const unique = [...new Set(hashes.filter((h) => h && h.length >= 8))]
  if (unique.length === 0) return {}

  const out: Record<string, CatalogVersion> = {}
  // API allows batches; keep chunks modest
  const chunkSize = 64
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    try {
      const map = await requestJson<Record<string, CatalogVersion>>(`${API_BASE}/version_files`, {
        method: 'POST',
        body: JSON.stringify({ hashes: chunk, algorithm }),
      })
      Object.assign(out, map || {})
    } catch {
      // Partial failure — continue other chunks
    }
  }
  return out
}

function downloadFileOnce(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const doRequest = (requestUrl: string, redirectsLeft: number) => {
      if (redirectsLeft < 0) {
        reject(new Error(`Too many redirects: ${url}`))
        return
      }
      const lib = requestUrl.startsWith('https') ? https : http
      const req = lib.get(
        requestUrl,
        {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 120_000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            doRequest(res.headers.location, redirectsLeft - 1)
            return
          }

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Download failed (${res.statusCode})`))
            res.resume()
            return
          }

          const total = Number(res.headers['content-length'] || 0)
          let downloaded = 0
          const file = fs.createWriteStream(destPath)

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            onProgress?.(downloaded, total)
          })

          res.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
          file.on('error', (err) => {
            fs.unlink(destPath, () => undefined)
            reject(err)
          })
        },
      )
      req.on('timeout', () => {
        req.destroy(new Error('Download timed out'))
      })
      req.on('error', reject)
    }

    doRequest(url, 8)
  })
}

/** Download with retries (CDN flakes / 429 during big pack installs). */
export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await downloadFileOnce(url, destPath, onProgress)
      return
    } catch (err) {
      lastErr = err
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      } catch {
        /* ignore */
      }
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 400 * attempt * attempt))
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new Error(`${msg} (${path.basename(destPath)})`)
}

export function pickPrimaryFile(version: CatalogVersion) {
  return version.files.find((f) => f.primary) ?? version.files[0]
}
