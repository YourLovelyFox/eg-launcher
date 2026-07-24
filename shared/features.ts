/**
 * Feature flags.
 *
 * Staff Menu is available in all builds (Live + Dev) and is gated by CMS
 * staff accounts (Settings → Staff), not by a local unlock file.
 */

// Injected by Vite `define` (kept for compatibility; no longer gates Staff Menu)
declare const __EG_ENABLE_ADMIN__: boolean

/**
 * Historically “Dev-only admin”. Now always true so Live clients can open
 * Settings → Staff and sign in with CMS staff/admin accounts.
 */
export function isAdminBuild(): boolean {
  return true
}
