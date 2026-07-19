import { create } from 'zustand'
import type {
  GameInstance,
  LauncherSettings,
  MinecraftAccount,
  ProgressEvent,
  RunningGameInfo,
} from '../shared/types'

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
  loading: boolean

  setAccounts: (accounts: MinecraftAccount[], activeAccountId: string | null) => void
  setSettings: (settings: LauncherSettings) => void
  setInstances: (instances: GameInstance[]) => void
  setSelectedInstanceId: (id: string | null) => void
  setInstallProgress: (p: ProgressEvent | null) => void
  setDownloadProgress: (p: ProgressEvent | null) => void
  setRunning: (running: RunningGameInfo) => void
  showToast: (type: Toast['type'], message: string) => void
  clearToast: () => void
  setLoading: (v: boolean) => void
  refreshAll: () => Promise<void>
  refreshRunning: () => Promise<RunningGameInfo>
  stopGame: () => Promise<void>
}

let toastSeq = 1

export const useAppStore = create<AppState>((set, get) => ({
  accounts: [],
  activeAccountId: null,
  settings: null,
  instances: [],
  selectedInstanceId: null,
  installProgress: null,
  downloadProgress: null,
  running: IDLE_RUNNING,
  toast: null,
  loading: true,

  setAccounts: (accounts, activeAccountId) => set({ accounts, activeAccountId }),
  setSettings: (settings) => set({ settings }),
  setInstances: (instances) => set({ instances }),
  setSelectedInstanceId: (id) => set({ selectedInstanceId: id }),
  setInstallProgress: (p) => set({ installProgress: p }),
  setDownloadProgress: (p) => set({ downloadProgress: p }),
  setRunning: (running) => set({ running }),
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

  refreshAll: async () => {
    try {
      const [auth, settings, instances, running] = await Promise.all([
        window.hive.auth.getAccounts(),
        window.hive.settings.get(),
        window.hive.instances.list(),
        window.hive.mc.running().catch(() => IDLE_RUNNING),
      ])
      set({
        accounts: auth.accounts,
        activeAccountId: auth.activeAccountId,
        settings,
        instances,
        running,
        loading: false,
      })
    } catch (err) {
      set({ loading: false })
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
