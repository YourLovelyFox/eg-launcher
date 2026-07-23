import { contextBridge, ipcRenderer } from 'electron'
import { isAdminBuild } from '../shared/features'

function adminUnlockedSync(): boolean {
  if (!isAdminBuild()) return false
  try {
    return Boolean(ipcRenderer.sendSync('admin:isUnlocked'))
  } catch {
    return false
  }
}
import type {
  DeviceCodeResponse,
  GameInstance,
  LauncherSettings,
  SystemMemoryInfo,
  LaunchResult,
  LoaderType,
  LoaderVersionInfo,
  MinecraftAccount,
  MinecraftVersionInfo,
  ModrinthProject,
  ModrinthSearchResult,
  ModrinthVersion,
  ProgressEvent,
  RunningGameInfo,
  UpdateStatus,
  AppVersionInfo,
  NewsFeedResult,
  NewsItem,
  PartnerConfig,
} from '../shared/types'
import type { PartnerDefinition } from '../shared/branding'

const api = {
  settings: {
    get: (): Promise<LauncherSettings> => ipcRenderer.invoke('settings:get'),
    save: (settings: LauncherSettings): Promise<LauncherSettings> =>
      ipcRenderer.invoke('settings:save', settings),
    systemMemory: (): Promise<SystemMemoryInfo> => ipcRenderer.invoke('settings:systemMemory'),
  },
  java: {
    find: (): Promise<{ path: string; version: string } | null> => ipcRenderer.invoke('java:find'),
    version: (javaPath: string): Promise<string | null> =>
      ipcRenderer.invoke('java:version', javaPath),
  },
  auth: {
    getAccounts: (): Promise<{ accounts: MinecraftAccount[]; activeAccountId: string | null }> =>
      ipcRenderer.invoke('auth:getAccounts'),
    setActive: (
      id: string | null,
    ): Promise<{ accounts: MinecraftAccount[]; activeAccountId: string | null }> =>
      ipcRenderer.invoke('auth:setActive', id),
    remove: (
      id: string,
    ): Promise<{ accounts: MinecraftAccount[]; activeAccountId: string | null }> =>
      ipcRenderer.invoke('auth:remove', id),
    startDeviceCode: (): Promise<DeviceCodeResponse> => ipcRenderer.invoke('auth:startDeviceCode'),
    pollDeviceCode: (
      deviceCode: string,
    ): Promise<
      | { status: 'pending' }
      | { status: 'slow_down' }
      | { status: 'completed'; account: MinecraftAccount }
      | { status: 'expired' }
      | { status: 'declined' }
    > => ipcRenderer.invoke('auth:pollDeviceCode', deviceCode),
  },
  offline: {
    status: (): Promise<{
      offlineModeEnabled: boolean
      unlockConfigured: boolean
      activeIsOffline: boolean
      activeUsername: string | null
    }> => ipcRenderer.invoke('offline:status'),
    unlock: (password: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke('offline:unlock', password),
    lock: (): Promise<{
      offlineModeEnabled: boolean
      unlockConfigured: boolean
      activeIsOffline: boolean
      activeUsername: string | null
    }> => ipcRenderer.invoke('offline:lock'),
    login: (
      username: string,
      password: string,
    ): Promise<{ ok: true; account: MinecraftAccount } | { ok: false; error: string }> =>
      ipcRenderer.invoke('offline:login', username, password),
    warning: (): Promise<string> => ipcRenderer.invoke('offline:warning'),
  },
  instances: {
    list: (): Promise<GameInstance[]> => ipcRenderer.invoke('instances:list'),
    get: (id: string): Promise<GameInstance | null> => ipcRenderer.invoke('instances:get', id),
    create: (input: {
      name: string
      gameVersion: string
      loader: LoaderType
      loaderVersion?: string
    }): Promise<GameInstance> => ipcRenderer.invoke('instances:create', input),
    update: (id: string, patch: Partial<GameInstance>): Promise<GameInstance> =>
      ipcRenderer.invoke('instances:update', id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('instances:delete', id),
    toggleMod: (instanceId: string, projectId: string, enabled: boolean): Promise<GameInstance> =>
      ipcRenderer.invoke('instances:toggleMod', instanceId, projectId, enabled),
    removeMod: (instanceId: string, projectId: string): Promise<GameInstance> =>
      ipcRenderer.invoke('instances:removeMod', instanceId, projectId),
  },
  mc: {
    listVersions: (): Promise<{
      latest: { release: string; snapshot: string }
      versions: MinecraftVersionInfo[]
    }> => ipcRenderer.invoke('mc:listVersions'),
    listLoaders: (loader: LoaderType, gameVersion: string): Promise<LoaderVersionInfo[]> =>
      ipcRenderer.invoke('mc:listLoaders', loader, gameVersion),
    install: (instanceId: string): Promise<{ versionId: string }> =>
      ipcRenderer.invoke('mc:install', instanceId),
    launch: (
      instanceId: string,
      options?: { acknowledgeLowMemory?: boolean },
    ): Promise<LaunchResult> => ipcRenderer.invoke('mc:launch', instanceId, options),
    stop: (): Promise<RunningGameInfo> => ipcRenderer.invoke('mc:forceStop'),
    running: (): Promise<RunningGameInfo> => ipcRenderer.invoke('mc:running'),
    onInstallProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('mc:installProgress', listener)
      return () => {
        ipcRenderer.removeListener('mc:installProgress', listener)
      }
    },
  },
  modrinth: {
    search: (opts: {
      query?: string
      gameVersion?: string
      loader?: string
      offset?: number
      limit?: number
      index?: string
    }): Promise<ModrinthSearchResult> => ipcRenderer.invoke('modrinth:search', opts),
    project: (id: string): Promise<ModrinthProject> => ipcRenderer.invoke('modrinth:project', id),
    versions: (id: string, gameVersion?: string, loader?: string): Promise<ModrinthVersion[]> =>
      ipcRenderer.invoke('modrinth:versions', id, gameVersion, loader),
    version: (versionId: string): Promise<ModrinthVersion> =>
      ipcRenderer.invoke('modrinth:version', versionId),
    installMod: (payload: {
      instanceId: string
      projectId: string
      versionId: string
    }): Promise<
      GameInstance & {
        _installSummary?: {
          installed: Array<{
            projectId: string
            title: string
            versionNumber: string
            isDependency: boolean
          }>
          skipped: Array<{ projectId: string; title: string; reason: string }>
          failed: Array<{ projectId: string; title?: string; error: string }>
        }
      }
    > => ipcRenderer.invoke('modrinth:installMod', payload),
    onDownloadProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('modrinth:downloadProgress', listener)
      return () => {
        ipcRenderer.removeListener('modrinth:downloadProgress', listener)
      }
    },
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
    openInstanceFolder: (instanceId: string): Promise<void> =>
      ipcRenderer.invoke('shell:openInstanceFolder', instanceId),
  },
  featured: {
    getStatus: (slug?: string) => ipcRenderer.invoke('featured:status', slug),
    install: (payload?: { slug?: string; versionId?: string }) =>
      ipcRenderer.invoke('featured:install', payload || {}),
    onInstallProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('featured:installProgress', listener)
      return () => {
        ipcRenderer.removeListener('featured:installProgress', listener)
      }
    },
  },
  partners: {
    list: (): Promise<PartnerDefinition[]> => ipcRenderer.invoke('partners:list'),
    listConfig: (force?: boolean): Promise<PartnerConfig[]> =>
      ipcRenderer.invoke('partners:listConfig', force),
    getStatus: (id: string) => ipcRenderer.invoke('partners:status', id),
    install: (id: string) => ipcRenderer.invoke('partners:install', id),
    onInstallProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('partners:installProgress', listener)
      return () => {
        ipcRenderer.removeListener('partners:installProgress', listener)
      }
    },
  },
  updater: {
    getStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('updater:getStatus'),
    getVersion: (): Promise<AppVersionInfo> => ipcRenderer.invoke('updater:getVersion'),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('updater:check'),
    download: (): Promise<UpdateStatus> => ipcRenderer.invoke('updater:download'),
    install: (): Promise<boolean> => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_: unknown, status: UpdateStatus) => cb(status)
      ipcRenderer.on('updater:status', listener)
      return () => {
        ipcRenderer.removeListener('updater:status', listener)
      }
    },
  },
  news: {
    fetch: (
      opts?: boolean | { force?: boolean; kind?: 'launcher' | 'partners'; tag?: string },
    ): Promise<NewsFeedResult> => ipcRenderer.invoke('news:fetch', opts),
    defaultUrl: (): Promise<string> => ipcRenderer.invoke('news:defaultUrl'),
    /** Fired when Admin/partner publish pins a new feed, or a poll finds changes */
    onUpdated: (
      cb: (payload: { kind: 'launcher' | 'partners'; feed: NewsFeedResult }) => void,
    ): (() => void) => {
      const listener = (
        _: unknown,
        payload: { kind: 'launcher' | 'partners'; feed: NewsFeedResult },
      ) => cb(payload)
      ipcRenderer.on('news:updated', listener)
      return () => {
        ipcRenderer.removeListener('news:updated', listener)
      }
    },
  },
  partnerAuth: {
    login: (
      username: string,
      password: string,
    ): Promise<
      | {
          ok: true
          sessionToken: string
          partnerId: string
          newsTag: string
          displayName: string
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('partnerAuth:login', username, password),
    logout: (sessionToken: string): Promise<boolean> =>
      ipcRenderer.invoke('partnerAuth:logout', sessionToken),
    status: (
      sessionToken: string,
    ): Promise<
      | {
          authenticated: true
          partnerId: string
          username: string
          newsTag: string
          displayName: string
        }
      | { authenticated: false }
    > => ipcRenderer.invoke('partnerAuth:status', sessionToken),
    loadNews: (
      sessionToken: string,
    ): Promise<
      { ok: true; feed: NewsFeedResult; newsTag: string } | { ok: false; error: string }
    > => ipcRenderer.invoke('partnerAuth:loadNews', sessionToken),
    publish: (
      sessionToken: string,
      items: NewsItem[],
    ): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('partnerAuth:publish', sessionToken, items),
    newId: (): Promise<string> => ipcRenderer.invoke('partnerAuth:newId'),
  },
  /**
   * Admin API is only functional in the Dev Launcher.
   * Public Live builds do not register these IPC handlers.
   */
  admin: {
    /** Dev build + local unlock file on this PC */
    isEnabled: (): boolean => adminUnlockedSync(),
    login: (
      password: string,
    ): Promise<{ ok: true; sessionToken: string } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) {
        return Promise.resolve({
          ok: false,
          error: 'Admin is locked. Create admin.local.json with "enableAdmin": true on this PC.',
        })
      }
      return ipcRenderer.invoke('admin:login', password)
    },
    logout: (sessionToken: string): Promise<boolean> => {
      if (!adminUnlockedSync()) return Promise.resolve(false)
      return ipcRenderer.invoke('admin:logout', sessionToken)
    },
    status: (
      sessionToken: string,
    ): Promise<{
      authenticated: boolean
      hasCmsApiKey?: boolean
      feedPath: string
      feedUrl: string
      repo: string
      adminEnabled?: boolean
    }> => {
      if (!adminUnlockedSync()) {
        return Promise.resolve({
          authenticated: false,
          hasCmsApiKey: false,
          feedPath: '',
          feedUrl: '',
          repo: '',
          adminEnabled: false,
        })
      }
      return ipcRenderer.invoke('admin:status', sessionToken)
    },
    setCmsApiKey: (
      sessionToken: string,
      key: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:setCmsApiKey', sessionToken, key)
    },
    loadNews: (
      sessionToken: string,
    ): Promise<{ ok: true; feed: NewsFeedResult } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:loadNews', sessionToken)
    },
    publishNews: (
      sessionToken: string,
      items: NewsItem[],
      title?: string,
    ): Promise<
      { ok: true; commitUrl?: string; message: string } | { ok: false; error: string }
    > => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:publishNews', sessionToken, items, title)
    },
    newId: (): Promise<string> => {
      if (!adminUnlockedSync()) return Promise.resolve(`news-${Date.now()}`)
      return ipcRenderer.invoke('admin:newId')
    },
    listPartners: (
      sessionToken: string,
    ): Promise<{ ok: true; partners: PartnerConfig[] } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:listPartners', sessionToken)
    },
    upsertPartner: (
      sessionToken: string,
      input: Record<string, unknown>,
    ): Promise<{ ok: true; partner: PartnerConfig } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:upsertPartner', sessionToken, input)
    },
    deletePartner: (
      sessionToken: string,
      partnerId: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:deletePartner', sessionToken, partnerId)
    },
    /**
     * Upload an image to the CMS (partner icons, etc.).
     * Pass base64 from a file input, or omit input to open a native file picker.
     */
    uploadImage: (
      sessionToken: string,
      input?:
        | { filePath: string }
        | { name: string; mime?: string; base64: string }
        | null,
    ): Promise<{ ok: true; url: string; message?: string } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:uploadImage', sessionToken, input ?? null)
    },
    listOfflineUsers: (
      sessionToken: string,
    ): Promise<
      | {
          ok: true
          users: Array<{
            id: string
            username: string
            uuid: string
            displayName: string
            createdAt: string
          }>
          unlockPasswordConfigured: boolean
          remoteSynced: boolean
        }
      | { ok: false; error: string }
    > => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:listOfflineUsers', sessionToken)
    },
    createOfflineUser: (
      sessionToken: string,
      username: string,
      password: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:createOfflineUser', sessionToken, username, password)
    },
    deleteOfflineUser: (
      sessionToken: string,
      userId: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:deleteOfflineUser', sessionToken, userId)
    },
    setOfflineUnlockPassword: (
      sessionToken: string,
      password: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:setOfflineUnlockPassword', sessionToken, password)
    },
    publishOfflineAuth: (
      sessionToken: string,
    ): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> => {
      if (!adminUnlockedSync()) return Promise.resolve({ ok: false, error: 'Admin locked' })
      return ipcRenderer.invoke('admin:publishOfflineAuth', sessionToken)
    },
  },
}

contextBridge.exposeInMainWorld('hive', api)

export type HiveApi = typeof api
