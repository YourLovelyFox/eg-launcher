import https from 'https'
import http from 'http'
import type { DeviceCodeResponse, MinecraftAccount } from '../../shared/types'
import {
  MS_SCOPES,
  MS_TENANT,
  isDefaultSharedMsClient,
  resolveMsClientId,
} from '../../shared/msAuth'
import { getAccountsPath, readJsonFile, writeJsonFile } from '../paths'

/**
 * Microsoft identity platform (consumers) device-code flow → Xbox → Minecraft.
 * Client ID: shared/msAuth.ts (override with EG_MS_CLIENT_ID for “EG Launcher” consent).
 */
const CLIENT_ID = resolveMsClientId()
const TENANT = MS_TENANT
const DEVICE_CODE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
const SCOPES = MS_SCOPES
const USER_AGENT = 'EGLauncher/2.7.2'

/** Optional UI progress during Xbox / Minecraft completion (main process → renderer). */
let progressSink: ((message: string) => void) | null = null

export function setAuthProgressSink(fn: ((message: string) => void) | null): void {
  progressSink = fn
}

function emitAuthProgress(message: string): void {
  try {
    progressSink?.(message)
  } catch {
    /* ignore */
  }
}

type TokenStore = {
  accounts: MinecraftAccount[]
  activeAccountId: string | null
}

type DeviceCodeRaw = {
  user_code: string
  device_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
  message: string
  error?: string
  error_description?: string
}

type PollTokenRaw = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  error?: string
  error_description?: string
  correlation_id?: string
}

type HttpResult = {
  status: number
  body: string
  headers: http.IncomingHttpHeaders
}

function request(
  method: string,
  url: string,
  options: {
    headers?: Record<string, string>
    body?: string
    maxRedirects?: number
    timeoutMs?: number
  } = {},
): Promise<HttpResult> {
  const maxRedirects = options.maxRedirects ?? 5
  const timeoutMs = options.timeoutMs ?? 45_000

  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0

          if (status >= 300 && status < 400 && res.headers.location && maxRedirects > 0) {
            const nextUrl = new URL(res.headers.location, url).toString()
            const nextMethod = status === 303 ? 'GET' : method
            request(nextMethod, nextUrl, {
              headers: options.headers,
              body: nextMethod === 'GET' ? undefined : options.body,
              maxRedirects: maxRedirects - 1,
              timeoutMs,
            })
              .then(resolve)
              .catch(reject)
            return
          }

          resolve({ status, body, headers: res.headers })
        })
      },
    )

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out: ${url}`))
    })
    req.on('error', reject)

    if (options.body) req.write(options.body)
    req.end()
  })
}

function parseJsonBody<T extends object>(result: HttpResult, context: string): T {
  const trimmed = result.body?.trim() ?? ''

  if (!trimmed) {
    if (context === 'token-poll') {
      return { error: 'authorization_pending' } as T
    }
    throw new Error(
      `${context}: empty response from Microsoft (HTTP ${result.status}). Try signing in again.`,
    )
  }

  try {
    return JSON.parse(trimmed) as T
  } catch {
    const snippet = trimmed.slice(0, 180).replace(/\s+/g, ' ')
    throw new Error(
      `${context}: invalid JSON from Microsoft (HTTP ${result.status}): ${snippet}`,
    )
  }
}

async function postForm<T extends object>(
  url: string,
  fields: Record<string, string>,
  context: string,
  timeoutMs?: number,
): Promise<T> {
  const body = new URLSearchParams(fields).toString()
  const result = await request('POST', url, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
    timeoutMs,
  })
  return parseJsonBody<T>(result, context)
}

async function postJson<T extends object>(
  url: string,
  payload: unknown,
  context: string,
  headers: Record<string, string> = {},
  timeoutMs = 60_000,
): Promise<T> {
  const body = JSON.stringify(payload)
  const result = await request('POST', url, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      ...headers,
    },
    body,
    timeoutMs,
  })
  return parseJsonBody<T>(result, context)
}

async function getJson<T extends object>(
  url: string,
  context: string,
  headers: Record<string, string> = {},
  timeoutMs = 45_000,
): Promise<T> {
  const result = await request('GET', url, {
    headers: {
      Accept: 'application/json',
      ...headers,
    },
    timeoutMs,
  })
  return parseJsonBody<T>(result, context)
}

function loadStore(): TokenStore {
  return readJsonFile<TokenStore>(getAccountsPath(), { accounts: [], activeAccountId: null })
}

function saveStore(store: TokenStore): void {
  writeJsonFile(getAccountsPath(), store)
}

export function getAccounts(): { accounts: MinecraftAccount[]; activeAccountId: string | null } {
  const store = loadStore()
  return {
    accounts: store.accounts.map((a) => ({
      ...a,
      type: a.type || (a.id.startsWith('offline-') ? 'offline' : 'microsoft'),
      refreshToken: undefined,
      accessToken: a.accessToken ? '***' : '',
    })),
    activeAccountId: store.activeAccountId,
  }
}

export function getActiveAccountSecret(): MinecraftAccount | null {
  const store = loadStore()
  if (!store.activeAccountId) return null
  return store.accounts.find((a) => a.id === store.activeAccountId) ?? null
}

export function setActiveAccount(accountId: string | null): void {
  const store = loadStore()
  store.activeAccountId = accountId
  saveStore(store)
}

export function removeAccount(accountId: string): void {
  const store = loadStore()
  store.accounts = store.accounts.filter((a) => a.id !== accountId)
  if (store.activeAccountId === accountId) {
    store.activeAccountId = store.accounts[0]?.id ?? null
  }
  saveStore(store)
}

/** Insert or replace an account (used by Microsoft login + offline accounts). */
export function upsertAccount(account: MinecraftAccount): void {
  const store = loadStore()
  const existing = store.accounts.findIndex((a) => a.id === account.id)
  if (existing >= 0) store.accounts[existing] = account
  else store.accounts.push(account)
  saveStore(store)
}

export function getMsAuthPublicInfo(): {
  clientId: string
  sharedClient: boolean
  consentAppHint: string
} {
  const clientId = CLIENT_ID
  const shared = isDefaultSharedMsClient(clientId)
  return {
    clientId,
    sharedClient: shared,
    consentAppHint: shared
      ? 'Microsoft’s consent screen may show a shared launcher name (e.g. “Prism Launcher”). That is the OAuth app name, not EG Launcher’s Store listing. Approve it to finish Minecraft login, or register EG’s own Azure client (docs/MS-STORE.md).'
      : 'Microsoft’s consent screen should show EG Launcher (or your Azure app display name).',
  }
}

export async function startDeviceCodeLogin(): Promise<DeviceCodeResponse> {
  emitAuthProgress('Requesting a Microsoft device code…')
  const data = await postForm<DeviceCodeRaw>(
    DEVICE_CODE_URL,
    {
      client_id: CLIENT_ID,
      scope: SCOPES,
    },
    'device-code',
    45_000,
  )

  if (data.error) {
    throw new Error(data.error_description || data.error || 'Failed to start Microsoft login')
  }

  if (!data.device_code || !data.user_code) {
    throw new Error('Microsoft did not return a device code. Try again.')
  }

  const verificationUri = data.verification_uri || 'https://microsoft.com/link'
  const verificationUriComplete =
    data.verification_uri_complete ||
    // Fallback: some tenants only return base URI + user_code
    (data.user_code ? `${verificationUri}${verificationUri.includes('?') ? '&' : '?'}otc=${encodeURIComponent(data.user_code)}` : undefined)

  return {
    userCode: data.user_code,
    deviceCode: data.device_code,
    verificationUri,
    verificationUriComplete,
    expiresIn: data.expires_in ?? 900,
    interval: Math.max(data.interval || 5, 3),
    message:
      data.message ||
      'Open the link, enter the code, and approve access. Stay on this page until EG Launcher shows your Minecraft username.',
  }
}

async function xboxLiveAuth(msAccessToken: string) {
  emitAuthProgress('Connecting to Xbox Live…')
  const rpsTicket = msAccessToken.startsWith('d=') ? msAccessToken : `d=${msAccessToken}`
  const data = await postJson<{
    Token?: string
    DisplayClaims?: { xui: Array<{ uhs: string }> }
    XErr?: number
    Message?: string
  }>(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: rpsTicket,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
    'xbox-auth',
  )

  if (!data.Token || !data.DisplayClaims?.xui?.[0]?.uhs) {
    throw new Error(
      data.Message ||
        'Xbox Live authentication failed. Make sure this Microsoft account can use Xbox, then try Sign in again.',
    )
  }

  return {
    token: data.Token,
    userHash: data.DisplayClaims.xui[0].uhs,
  }
}

async function xstsAuth(xboxToken: string) {
  emitAuthProgress('Authorizing Minecraft with Xbox…')
  const data = await postJson<{
    Token?: string
    DisplayClaims?: { xui: Array<{ uhs: string }> }
    XErr?: number
    Message?: string
  }>(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    {
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xboxToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    },
    'xsts-auth',
  )

  if (!data.Token) {
    if (data.XErr === 2148916233) {
      throw new Error(
        'XBOX_PROFILE_REQUIRED: This Microsoft account needs an Xbox profile before it can play Minecraft: Java Edition. Open https://xbox.com , sign in with the same account, finish creating a gamertag/profile, then try Sign in again in EG Launcher.',
      )
    }
    if (data.XErr === 2148916238) {
      throw new Error(
        'This Microsoft account cannot use Xbox Live (age restriction or region). Use a different account or complete parental setup at xbox.com, then try again.',
      )
    }
    throw new Error(
      data.Message ||
        `Xbox XSTS authorization failed${data.XErr ? ` (${data.XErr})` : ''}. Try again or use another Microsoft account.`,
    )
  }

  return {
    token: data.Token,
    userHash: data.DisplayClaims!.xui[0].uhs,
  }
}

async function minecraftLogin(userHash: string, xstsToken: string) {
  emitAuthProgress('Signing in to Minecraft services…')
  const data = await postJson<{ access_token?: string; expires_in?: number }>(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    {
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
      ensureLegacyEnabled: true,
    },
    'minecraft-login',
  )

  if (!data.access_token) throw new Error('Minecraft services login failed. Try signing in again.')
  return { access_token: data.access_token, expires_in: data.expires_in ?? 86400 }
}

async function checkGameOwnership(mcAccessToken: string): Promise<boolean> {
  try {
    const data = await getJson<{ items?: Array<{ name: string }> }>(
      'https://api.minecraftservices.com/entitlements/mcstore',
      'entitlements',
      { Authorization: `Bearer ${mcAccessToken}` },
    )
    const items = data.items ?? []
    if (items.length === 0) return true
    return items.some(
      (i) =>
        i.name === 'product_minecraft' ||
        i.name === 'game_minecraft' ||
        i.name?.includes('minecraft'),
    )
  } catch {
    // Entitlements endpoint is flaky; don't block login if profile works
    return true
  }
}

async function getMinecraftProfile(mcAccessToken: string) {
  emitAuthProgress('Loading Minecraft profile…')
  const data = await getJson<{
    id?: string
    name?: string
    skins?: Array<{ url: string; state: string }>
    error?: string
    errorMessage?: string
  }>('https://api.minecraftservices.com/minecraft/profile', 'minecraft-profile', {
    Authorization: `Bearer ${mcAccessToken}`,
  })

  if (!data?.id || !data?.name) {
    throw new Error(
      data.errorMessage ||
        data.error ||
        'No Minecraft profile found. Own Minecraft: Java Edition and set a username at https://www.minecraft.net/msaprofile/mygames/editprofile then try again.',
    )
  }

  return {
    uuid: data.id,
    username: data.name,
    skinUrl: data.skins?.find((s) => s.state === 'ACTIVE')?.url,
  }
}

async function completeAuthChain(
  msAccessToken: string,
  refreshToken?: string,
  expiresIn?: number,
): Promise<MinecraftAccount> {
  emitAuthProgress('Finishing Microsoft login (Xbox → Minecraft)… Keep EG Launcher open.')
  const xbox = await xboxLiveAuth(msAccessToken)
  const xsts = await xstsAuth(xbox.token)
  const mc = await minecraftLogin(xsts.userHash, xsts.token)

  const ownsGame = await checkGameOwnership(mc.access_token)
  if (!ownsGame) {
    throw new Error('This Microsoft account does not own Minecraft: Java Edition.')
  }

  const profile = await getMinecraftProfile(mc.access_token)
  emitAuthProgress(`Signed in as ${profile.username}`)

  // Use the shorter of MS access token / Minecraft token so we refresh before either dies
  const msMs = expiresIn && expiresIn > 0 ? expiresIn * 1000 : 60 * 60 * 1000
  const mcMs = (mc.expires_in > 0 ? mc.expires_in : 86_400) * 1000
  const expiresAt = Date.now() + Math.min(msMs, mcMs)

  return {
    id: profile.uuid,
    username: profile.username,
    uuid: profile.uuid,
    accessToken: mc.access_token,
    refreshToken,
    expiresAt,
    skinUrl: profile.skinUrl,
    type: 'microsoft',
  }
}

/** Refresh Microsoft token and re-run Minecraft chain when session is stale. */
export async function refreshMicrosoftAccount(
  accountId: string,
): Promise<{ ok: true; account: MinecraftAccount } | { ok: false; error: string }> {
  const store = loadStore()
  const existing = store.accounts.find((a) => a.id === accountId)
  if (!existing) return { ok: false, error: 'Account not found' }
  if (existing.type === 'offline' || existing.id.startsWith('offline-')) {
    return { ok: true, account: existing }
  }
  if (!existing.refreshToken) {
    return {
      ok: false,
      error: 'Session expired. Sign in with Microsoft again under Accounts.',
    }
  }

  try {
    emitAuthProgress('Refreshing Microsoft session…')
    const data = await postForm<PollTokenRaw>(
      TOKEN_URL,
      {
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: existing.refreshToken,
        scope: SCOPES,
      },
      'token-refresh',
      45_000,
    )

    if (data.error || !data.access_token) {
      return {
        ok: false,
        error:
          data.error_description ||
          data.error ||
          'Could not refresh Microsoft session. Sign in again.',
      }
    }

    const account = await completeAuthChain(
      data.access_token,
      data.refresh_token || existing.refreshToken,
      data.expires_in,
    )
    // Keep same account id if profile uuid matches
    const idx = store.accounts.findIndex((a) => a.id === accountId || a.id === account.id)
    if (idx >= 0) store.accounts[idx] = account
    else store.accounts.push(account)
    if (store.activeAccountId === accountId) store.activeAccountId = account.id
    saveStore(store)
    return { ok: true, account }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Refresh failed' }
  }
}

/**
 * Return a launch-ready secret account. Refreshes Microsoft session if expired
 * or within 5 minutes of expiry.
 */
export async function ensureFreshActiveAccount(): Promise<MinecraftAccount | null> {
  const store = loadStore()
  if (!store.activeAccountId) return null
  let account = store.accounts.find((a) => a.id === store.activeAccountId) ?? null
  if (!account) return null

  if (account.type === 'offline' || account.id.startsWith('offline-')) {
    return account
  }

  const skewMs = 5 * 60 * 1000
  const expired = !account.expiresAt || account.expiresAt <= Date.now() + skewMs
  if (!expired && account.accessToken && account.accessToken !== '***') {
    return account
  }

  if (!account.refreshToken) {
    return account // may still work; launch will fail with clear message if not
  }

  const refreshed = await refreshMicrosoftAccount(account.id)
  if (refreshed.ok) return refreshed.account
  return getActiveAccountSecret()
}

export async function pollDeviceCodeLogin(deviceCode: string): Promise<
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'completed'; account: MinecraftAccount }
  | { status: 'expired' }
  | { status: 'declined' }
  | { status: 'failed'; message: string; code?: string }
> {
  if (!deviceCode) {
    throw new Error('Missing device code')
  }

  let data: PollTokenRaw
  try {
    data = await postForm<PollTokenRaw>(
      TOKEN_URL,
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: CLIENT_ID,
        device_code: deviceCode,
      },
      'token-poll',
      30_000,
    )
  } catch (err) {
    const message = (err as Error).message || ''
    if (
      message.includes('empty response') ||
      message.includes('timed out') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ENOTFOUND') ||
      message.includes('socket') ||
      message.includes('ECONNREFUSED') ||
      message.includes('EAI_AGAIN')
    ) {
      return { status: 'pending' }
    }
    throw err
  }

  const error = (data.error || '').toLowerCase()

  if (error === 'authorization_pending') return { status: 'pending' }
  if (error === 'slow_down') return { status: 'slow_down' }
  if (error === 'expired_token' || error === 'code_expired') return { status: 'expired' }
  if (error === 'access_denied' || error === 'authorization_declined') return { status: 'declined' }
  if (error === 'bad_verification_code' || error === 'invalid_grant') {
    if ((data.error_description || '').toLowerCase().includes('expired')) {
      return { status: 'expired' }
    }
    return {
      status: 'failed',
      message: data.error_description || 'Login code is invalid. Click Sign in to start again.',
      code: 'INVALID_CODE',
    }
  }

  if (!data.access_token) {
    if (error) {
      return {
        status: 'failed',
        message: data.error_description || data.error || 'Microsoft login failed',
        code: 'MS_TOKEN_ERROR',
      }
    }
    return { status: 'pending' }
  }

  try {
    const account = await completeAuthChain(data.access_token, data.refresh_token, data.expires_in)
    const store = loadStore()
    const existing = store.accounts.findIndex((a) => a.id === account.id)
    if (existing >= 0) store.accounts[existing] = account
    else store.accounts.push(account)
    store.activeAccountId = account.id
    saveStore(store)

    return {
      status: 'completed',
      account: { ...account, accessToken: '***', refreshToken: undefined },
    }
  } catch (err) {
    const raw = (err as Error).message || 'Microsoft login failed'
    const message = raw.replace(/^XBOX_PROFILE_REQUIRED:\s*/i, '').trim()
    emitAuthProgress('')
    return {
      status: 'failed',
      message,
      code: raw.startsWith('XBOX_PROFILE_REQUIRED') ? 'XBOX_PROFILE_REQUIRED' : 'AUTH_FAILED',
    }
  }
}
