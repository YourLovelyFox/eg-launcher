/**
 * Instant-boot cache: last-known launcher shell state in localStorage.
 * Lets the UI paint with real content before IPC finishes.
 */
import type { GameInstance, LauncherSettings, MinecraftAccount } from '../shared/types'

const KEY = 'eg.boot-cache.v1'
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14 // 14 days

export type BootCacheSnapshot = {
  v: 1
  savedAt: number
  accounts: MinecraftAccount[]
  activeAccountId: string | null
  instances: GameInstance[]
  settings: LauncherSettings | null
}

export function readBootCache(): BootCacheSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as BootCacheSnapshot
    if (!data || data.v !== 1 || typeof data.savedAt !== 'number') return null
    if (Date.now() - data.savedAt > MAX_AGE_MS) return null
    if (!Array.isArray(data.accounts) || !Array.isArray(data.instances)) return null
    return data
  } catch {
    return null
  }
}

export function writeBootCache(snapshot: Omit<BootCacheSnapshot, 'v' | 'savedAt'>): void {
  try {
    const payload: BootCacheSnapshot = {
      v: 1,
      savedAt: Date.now(),
      accounts: snapshot.accounts,
      activeAccountId: snapshot.activeAccountId,
      instances: snapshot.instances,
      settings: snapshot.settings,
    }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode — ignore */
  }
}

export function clearBootCache(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
