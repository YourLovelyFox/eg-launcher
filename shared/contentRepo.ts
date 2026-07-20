/**
 * Content CMS layout.
 *
 * Private repo (source of truth, partner auth):
 *   YourLovelyFox/eg-launcher-content
 *     feeds/launcher.json
 *     feeds/partners.json
 *     auth/partners.json
 *     config/partners.json
 *
 * Public mirrors (Live launcher reads, no secrets):
 *   YourLovelyFox/eg-launcher
 *     news/feed.json
 *     news/partners.json
 *     news/partner-auth.json   (password hashes only)
 *     news/partners-config.json
 */

export const CONTENT_OWNER = 'YourLovelyFox'
export const CONTENT_REPO = 'eg-launcher-content'
export const CONTENT_BRANCH = 'master'

export const PUBLIC_OWNER = 'YourLovelyFox'
export const PUBLIC_REPO = 'eg-launcher'
export const PUBLIC_BRANCH = 'master'

export const FEED_LAUNCHER_PRIVATE = 'feeds/launcher.json'
export const FEED_PARTNERS_PRIVATE = 'feeds/partners.json'
export const AUTH_PARTNERS_PRIVATE = 'auth/partners.json'
export const CONFIG_PARTNERS_PRIVATE = 'config/partners.json'

export const FEED_LAUNCHER_PUBLIC = 'news/feed.json'
export const FEED_PARTNERS_PUBLIC = 'news/partners.json'
export const AUTH_PARTNERS_PUBLIC = 'news/partner-auth.json'
export const CONFIG_PARTNERS_PUBLIC = 'news/partners-config.json'

export type FeedKind = 'launcher' | 'partners'

export function privateFeedPath(kind: FeedKind): string {
  return kind === 'launcher' ? FEED_LAUNCHER_PRIVATE : FEED_PARTNERS_PRIVATE
}

export function publicFeedPath(kind: FeedKind): string {
  return kind === 'launcher' ? FEED_LAUNCHER_PUBLIC : FEED_PARTNERS_PUBLIC
}

export function githubContentsApiUrl(owner: string, repo: string, filePath: string, branch: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`
}

export function rawGithubUrl(owner: string, repo: string, filePath: string, branch: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
}
