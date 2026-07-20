import crypto from 'crypto'
import path from 'path'
import { PARTNER_LIST } from '../../shared/branding'
import {
  AUTH_PARTNERS_PRIVATE,
  AUTH_PARTNERS_PUBLIC,
  CONFIG_PARTNERS_PRIVATE,
  CONFIG_PARTNERS_PUBLIC,
  CONTENT_BRANCH,
  CONTENT_OWNER,
  CONTENT_REPO,
  FEED_PARTNERS_PRIVATE,
  FEED_PARTNERS_PUBLIC,
  PUBLIC_BRANCH,
  PUBLIC_OWNER,
  PUBLIC_REPO,
} from '../../shared/contentRepo'
import type { LoaderType, PartnerConfig } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import { loadDevGithubToken } from './devToken'
import {
  getRepoFileText,
  privateRepo,
  publicRepo,
  putRepoFilesSequential,
} from './githubContent'
import { hashPartnerPassword } from './partnerAuth'
import { applyLocalFeedSnapshot } from './news'

type ConfigFile = { version: number; partners: PartnerConfig[] }
type AuthFile = {
  version: number
  partners: Array<{
    id: string
    username: string
    passwordHash: string
    newsTag: string
    displayName: string
  }>
}

function cachePath(): string {
  return path.join(getDataRoot(), 'partners-config-cache.json')
}

function stripBom(t: string): string {
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t.replace(/^\uFEFF/, '')
}

function builtinPartners(): PartnerConfig[] {
  return PARTNER_LIST.map((p) => ({
    id: p.id,
    title: p.title,
    menuLabel: p.menuLabel,
    description: p.description,
    gameVersion: p.gameVersion,
    loader: p.loader as LoaderType,
    serverAddress: p.serverAddress,
    serverName: p.serverName,
    instanceName: p.instanceName,
    newsTag: p.newsTag,
    newsUsername: p.newsUsername || p.newsTag,
    defaultMods: [...p.defaultMods],
    modrinthPackSlug: p.modrinthPackSlug ?? null,
    iconUrl: p.iconUrl ?? null,
    enabled: true,
  }))
}

function parseConfig(text: string): PartnerConfig[] {
  const data = JSON.parse(stripBom(text)) as ConfigFile
  return (data.partners || []).filter((p) => p && p.id && p.title)
}

/** Public list for sidebar / partner pages (Live + Dev). */
export async function fetchPartnerConfigs(force = false): Promise<PartnerConfig[]> {
  const cached = readJsonFile<{ fetchedAt: string; partners: PartnerConfig[] } | null>(
    cachePath(),
    null,
  )
  if (!force && cached?.partners?.length) {
    const age = Date.now() - Date.parse(cached.fetchedAt)
    if (Number.isFinite(age) && age >= 0 && age < 15_000) {
      return cached.partners.filter((p) => p.enabled !== false)
    }
  }

  try {
    const res = await getRepoFileText({
      owner: PUBLIC_OWNER,
      repo: PUBLIC_REPO,
      branch: PUBLIC_BRANCH,
      path: CONFIG_PARTNERS_PUBLIC,
    })
    if (res.ok) {
      const partners = parseConfig(res.text)
      writeJsonFile(cachePath(), { fetchedAt: new Date().toISOString(), partners })
      return partners.filter((p) => p.enabled !== false)
    }
  } catch {
    /* fall through */
  }

  // Dev: private config with token
  const token = loadDevGithubToken()
  if (token) {
    try {
      const priv = await getRepoFileText({
        token,
        owner: CONTENT_OWNER,
        repo: CONTENT_REPO,
        branch: CONTENT_BRANCH,
        path: CONFIG_PARTNERS_PRIVATE,
      })
      if (priv.ok) {
        const partners = parseConfig(priv.text)
        writeJsonFile(cachePath(), { fetchedAt: new Date().toISOString(), partners })
        return partners.filter((p) => p.enabled !== false)
      }
    } catch {
      /* fall through */
    }
  }

  if (cached?.partners?.length) return cached.partners.filter((p) => p.enabled !== false)
  return builtinPartners()
}

export async function getPartnerConfigById(id: string): Promise<PartnerConfig | null> {
  const list = await fetchPartnerConfigs(false)
  return list.find((p) => p.id === id) ?? null
}

export function newsTagFromName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '') || 'Partner'
}

function slugifyPartnerId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `partner-${Date.now().toString(36)}`
  )
}

export type PartnerUpsertInput = {
  id?: string
  title: string
  menuLabel?: string
  description?: string
  gameVersion: string
  loader: LoaderType
  serverAddress: string
  serverName?: string
  instanceName?: string
  newsTag?: string
  newsUsername: string
  /** Plain password — required on create; optional on edit (leave empty to keep) */
  newsPassword?: string
  defaultMods?: string[]
  modrinthPackSlug?: string | null
  iconUrl?: string | null
  enabled?: boolean
}

function buildConfigFile(partners: PartnerConfig[]): string {
  return JSON.stringify({ version: 1, partners }, null, 2) + '\n'
}

/**
 * Build partner-auth JSON. Never invents passwords.
 * Hash includes username — changing username without a new password is rejected.
 */
function buildAuthFile(
  partners: PartnerConfig[],
  passwordById: Record<string, string>,
  existingAuth: AuthFile | null,
): { ok: true; json: string } | { ok: false; error: string } {
  const authPartners: AuthFile['partners'] = []
  for (const p of partners) {
    const prev = existingAuth?.partners?.find((a) => a.id === p.id)
    const plain = passwordById[p.id]?.trim()
    let passwordHash = ''
    let username = p.newsUsername

    if (plain) {
      passwordHash = hashPartnerPassword(p.newsUsername, plain)
    } else if (prev?.passwordHash) {
      if (prev.username !== p.newsUsername) {
        return {
          ok: false,
          error: `News username changed for "${p.title}" — enter a news password so login can be updated.`,
        }
      }
      passwordHash = prev.passwordHash.trim()
      username = prev.username
    } else {
      return {
        ok: false,
        error: `Missing news password for partner "${p.title}" (id ${p.id}).`,
      }
    }

    authPartners.push({
      id: p.id,
      username,
      passwordHash,
      newsTag: p.newsTag,
      displayName: p.title,
    })
  }
  return {
    ok: true,
    json: JSON.stringify({ version: 1, partners: authPartners }, null, 2) + '\n',
  }
}

async function loadExistingAuth(token: string): Promise<AuthFile | null> {
  // Prefer private CMS; fall back to public mirror
  for (const src of [
    {
      token,
      owner: CONTENT_OWNER,
      repo: CONTENT_REPO,
      branch: CONTENT_BRANCH,
      path: AUTH_PARTNERS_PRIVATE,
    },
    {
      token,
      owner: PUBLIC_OWNER,
      repo: PUBLIC_REPO,
      branch: PUBLIC_BRANCH,
      path: AUTH_PARTNERS_PUBLIC,
    },
  ] as const) {
    const res = await getRepoFileText(src)
    if (!res.ok) continue
    try {
      return JSON.parse(stripBomSafe(res.text)) as AuthFile
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * Create or update a partner: config + auth dual-write (private CMS + public mirrors).
 */
export async function upsertPartnerConfig(
  sessionToken: string,
  input: PartnerUpsertInput,
  requireAdmin: (t: string) => boolean,
): Promise<{ ok: true; partner: PartnerConfig } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  const token = loadDevGithubToken()
  if (!token) return { ok: false, error: 'GitHub write token missing on this PC' }

  const title = input.title.trim()
  if (!title) return { ok: false, error: 'Partner name is required' }
  const newsUsername = input.newsUsername.trim()
  if (!newsUsername) return { ok: false, error: 'News username is required' }
  if (!input.serverAddress.trim()) return { ok: false, error: 'Server IP / address is required' }
  if (!input.gameVersion.trim()) return { ok: false, error: 'Minecraft version is required' }

  const id = (input.id || slugifyPartnerId(title)).trim()
  const isCreate = !input.id
  if (isCreate && !input.newsPassword?.trim()) {
    return { ok: false, error: 'News password is required when creating a partner' }
  }

  const list = await fetchPartnerConfigs(true)
  const existing = list.find((p) => p.id === id)
  if (isCreate && existing) return { ok: false, error: `Partner id already exists: ${id}` }

  const partner: PartnerConfig = {
    id,
    title,
    menuLabel: (input.menuLabel || title).trim(),
    description: (input.description || `${title} partner server.`).trim(),
    gameVersion: input.gameVersion.trim(),
    loader: input.loader,
    serverAddress: input.serverAddress.trim(),
    serverName: (input.serverName || title).trim(),
    instanceName: (input.instanceName || title).trim(),
    newsTag: (input.newsTag || newsTagFromName(title)).trim(),
    newsUsername,
    defaultMods: (input.defaultMods || []).map((m) => m.trim()).filter(Boolean),
    modrinthPackSlug: input.modrinthPackSlug?.trim() || null,
    iconUrl: input.iconUrl?.trim() || null,
    enabled: input.enabled !== false,
  }

  if (partner.loader !== 'vanilla' && !partner.modrinthPackSlug && partner.defaultMods.length === 0) {
    return {
      ok: false,
      error: 'Mod loader selected: set a Modrinth pack project or at least one mod slug for auto-install.',
    }
  }

  const nextList = existing
    ? list.map((p) => (p.id === id ? partner : p))
    : [...list, partner]

  const existingAuth = await loadExistingAuth(token)

  const passwordById: Record<string, string> = {}
  if (input.newsPassword?.trim()) passwordById[id] = input.newsPassword.trim()

  const configJson = buildConfigFile(nextList)
  const authBuilt = buildAuthFile(nextList, passwordById, existingAuth)
  if (!authBuilt.ok) return { ok: false, error: authBuilt.error }

  const msg = `chore(partners): ${isCreate ? 'create' : 'update'} ${id} via EG Admin`

  // Sequential: parallel Contents API puts on the same branch 409-conflict
  const written = await putRepoFilesSequential([
    { token, ...privateRepo, path: CONFIG_PARTNERS_PRIVATE, content: configJson, message: msg },
    { token, ...privateRepo, path: AUTH_PARTNERS_PRIVATE, content: authBuilt.json, message: msg },
    { token, ...publicRepo, path: CONFIG_PARTNERS_PUBLIC, content: configJson, message: msg },
    { token, ...publicRepo, path: AUTH_PARTNERS_PUBLIC, content: authBuilt.json, message: msg },
  ])
  if (!written.ok) return { ok: false, error: written.error }

  writeJsonFile(cachePath(), {
    fetchedAt: new Date().toISOString(),
    partners: nextList,
  })

  return { ok: true, partner }
}

function stripBomSafe(t: string): string {
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t.replace(/^\uFEFF/, '')
}

export async function deletePartnerConfig(
  sessionToken: string,
  partnerId: string,
  requireAdmin: (t: string) => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }
  const token = loadDevGithubToken()
  if (!token) return { ok: false, error: 'GitHub write token missing' }

  const list = await fetchPartnerConfigs(true)
  const removed = list.find((p) => p.id === partnerId)
  const nextList = list.filter((p) => p.id !== partnerId)
  if (!removed || nextList.length === list.length) {
    return { ok: false, error: `Partner not found: ${partnerId}` }
  }

  const existingAuth = await loadExistingAuth(token)
  const configJson = buildConfigFile(nextList)
  // Empty list is valid after deleting the last partner
  const authBuilt =
    nextList.length === 0
      ? { ok: true as const, json: JSON.stringify({ version: 1, partners: [] }, null, 2) + '\n' }
      : buildAuthFile(nextList, {}, existingAuth)
  if (!authBuilt.ok) return { ok: false, error: authBuilt.error }

  const msg = `chore(partners): delete ${partnerId} via EG Admin`

  // Strip their news posts from partners feed
  let partnersFeed = {
    version: 1,
    title: 'EG Partner News',
    updated: new Date().toISOString(),
    items: [] as unknown[],
  }
  const feedRes = await getRepoFileText({
    token,
    owner: CONTENT_OWNER,
    repo: CONTENT_REPO,
    branch: CONTENT_BRANCH,
    path: FEED_PARTNERS_PRIVATE,
  })
  if (feedRes.ok) {
    try {
      const f = JSON.parse(stripBomSafe(feedRes.text)) as {
        title?: string
        items?: Array<{ tag?: string }>
      }
      const tag = removed.newsTag?.toLowerCase()
      partnersFeed = {
        version: 1,
        title: f.title || 'EG Partner News',
        updated: new Date().toISOString(),
        items: (f.items || []).filter((i) => (i.tag || '').toLowerCase() !== tag),
      }
    } catch {
      /* keep empty */
    }
  }
  const feedJson = JSON.stringify(partnersFeed, null, 2) + '\n'

  const written = await putRepoFilesSequential([
    { token, ...privateRepo, path: CONFIG_PARTNERS_PRIVATE, content: configJson, message: msg },
    { token, ...privateRepo, path: AUTH_PARTNERS_PRIVATE, content: authBuilt.json, message: msg },
    { token, ...privateRepo, path: FEED_PARTNERS_PRIVATE, content: feedJson, message: msg },
    { token, ...publicRepo, path: CONFIG_PARTNERS_PUBLIC, content: configJson, message: msg },
    { token, ...publicRepo, path: AUTH_PARTNERS_PUBLIC, content: authBuilt.json, message: msg },
    { token, ...publicRepo, path: FEED_PARTNERS_PUBLIC, content: feedJson, message: msg },
  ])
  if (!written.ok) return { ok: false, error: written.error }

  writeJsonFile(cachePath(), { fetchedAt: new Date().toISOString(), partners: nextList })
  applyLocalFeedSnapshot(feedJson, 'partners')
  return { ok: true }
}

export function newPartnerConfigId(title: string): string {
  const base = slugifyPartnerId(title)
  return `${base}-${crypto.randomBytes(2).toString('hex')}`
}
