import fs from 'fs'
import path from 'path'
import { isAdminBuild } from '../../shared/features'
import { getDataRoot, readJsonFile } from '../paths'

/**
 * Dev-only GitHub write token (never used in Live public builds for shipping secrets in the binary).
 * Live partner login uses public hash mirror only.
 */
export function loadDevGithubToken(): string | null {
  // Allow token on any build for partner publish from a staff PC, but prefer Dev.
  // Token is only read from local files / env — never bundled.
  if (process.env.EG_GITHUB_TOKEN?.trim()) {
    return process.env.EG_GITHUB_TOKEN.trim()
  }

  const candidates = [
    path.join(process.cwd(), 'admin.local.json'),
    path.join(__dirname, '../../admin.local.json'),
    path.join(
      process.env.USERPROFILE || process.env.HOME || '',
      'Desktop',
      'New folder',
      'eg-launcher-github-token.txt',
    ),
  ]

  for (const p of candidates) {
    try {
      if (!p || !fs.existsSync(p)) continue
      if (p.endsWith('.json')) {
        const j = readJsonFile<{ githubToken?: string }>(p, {})
        if (j.githubToken?.trim()) return j.githubToken.trim()
      } else {
        const t = fs
          .readFileSync(p, 'utf-8')
          .trim()
          .split(/\r?\n/)
          .find((l) => l && !l.startsWith('#'))
        if (t) return t.trim()
      }
    } catch {
      /* next */
    }
  }

  // Cached token from Admin panel (Dev)
  if (isAdminBuild()) {
    const secrets = readJsonFile<{ githubToken?: string }>(
      path.join(getDataRoot(), 'admin-secrets.json'),
      {},
    )
    if (secrets.githubToken?.trim()) return secrets.githubToken.trim()
  }

  return null
}
