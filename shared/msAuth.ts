/**
 * Microsoft identity (public native client) used for Minecraft: Java Edition login.
 *
 * Device-code → MSA → Xbox Live → XSTS → Minecraft services.
 * Scope: XboxLive.signin offline_access openid profile
 *
 * Default client ID is the well-known public native client used by open-source
 * Minecraft launchers (historically registered as "Prism Launcher" in Azure).
 * That name appears on Microsoft’s consent screen — it is NOT the Store listing
 * name. To show “EG Launcher” on the consent screen, register your own Entra
 * public client named “EG Launcher”, request XboxLive.signin, then set:
 *
 *   EG_MS_CLIENT_ID=<your-application-client-id>
 *
 * at build time (vite define / env) or runtime in the Electron main process.
 *
 * @see docs/MS-STORE.md — Azure app registration + certification notes
 */

/** Public native client commonly used by FOSS Minecraft launchers (XboxLive.signin). */
export const DEFAULT_MS_CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb'

export const MS_TENANT = 'consumers'
export const MS_SCOPES = 'XboxLive.signin offline_access openid profile'

/**
 * Resolve the OAuth application (client) ID.
 * Prefer env override so EG can ship with its own Azure app without code changes.
 */
export function resolveMsClientId(): string {
  const fromEnv =
    (typeof process !== 'undefined' &&
      process.env &&
      (process.env.EG_MS_CLIENT_ID || process.env.MS_CLIENT_ID)) ||
    ''
  const id = String(fromEnv).trim()
  if (id && /^[0-9a-fA-F-]{36}$/.test(id)) return id
  return DEFAULT_MS_CLIENT_ID
}

export function isDefaultSharedMsClient(clientId: string = resolveMsClientId()): boolean {
  return clientId.toLowerCase() === DEFAULT_MS_CLIENT_ID.toLowerCase()
}
