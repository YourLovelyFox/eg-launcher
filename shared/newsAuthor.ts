/** Canonical founder of EG Launcher (staff username Bee). */
export const LAUNCHER_FOUNDER_USERNAME = 'Bee'

export type NewsAuthorInfo = {
  authorUsername: string
  /** Display string, e.g. "Bee · Founder" or "Alice" */
  authorLabel: string
  isFounder: boolean
}

/**
 * Resolve news post author for launcher UI + CMS payloads.
 * Empty / missing author defaults to founder Bee.
 */
export function formatNewsAuthor(username?: string | null): NewsAuthorInfo {
  const raw = (username || '').trim()
  const authorUsername = raw || LAUNCHER_FOUNDER_USERNAME
  const isFounder = authorUsername.toLowerCase() === LAUNCHER_FOUNDER_USERNAME.toLowerCase()
  return {
    authorUsername,
    authorLabel: isFounder ? `${LAUNCHER_FOUNDER_USERNAME} · Founder` : authorUsername,
    isFounder,
  }
}
