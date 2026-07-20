import https from 'https'
import {
  CONTENT_BRANCH,
  CONTENT_OWNER,
  CONTENT_REPO,
  PUBLIC_BRANCH,
  PUBLIC_OWNER,
  PUBLIC_REPO,
} from '../../shared/contentRepo'

export function ghRequest(
  method: string,
  apiPath: string,
  token: string,
  body?: object,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'User-Agent': 'EGLauncher-Content',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          let json: any = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            json = { message: text }
          }
          resolve({ status: res.statusCode || 0, json })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Put a text file on a repo (create or update).
 * Retries on 409 — GitHub Contents API conflicts when two commits land on the same branch.
 */
export async function putRepoFile(options: {
  token: string
  owner: string
  repo: string
  branch: string
  path: string
  content: string
  message: string
}): Promise<{ ok: true; commitUrl?: string } | { ok: false; error: string }> {
  const { token, owner, repo, branch, path: filePath, content, message } = options
  const encoded = Buffer.from(content, 'utf8').toString('base64')
  let lastError = `PUT ${filePath} failed`

  for (let attempt = 0; attempt < 5; attempt++) {
    const getPath = `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`
    const existing = await ghRequest('GET', getPath, token)
    if (existing.status !== 200 && existing.status !== 404) {
      return {
        ok: false,
        error: existing.json?.message || `GET ${filePath} failed (${existing.status})`,
      }
    }
    const sha = existing.status === 200 ? existing.json?.sha : undefined
    // Same bytes already on GitHub — treat as success (avoids empty commits)
    if (sha && existing.status === 200 && typeof existing.json?.content === 'string') {
      const remote = Buffer.from(
        String(existing.json.content).replace(/\n/g, ''),
        'base64',
      ).toString('utf8')
      if (remote === content) {
        return { ok: true, commitUrl: existing.json?.html_url }
      }
    }

    const put = await ghRequest('PUT', `/repos/${owner}/${repo}/contents/${filePath}`, token, {
      message: attempt === 0 ? message : `${message} (retry ${attempt})`,
      content: encoded,
      branch,
      ...(sha ? { sha } : {}),
    })
    if (put.status === 200 || put.status === 201) {
      return { ok: true, commitUrl: put.json?.commit?.html_url }
    }

    lastError = put.json?.message || `PUT ${filePath} failed (${put.status})`
    // 409 = branch moved; 422 often sha mismatch — refresh and retry
    if (put.status === 409 || put.status === 422) {
      await sleep(120 + attempt * 180)
      continue
    }
    return { ok: false, error: lastError }
  }

  return { ok: false, error: lastError }
}

/**
 * Write several files one-by-one (same branch). Parallel Contents API puts race and 409.
 */
export async function putRepoFilesSequential(
  files: Array<{
    token: string
    owner: string
    repo: string
    branch: string
    path: string
    content: string
    message: string
  }>,
): Promise<{ ok: true; commitUrl?: string } | { ok: false; error: string }> {
  let commitUrl: string | undefined
  for (const file of files) {
    const res = await putRepoFile(file)
    if (!res.ok) return res
    if (res.commitUrl) commitUrl = res.commitUrl
  }
  return { ok: true, commitUrl }
}

export async function getRepoFileText(options: {
  token?: string
  owner: string
  repo: string
  branch: string
  path: string
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { token, owner, repo, branch, path: filePath } = options
  const apiPath = `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`

  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      'User-Agent': 'EGLauncher-Content',
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (token) headers.Authorization = `Bearer ${token}`

    const req = https.get(
      { hostname: 'api.github.com', path: apiPath, headers, timeout: 20_000 },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode && res.statusCode >= 400) {
            resolve({ ok: false, error: `HTTP ${res.statusCode}: ${text.slice(0, 200)}` })
            return
          }
          resolve({ ok: true, text })
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, error: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: 'timeout' })
    })
  })
}

export const privateRepo = {
  owner: CONTENT_OWNER,
  repo: CONTENT_REPO,
  branch: CONTENT_BRANCH,
}

export const publicRepo = {
  owner: PUBLIC_OWNER,
  repo: PUBLIC_REPO,
  branch: PUBLIC_BRANCH,
}
