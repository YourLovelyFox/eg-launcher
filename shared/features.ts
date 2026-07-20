/**
 * Feature flags that differ between Dev Launcher and public Live builds.
 *
 * - Dev (`npm run dev` or `npm run dist:admin`): Admin panel ON
 * - Live (`npm run dist` / CI release): Admin panel OFF — no routes, no IPC, no token
 */

// Injected by Vite `define` for renderer, preload, and electron main
declare const __EG_ENABLE_ADMIN__: boolean

/** True only in the private Dev Launcher build. */
export function isAdminBuild(): boolean {
  try {
    if (typeof __EG_ENABLE_ADMIN__ === 'boolean') return __EG_ENABLE_ADMIN__
  } catch {
    /* not defined in some tooling contexts */
  }
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.EG_ENABLE_ADMIN === '1' || process.env.EG_ENABLE_ADMIN === 'true') return true
    if (process.env.EG_ENABLE_ADMIN === '0' || process.env.EG_ENABLE_ADMIN === 'false') return false
  }
  return false
}
