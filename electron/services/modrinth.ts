import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import type {
  ModrinthProject,
  ModrinthSearchResult,
  ModrinthVersion,
} from '../../shared/types'

const API_BASE = 'https://api.modrinth.com/v2'
const USER_AGENT = 'EGLauncher/1.0.0 (minecraft-mod-launcher)'

function requestJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          requestJson<T>(res.headers.location).then(resolve).catch(reject)
          return
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Modrinth API error ${res.statusCode} for ${url}`))
          res.resume()
          return
        }

        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf-8')
            resolve(JSON.parse(text) as T)
          } catch (err) {
            reject(err)
          }
        })
      },
    )
    req.on('error', reject)
  })
}

export async function searchMods(options: {
  query?: string
  gameVersion?: string
  loader?: string
  offset?: number
  limit?: number
  index?: string
}): Promise<ModrinthSearchResult> {
  const facets: string[][] = [['project_type:mod']]

  if (options.gameVersion) {
    facets.push([`versions:${options.gameVersion}`])
  }
  if (options.loader && options.loader !== 'vanilla') {
    facets.push([`categories:${options.loader}`])
  }

  const params = new URLSearchParams()
  if (options.query) params.set('query', options.query)
  params.set('facets', JSON.stringify(facets))
  params.set('offset', String(options.offset ?? 0))
  params.set('limit', String(options.limit ?? 20))
  params.set('index', options.index ?? 'relevance')

  return requestJson<ModrinthSearchResult>(`${API_BASE}/search?${params.toString()}`)
}

export async function getProject(idOrSlug: string): Promise<ModrinthProject> {
  return requestJson<ModrinthProject>(`${API_BASE}/project/${encodeURIComponent(idOrSlug)}`)
}

export async function getProjectVersions(
  idOrSlug: string,
  gameVersion?: string,
  loader?: string,
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams()
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
  if (loader && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]))
  const qs = params.toString()
  const url = `${API_BASE}/project/${encodeURIComponent(idOrSlug)}/version${qs ? `?${qs}` : ''}`
  return requestJson<ModrinthVersion[]>(url)
}

export async function getVersion(versionId: string): Promise<ModrinthVersion> {
  return requestJson<ModrinthVersion>(`${API_BASE}/version/${encodeURIComponent(versionId)}`)
}

export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const doRequest = (requestUrl: string) => {
      const lib = requestUrl.startsWith('https') ? https : http
      const req = lib.get(
        requestUrl,
        {
          headers: { 'User-Agent': USER_AGENT },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location)
            return
          }

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Download failed (${res.statusCode}): ${requestUrl}`))
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
      req.on('error', reject)
    }

    doRequest(url)
  })
}

export function pickPrimaryFile(version: ModrinthVersion) {
  return version.files.find((f) => f.primary) ?? version.files[0]
}
