import crypto from 'crypto'
import path from 'path'
import { PARTNER_LIST } from '../../shared/branding'
import type { LoaderType, PartnerConfig } from '../../shared/types'
import { getDataRoot, readJsonFile, writeJsonFile } from '../paths'
import {
  deletePartnerConfigFromDb,
  listPartnerConfigsFromDb,
  upsertPartnerConfigInDb,
} from './db/partnersRepo'
import { applyLocalFeedSnapshot, fetchNews } from './news'

function cachePath(): string {
  return path.join(getDataRoot(), 'partners-config-cache.json')
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
    discordUrl: p.discordUrl ?? null,
    enabled: true,
  }))
}

export async function fetchPartnerConfigs(force = false): Promise<PartnerConfig[]> {
  const cached = readJsonFile<{ fetchedAt: string; partners: PartnerConfig[] } | null>(
    cachePath(),
    null,
  )
  if (!force && cached?.partners?.length) {
    const age = Date.now() - Date.parse(cached.fetchedAt)
    if (Number.isFinite(age) && age >= 0 && age < 8_000) {
      return cached.partners.filter((p) => p.enabled !== false)
    }
  }

  try {
    const partners = await listPartnerConfigsFromDb()
    if (partners.length > 0) {
      writeJsonFile(cachePath(), { fetchedAt: new Date().toISOString(), partners })
      return partners.filter((p) => p.enabled !== false)
    }
  } catch (err) {
    console.warn('[partners] CMS config load failed:', (err as Error).message)
    if (cached?.partners?.length) {
      return cached.partners.filter((p) => p.enabled !== false)
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
  newsPassword?: string
  defaultMods?: string[]
  modrinthPackSlug?: string | null
  iconUrl?: string | null
  discordUrl?: string | null
  enabled?: boolean
}

export async function upsertPartnerConfig(
  sessionToken: string,
  input: PartnerUpsertInput,
  requireAdmin: (t: string) => boolean,
): Promise<{ ok: true; partner: PartnerConfig } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }

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

  let list: PartnerConfig[]
  try {
    list = await listPartnerConfigsFromDb()
  } catch (err) {
    return { ok: false, error: `CMS: ${(err as Error).message}` }
  }

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
    discordUrl: input.discordUrl?.trim() || null,
    enabled: input.enabled !== false,
  }

  if (partner.loader !== 'vanilla' && !partner.modrinthPackSlug && partner.defaultMods.length === 0) {
    return {
      ok: false,
      error: 'Mod loader selected: set a Modrinth pack project or at least one mod slug for auto-install.',
    }
  }

  try {
    await upsertPartnerConfigInDb(partner, input.newsPassword?.trim() || undefined)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  const nextList = existing
    ? list.map((p) => (p.id === id ? partner : p))
    : [...list, partner]
  writeJsonFile(cachePath(), { fetchedAt: new Date().toISOString(), partners: nextList })
  return { ok: true, partner }
}

export async function deletePartnerConfig(
  sessionToken: string,
  partnerId: string,
  requireAdmin: (t: string) => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!requireAdmin(sessionToken)) return { ok: false, error: 'Not authenticated' }

  try {
    await deletePartnerConfigFromDb(partnerId)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  try {
    const list = await listPartnerConfigsFromDb()
    writeJsonFile(cachePath(), { fetchedAt: new Date().toISOString(), partners: list })
    const feed = await fetchNews({ force: true, kind: 'partners' })
    applyLocalFeedSnapshot(
      JSON.stringify({
        version: 1,
        title: feed.title,
        updated: feed.updated || new Date().toISOString(),
        items: feed.items,
      }),
      'partners',
    )
  } catch {
    /* ignore */
  }

  return { ok: true }
}

export function newPartnerConfigId(title: string): string {
  const base = slugifyPartnerId(title)
  return `${base}-${crypto.randomBytes(2).toString('hex')}`
}
