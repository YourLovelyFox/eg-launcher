import { create } from 'zustand'
import type {
  GameInstance,
  LauncherSettings,
  MinecraftAccount,
  ProgressEvent,
  RunningGameInfo,
} from '../shared/types'
import { readBootCache, writeBootCache } from './bootCache'
import { loadQolPrefs, setLastInstanceId } from './qolPrefs'

type Toast = {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

const IDLE_RUNNING: RunningGameInfo = {
  running: false,
  instanceId: null,
  instanceName: null,
  pid: null,
  startedAt: null,
}

/** Hydrate from disk cache so first paint is real content, not a spinner. */
const cached = typeof localStorage !== 'undefined' ? readBootCache() : null

type AppState = {
  accounts: MinecraftAccount[]
  activeAccountId: string | null
  settings: LauncherSettings | null
  instances: GameInstance[]
  selectedInstanceId: string | null
  installProgress: ProgressEvent | null
  downloadProgress: ProgressEvent | null
  running: RunningGameInfo
  toast: Toast | null
  /** True only when we have no cache and still waiting on first IPC. */
  loading: boolean
  /** True while a background refresh is in flight (shell already visible). */
  hydrating: boolean
  /** True after at least one successful live refresh this session. */
  hydrated: boolean

  setAccounts: (accounts: MinecraftAccount[], activeAccountId: string | null) => void
  setSettings: (settings: LauncherSettings) => void
  setInstances: (instances: GameInstance[]) => void
  setSelectedInstanceId: (id: string | null) => void
  setInstallProgress: (p: ProgressEvent | null) => void
  setDownloadProgress: (p: ProgressEvent | null) => void
  setRunning: (running: RunningGameInfo) => void
  setHydrating: (v: boolean) => void
  showToast: (type: Toast['type'], message: string) => void
  clearToast: () => void
  setLoading: (v: boolean) => void
  /** Critical path: accounts + settings + instances (parallel). */
  refreshCore: () => Promise<void>
  /** Full refresh (core + running). Prefer refreshCore on boot. */
  refreshAll: () => Promise<void>
  refreshRunning: () => Promise<RunningGameInfo>
  stopGame: () => Promise<void>
}

let toastSeq = 1

function pickSelectedId(
  instances: GameInstance[],
  current: string | null,
): string | null {
  const lastId = loadQolPrefs().lastInstanceId
  return (
    (lastId && instances.some((i) => i.id === lastId) ? lastId : null) ||
    current ||
    instances[0]?.id ||
    null
  )
}

function persistCache(state: {
  accounts: MinecraftAccount[]
  activeAccountId: string | null
  instances: GameInstance[]
  settings: LauncherSettings | null
}): void {
  writeBootCache({
    accounts: state.accounts,
    activeAccountId: state.activeAccountId,
    instances: state.instances,
    settings: state.settings,
  })
}

export const useAppStore = create<AppState>((set, get) => ({
  accounts: cached?.accounts ?? [],
  activeAccountId: cached?.activeAccountId ?? null,
  settings: cached?.settings ?? null,
  instances: cached?.instances ?? [],
  selectedInstanceId:
    pickSelectedId(cached?.instances ?? [], loadQolPrefs().lastInstanceId) ??
    loadQolPrefs().lastInstanceId,
  installProgress: null,
  downloadProgress: null,
  running: IDLE_RUNNING,
  toast: null,
  // Only block UI when cold start with nothing to show
  loading: !cached,
  hydrating: false,
  hydrated: false,

  setAccounts: (accounts, activeAccountId) => {
    set({ accounts, activeAccountId })
    const s = get()
    persistCache({
      accounts,
      activeAccountId,
      instances: s.instances,
      settings: s.settings,
    })
  },
  setSettings: (settings) => {
    set({ settings })
    const s = get()
    persistCache({
      accounts: s.accounts,
      activeAccountId: s.activeAccountId,
      instances: s.instances,
      settings,
    })
  },
  setInstances: (instances) => {
    set({ instances })
    const s = get()
    persistCache({
      accounts: s.accounts,
      activeAccountId: s.activeAccountId,
      instances,
      settings: s.settings,
    })
  },
  setSelectedInstanceId: (id) => {
    set({ selectedInstanceId: id })
    if (id) setLastInstanceId(id)
  },
  setInstallProgress: (p) => set({ installProgress: p }),
  setDownloadProgress: (p) => set({ downloadProgress: p }),
  setRunning: (running) => set({ running }),
  setHydrating: (v) => set({ hydrating: v }),
  showToast: (type, message) => {
    const id = toastSeq++
    set({ toast: { id, type, message } })
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 4200)
  },
  clearToast: () => set({ toast: null }),
  setLoading: (v) => set({ loading: v }),

  refreshRunning: async () => {
    try {
      const running = await window.hive.mc.running()
      set({ running })
      return running
    } catch {
      set({ running: IDLE_RUNNING })
      return IDLE_RUNNING
    }
  },

  stopGame: async () => {
    try {
      const running = await window.hive.mc.stop()
      set({ running })
      get().showToast('success', 'Minecraft stopped')
    } catch (err) {
      get().showToast('error', (err as Error).message || 'Failed to stop game')
      await get().refreshRunning()
    }
  },

  refreshCore: async () => {
    set({ hydrating: true })
    try {
      const [auth, settings, instances] = await Promise.all([
        window.hive.auth.getAccounts(),
        window.hive.settings.get(),
        window.hive.instances.list(),
      ])
      const selected = pickSelectedId(instances, get().selectedInstanceId)
      set({
        accounts: auth.accounts,
        activeAccountId: auth.activeAccountId,
        settings,
        instances,
        selectedInstanceId: selected,
        loading: false,
        hydrating: false,
        hydrated: true,
      })
      if (selected) setLastInstanceId(selected)
      persistCache({
        accounts: auth.accounts,
        activeAccountId: auth.activeAccountId,
        instances,
        settings,
      })
    } catch (err) {
      set({ hydrating: false, loading: false })
      get().showToast('error', (err as Error).message || 'Failed to load launcher data')
    }
  },

  refreshAll: async () => {
    set({ hydrating: true })
    try {
      const [auth, settings, instances, running] = await Promise.all([
        window.hive.auth.getAccounts(),
        window.hive.settings.get(),
        window.hive.instances.list(),
        window.hive.mc.running().catch(() => IDLE_RUNNING),
      ])
      const selected = pickSelectedId(instances, get().selectedInstanceId)
      set({
        accounts: auth.accounts,
        activeAccountId: auth.activeAccountId,
        settings,
        instances,
        selectedInstanceId: selected,
        running,
        loading: false,
        hydrating: false,
        hydrated: true,
      })
      if (selected) setLastInstanceId(selected)
      persistCache({
        accounts: auth.accounts,
        activeAccountId: auth.activeAccountId,
        instances,
        settings,
      })
    } catch (err) {
      set({ hydrating: false, loading: false })
      get().showToast('error', (err as Error).message || 'Failed to load launcher data')
    }
  },
}))

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function loaderLabel(loader: string): string {
  switch (loader) {
    case 'neoforge':
      return 'NeoForge'
    case 'fabric':
      return 'Fabric'
    case 'forge':
      return 'Forge'
    case 'vanilla':
      return 'Vanilla'
    default:
      return loader
  }
}
