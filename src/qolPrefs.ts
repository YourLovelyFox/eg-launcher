/** Local QoL preferences (renderer localStorage). */

export type RecentActivityKind =
  | 'played'
  | 'installed_mod'
  | 'created_instance'
  | 'update_check'
  | 'joined_partner'

export type RecentActivityItem = {
  id: string
  kind: RecentActivityKind
  label: string
  at: string
  href?: string
}

export type QolPrefs = {
  lastInstanceId: string | null
  pinnedInstanceIds: string[]
  pinnedPartnerIds: string[]
  recent: RecentActivityItem[]
  /** partnerId -> ISO last successful online ping */
  partnerLastOnline: Record<string, string>
  /** partnerId -> last seen news item id or fingerprint */
  partnerNewsSeen: Record<string, string>
}

const KEY = 'eg-qol-prefs-v1'
const MAX_RECENT = 12

const DEFAULTS: QolPrefs = {
  lastInstanceId: null,
  pinnedInstanceIds: [],
  pinnedPartnerIds: [],
  recent: [],
  partnerLastOnline: {},
  partnerNewsSeen: {},
}

export function loadQolPrefs(): QolPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS, recent: [], pinnedInstanceIds: [], pinnedPartnerIds: [], partnerLastOnline: {}, partnerNewsSeen: {} }
    const j = JSON.parse(raw) as Partial<QolPrefs>
    return {
      lastInstanceId: j.lastInstanceId ?? null,
      pinnedInstanceIds: Array.isArray(j.pinnedInstanceIds) ? j.pinnedInstanceIds : [],
      pinnedPartnerIds: Array.isArray(j.pinnedPartnerIds) ? j.pinnedPartnerIds : [],
      recent: Array.isArray(j.recent) ? j.recent.slice(0, MAX_RECENT) : [],
      partnerLastOnline: j.partnerLastOnline && typeof j.partnerLastOnline === 'object' ? j.partnerLastOnline : {},
      partnerNewsSeen: j.partnerNewsSeen && typeof j.partnerNewsSeen === 'object' ? j.partnerNewsSeen : {},
    }
  } catch {
    return { ...DEFAULTS, recent: [], pinnedInstanceIds: [], pinnedPartnerIds: [], partnerLastOnline: {}, partnerNewsSeen: {} }
  }
}

export function saveQolPrefs(prefs: QolPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}

export function setLastInstanceId(id: string | null): void {
  const p = loadQolPrefs()
  p.lastInstanceId = id
  saveQolPrefs(p)
}

export function togglePinnedInstance(id: string): boolean {
  const p = loadQolPrefs()
  if (p.pinnedInstanceIds.includes(id)) {
    p.pinnedInstanceIds = p.pinnedInstanceIds.filter((x) => x !== id)
    saveQolPrefs(p)
    return false
  }
  p.pinnedInstanceIds = [id, ...p.pinnedInstanceIds.filter((x) => x !== id)]
  saveQolPrefs(p)
  return true
}

export function togglePinnedPartner(id: string): boolean {
  const p = loadQolPrefs()
  if (p.pinnedPartnerIds.includes(id)) {
    p.pinnedPartnerIds = p.pinnedPartnerIds.filter((x) => x !== id)
    saveQolPrefs(p)
    return false
  }
  p.pinnedPartnerIds = [id, ...p.pinnedPartnerIds.filter((x) => x !== id)]
  saveQolPrefs(p)
  return true
}

export function pushRecent(item: Omit<RecentActivityItem, 'id' | 'at'> & { at?: string }): void {
  const p = loadQolPrefs()
  const entry: RecentActivityItem = {
    id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: item.at || new Date().toISOString(),
    kind: item.kind,
    label: item.label,
    href: item.href,
  }
  p.recent = [entry, ...p.recent.filter((r) => r.label !== entry.label || r.kind !== entry.kind)].slice(
    0,
    MAX_RECENT,
  )
  saveQolPrefs(p)
}

export function setPartnerLastOnline(partnerId: string, when = new Date().toISOString()): void {
  const p = loadQolPrefs()
  p.partnerLastOnline[partnerId] = when
  saveQolPrefs(p)
}

export function markPartnerNewsSeen(partnerId: string, fingerprint: string): void {
  const p = loadQolPrefs()
  p.partnerNewsSeen[partnerId] = fingerprint
  saveQolPrefs(p)
}

export function partnerNewsFingerprint(items: Array<{ id?: string; date?: string; title?: string }>): string {
  if (!items.length) return 'empty'
  const top = items.slice(0, 5).map((i) => `${i.id || ''}:${i.date || ''}:${i.title || ''}`).join('|')
  return top
}
