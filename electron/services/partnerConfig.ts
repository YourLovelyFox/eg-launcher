import crypto from 'crypto'
import path from 'path'
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

function clearCache(): void {
  writeJsonFile(cachePath(), { fetchedAt: new Date(0).toISOString(), partners: [] as PartnerConfig[] })
}

/**
 * Partners come only from CMS.
 * - Successful CMS response (including empty list) is authoritative.
 * - Cache is a short TTL aid when force=false; never injects hardcoded brands.
 * - No built-in Horizons / EG Forge fallback (those reappeared after delete).
 */
export async function fetchPartnerConfigs(force = false): Promise<PartnerConfig[]> {
  const cached = readJsonFile<{ fetchedAt: string; partners: PartnerConfig[] } | null>(
    cachePath(),
    null,
  )
  if (!force && cached && Array.isArray(cached.partners)) {
    const age = Date.now() - Date.parse(cached.fetchedAt)
    if (Number.isFinite(age) && age >= 0 && age < 8_000) {
      return cached.partners.filter((p) => p.enabled !== false)
    }
  }

  try {
    const partners = await listPartnerConfigsFromDb()
    // Empty array is valid — means CMS has no partners (or all deleted).
    writeJsonFile(cachePath(), {
      fetchedAt: new Date().toISOString(),
      partners: Array.isArray(partners) ? partners : [],
    })
    return (Array.isArray(partners) ? partners : []).filter((p) => p.enabled !== false)
  } catch (err) {
    console.warn('[partners] CMS config load failed:', (err as Error).message)
    // Offline: serve last cache only (may be empty). Never re-inject deleted builtins.
    if (cached && Array.isArray(cached.partners)) {
      return cached.partners.filter((p) => p.enabled !== false)
    }
    return []
  }
}

/** Admin list: always force-refresh from CMS (no cache, no builtins). */
export async function listPartnersForAdmin(): Promise<PartnerConfig[]> {
  const partners = await listPartnerConfigsFromDb()
  writeJsonFile(cachePath(), {
    fetchedAt: new Date().toISOString(),
    partners: Array.isArray(partners) ? partners : [],
  })
  return Array.isArray(partners) ? partners : []
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
  if (!requireAdmin(sessionToken)) {
    return {
      ok: false,
      error: 'Session timed out or not signed in. Open Settings → Staff and sign in again.',
    }
  }

  const id = (partnerId || '').trim()
  if (!id) return { ok: false, error: 'Partner id required' }

  try {
    await deletePartnerConfigFromDb(id)
  } catch (err) {
    const msg = (err as Error).message || 'Delete failed'
    if (/admin login required|session expired|not signed in|staff login/i.test(msg)) {
      return {
        ok: false,
        error:
          'Session timed out or CMS rejected the staff session. Sign out and sign in again under Settings → Staff (Admin role required to delete partners).',
      }
    }
    return { ok: false, error: msg }
  }

  // Drop deleted id from local cache immediately so UI/sidebar cannot resurrect it
  try {
    const list = await listPartnerConfigsFromDb()
    const next = (Array.isArray(list) ? list : []).filter((p) => p.id !== id)
    writeJsonFile(cachePath(), { fetchedAt: new Date().toISOString(), partners: next })
    try {
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
      /* news optional */
    }
  } catch {
    // CMS list failed after delete — still clear local cache so partner disappears in UI
    const cached = readJsonFile<{ partners?: PartnerConfig[] }>(cachePath(), { partners: [] })
    const next = (cached.partners || []).filter((p) => p.id !== id)
    writeJsonFile(cachePath(), { fetchedAt: new Date().toISOString(), partners: next })
  }

  return { ok: true }
}

export function newPartnerConfigId(title: string): string {
  const base = slugifyPartnerId(title)
  return `${base}-${crypto.randomBytes(2).toString('hex')}`
}

export { clearCache as clearPartnerConfigCache }
