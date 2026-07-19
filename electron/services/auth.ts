import https from 'https'
import http from 'http'
import type { DeviceCodeResponse, MinecraftAccount } from '../../shared/types'
import { getAccountsPath, readJsonFile, writeJsonFile } from '../paths'

/**
 * Microsoft identity platform (consumers) device-code flow.
 * Uses a public native client ID commonly used by open-source Minecraft launchers
 * with the XboxLive.signin scope (same chain as Prism / multiMC-style auth).
 */
const CLIENT_ID = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb'
const TENANT = 'consumers'
const DEVICE_CODE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
const SCOPES = 'XboxLive.signin offline_access openid profile'
const USER_AGENT = 'EGLauncher/1.0.0'

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
  } = {},
): Promise<HttpResult> {
  const maxRedirects = options.maxRedirects ?? 5

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

          // Follow redirects (including POST → GET on 303, keep method for 307/308 when possible)
          if (status >= 300 && status < 400 && res.headers.location && maxRedirects > 0) {
            const nextUrl = new URL(res.headers.location, url).toString()
            const nextMethod = status === 303 ? 'GET' : method
            request(nextMethod, nextUrl, {
              headers: options.headers,
              body: nextMethod === 'GET' ? undefined : options.body,
              maxRedirects: maxRedirects - 1,
            })
              .then(resolve)
              .catch(reject)
            return
          }

          resolve({ status, body, headers: res.headers })
        })
      },
    )

    req.setTimeout(30_000, () => {
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
    // Empty body is common while waiting / on some edge responses — treat as pending for token polls
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
): Promise<T> {
  const body = new URLSearchParams(fields).toString()
  const result = await request('POST', url, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  })
  return parseJsonBody<T>(result, context)
}

async function postJson<T extends object>(
  url: string,
  payload: unknown,
  context: string,
  headers: Record<string, string> = {},
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
  })
  return parseJsonBody<T>(result, context)
}

async function getJson<T extends object>(
  url: string,
  context: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const result = await request('GET', url, {
    headers: {
      Accept: 'application/json',
      ...headers,
    },
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

export async function startDeviceCodeLogin(): Promise<DeviceCodeResponse> {
  const data = await postForm<DeviceCodeRaw>(
    DEVICE_CODE_URL,
    {
      client_id: CLIENT_ID,
      scope: SCOPES,
    },
    'device-code',
  )

  if (data.error) {
    throw new Error(data.error_description || data.error || 'Failed to start Microsoft login')
  }

  if (!data.device_code || !data.user_code) {
    throw new Error('Microsoft did not return a device code. Try again.')
  }

  return {
    userCode: data.user_code,
    deviceCode: data.device_code,
    verificationUri: data.verification_uri || 'https://microsoft.com/link',
    expiresIn: data.expires_in ?? 900,
    interval: Math.max(data.interval || 5, 3),
    message: data.message || 'Enter the code in your browser to continue.',
  }
}

async function xboxLiveAuth(msAccessToken: string) {
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
    throw new Error(data.Message || 'Xbox Live authentication failed')
  }

  return {
    token: data.Token,
    userHash: data.DisplayClaims.xui[0].uhs,
  }
}

async function xstsAuth(xboxToken: string) {
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
      throw new Error('This Microsoft account has no Xbox profile. Create one at xbox.com first.')
    }
    if (data.XErr === 2148916238) {
      throw new Error('This account is underage or from a banned region for Xbox Live.')
    }
    throw new Error(data.Message || `Xbox XSTS authorization failed${data.XErr ? ` (${data.XErr})` : ''}`)
  }

  return {
    token: data.Token,
    userHash: data.DisplayClaims!.xui[0].uhs,
  }
}

async function minecraftLogin(userHash: string, xstsToken: string) {
  const data = await postJson<{ access_token?: string; expires_in?: number }>(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    {
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
      ensureLegacyEnabled: true,
    },
    'minecraft-login',
  )

  if (!data.access_token) throw new Error('Minecraft services login failed')
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
        'No Minecraft profile found. Make sure you own Java Edition and set a username at minecraft.net.',
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
  const xbox = await xboxLiveAuth(msAccessToken)
  const xsts = await xstsAuth(xbox.token)
  const mc = await minecraftLogin(xsts.userHash, xsts.token)

  const ownsGame = await checkGameOwnership(mc.access_token)
  if (!ownsGame) {
    throw new Error('This Microsoft account does not own Minecraft: Java Edition.')
  }

  const profile = await getMinecraftProfile(mc.access_token)

  return {
    id: profile.uuid,
    username: profile.username,
    uuid: profile.uuid,
    accessToken: mc.access_token,
    refreshToken,
    expiresAt: Date.now() + (expiresIn ? expiresIn * 1000 : mc.expires_in * 1000),
    skinUrl: profile.skinUrl,
  }
}

export async function pollDeviceCodeLogin(deviceCode: string): Promise<
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'completed'; account: MinecraftAccount }
  | { status: 'expired' }
  | { status: 'declined' }
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
    )
  } catch (err) {
    // Network blips / empty bodies during poll should not kill the whole login
    const message = (err as Error).message || ''
    if (
      message.includes('empty response') ||
      message.includes('timed out') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('ENOTFOUND') ||
      message.includes('socket')
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
    // invalid_grant can mean expired or already used
    if ((data.error_description || '').toLowerCase().includes('expired')) {
      return { status: 'expired' }
    }
    throw new Error(data.error_description || 'Login code is invalid. Start sign-in again.')
  }

  if (!data.access_token) {
    if (error) {
      throw new Error(data.error_description || data.error || 'Microsoft login failed')
    }
    // No token and no error — keep waiting
    return { status: 'pending' }
  }

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
}
