import { contextBridge, ipcRenderer } from 'electron'

/** Staff Menu always available — gated by CMS staff login. */
function adminUnlockedSync(): boolean {
  return true
}
import type {
  DeviceCodeResponse,
  GameInstance,
  InstanceBackupInfo,
  LauncherSettings,
  SystemMemoryInfo,
  LaunchResult,
  LoaderType,
  LoaderVersionInfo,
  MinecraftAccount,
  MinecraftServerStatus,
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
      | { status: 'failed'; message: string; code?: string }
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
    rename: (id: string, newName: string): Promise<GameInstance> =>
      ipcRenderer.invoke('instances:rename', id, newName),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('instances:delete', id),
    toggleMod: (instanceId: string, projectId: string, enabled: boolean): Promise<GameInstance> =>
      ipcRenderer.invoke('instances:toggleMod', instanceId, projectId, enabled),
    removeMod: (instanceId: string, projectId: string): Promise<GameInstance> =>
      ipcRenderer.invoke('instances:removeMod', instanceId, projectId),
    installLocalJar: (instanceId: string, filePath: string): Promise<GameInstance> =>
      ipcRenderer.invoke('instances:installLocalJar', instanceId, filePath),
    listBackups: (instanceId: string): Promise<InstanceBackupInfo[]> =>
      ipcRenderer.invoke('instances:listBackups', instanceId),
    createBackup: (
      instanceId: string,
      opts?: { includeSaves?: boolean; label?: string },
    ): Promise<InstanceBackupInfo> =>
      ipcRenderer.invoke('instances:createBackup', instanceId, opts || {}),
    restoreBackup: (
      instanceId: string,
      backupId: string,
    ): Promise<{ ok: true; message: string }> =>
      ipcRenderer.invoke('instances:restoreBackup', instanceId, backupId),
    deleteBackup: (instanceId: string, backupId: string): Promise<boolean> =>
      ipcRenderer.invoke('instances:deleteBackup', instanceId, backupId),
    openBackupsFolder: (instanceId?: string): Promise<string> =>
      ipcRenderer.invoke('instances:openBackupsFolder', instanceId),
    onBackupProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('instances:backupProgress', listener)
      return () => {
        ipcRenderer.removeListener('instances:backupProgress', listener)
      }
    },
    listExportContents: (
      instanceId: string,
    ): Promise<import('../shared/types').EgpackExportEntry[]> =>
      ipcRenderer.invoke('instances:listExportContents', instanceId),
    /** Export instance as .egpack only (options → save dialog). */
    exportEgpack: (
      instanceId: string,
      options?: import('../shared/types').EgpackExportOptions,
    ): Promise<
      | { ok: true; path: string; size: number }
      | { ok: false; cancelled: true }
    > => ipcRenderer.invoke('instances:exportEgpack', instanceId, options),
    /** Import .egpack or .mrpack (open dialog if no path). */
    importPack: (opts?: {
      filePath?: string
      name?: string
      installRuntime?: boolean
    }): Promise<
      | { ok: true; instance: GameInstance; format: 'egpack' | 'mrpack' }
      | { ok: false; cancelled: true }
    > => ipcRenderer.invoke('instances:importPack', opts || {}),
    onPackProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('instances:packProgress', listener)
      return () => {
        ipcRenderer.removeListener('instances:packProgress', listener)
      }
    },
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
      options?: { acknowledgeLowMemory?: boolean; quickPlayServer?: string },
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
  server: {
    status: (address: string): Promise<MinecraftServerStatus> =>
      ipcRenderer.invoke('server:status', address),
  },
  modrinth: {
    search: (opts: {
      query?: string
      gameVersion?: string
      loader?: string
      categories?: string[]
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
    /** Parallel bulk update — one job for all selected mods. */
    installModsBatch: (payload: {
      instanceId: string
      mods: Array<{ projectId: string; versionId: string }>
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
    > => ipcRenderer.invoke('modrinth:installModsBatch', payload),
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
    /** Any HTTPS (ads / payment) — user-initiated only. */
    openHttps: (url: string): Promise<void> => ipcRenderer.invoke('shell:openHttps', url),
    openInstanceFolder: (instanceId: string): Promise<void> =>
      ipcRenderer.invoke('shell:openInstanceFolder', instanceId),
    openInstancePath: (
      instanceId: string,
      sub?: 'root' | 'mods' | 'screenshots' | 'logs' | 'resourcepacks',
    ): Promise<void> => ipcRenderer.invoke('shell:openInstancePath', instanceId, sub),
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
    prepareJoin: (
      id: string,
    ): Promise<{ instanceId: string; serverAddress: string; serverName: string }> =>
      ipcRenderer.invoke('partners:prepareJoin', id),
    listEvents: (partnerId?: string): Promise<
      import('../shared/types').PartnerEvent[]
    > => ipcRenderer.invoke('partners:listEvents', partnerId),
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
    upsertEvent: (
      sessionToken: string,
      input: {
        id?: string
        title: string
        description?: string
        startsAt: string
        endsAt?: string | null
        location?: string | null
      },
    ) => ipcRenderer.invoke('partnerAuth:upsertEvent', sessionToken, input),
    deleteEvent: (sessionToken: string, eventId: string) =>
      ipcRenderer.invoke('partnerAuth:deleteEvent', sessionToken, eventId),
  },
  /**
   * Staff Menu API — available in all builds; requires CMS staff login.
   */
  admin: {
    /** Always true — open Settings → Staff and sign in with a CMS account. */
    isEnabled: (): boolean => true,
    login: (
      password: string,
    ): Promise<
      { ok: true; sessionToken: string; expiresAt?: number } | { ok: false; error: string }
    > => ipcRenderer.invoke('admin:login', password),
    logout: (sessionToken: string): Promise<boolean> =>
      ipcRenderer.invoke('admin:logout', sessionToken),
    status: (
      sessionToken: string,
    ): Promise<{
      authenticated: boolean
      hasCmsApiKey?: boolean
      feedPath: string
      feedUrl: string
      repo: string
      adminEnabled?: boolean
      staffRole?: string | null
      expiresAt?: number | null
      sessionTtlSeconds?: number
    }> => ipcRenderer.invoke('admin:status', sessionToken),
    /** Reset idle timeout (call on clicks / typing). */
    touchSession: (
      sessionToken: string,
    ): Promise<{ ok: true; expiresAt: number } | { ok: false; error: string }> =>
      ipcRenderer.invoke('admin:touchSession', sessionToken),
    setCmsApiKey: (
      sessionToken: string,
      key: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('admin:setCmsApiKey', sessionToken, key),
    loadNews: (
      sessionToken: string,
    ): Promise<{ ok: true; feed: NewsFeedResult } | { ok: false; error: string }> =>
      ipcRenderer.invoke('admin:loadNews', sessionToken),
    publishNews: (
      sessionToken: string,
      items: NewsItem[],
      title?: string,
    ): Promise<
      { ok: true; commitUrl?: string; message: string } | { ok: false; error: string }
    > => ipcRenderer.invoke('admin:publishNews', sessionToken, items, title),
    newId: (): Promise<string> => ipcRenderer.invoke('admin:newId'),
    listPartners: (
      sessionToken: string,
    ): Promise<{ ok: true; partners: PartnerConfig[] } | { ok: false; error: string }> =>
      ipcRenderer.invoke('admin:listPartners', sessionToken),
    upsertPartner: (
      sessionToken: string,
      input: Record<string, unknown>,
    ): Promise<{ ok: true; partner: PartnerConfig } | { ok: false; error: string }> => {
      return ipcRenderer.invoke('admin:upsertPartner', sessionToken, input)
    },
    deletePartner: (
      sessionToken: string,
      partnerId: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
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
          cmsOnline: boolean
          userCount: number
          error?: string
        }
      | { ok: false; error: string; cmsOnline?: boolean }
    > => {
      return ipcRenderer.invoke('admin:listOfflineUsers', sessionToken)
    },
    createOfflineUser: (
      sessionToken: string,
      username: string,
      password: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      return ipcRenderer.invoke('admin:createOfflineUser', sessionToken, username, password)
    },
    deleteOfflineUser: (
      sessionToken: string,
      userId: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      return ipcRenderer.invoke('admin:deleteOfflineUser', sessionToken, userId)
    },
    setOfflineUnlockPassword: (
      sessionToken: string,
      password: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      return ipcRenderer.invoke('admin:setOfflineUnlockPassword', sessionToken, password)
    },
    publishOfflineAuth: (
      sessionToken: string,
    ): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> => {
      return ipcRenderer.invoke('admin:publishOfflineAuth', sessionToken)
    },
    listPartnerEvents: (
      sessionToken: string,
      partnerId?: string,
    ): Promise<
      | { ok: true; events: import('../shared/types').PartnerEvent[] }
      | { ok: false; error: string }
    > => {
      return ipcRenderer.invoke('admin:listPartnerEvents', sessionToken, partnerId)
    },
    upsertPartnerEvent: (
      sessionToken: string,
      input: {
        id?: string
        partnerId: string
        title: string
        description?: string
        startsAt: string
        endsAt?: string | null
        location?: string | null
      },
    ): Promise<
      | { ok: true; event: import('../shared/types').PartnerEvent; message?: string }
      | { ok: false; error: string }
    > => {
      return ipcRenderer.invoke('admin:upsertPartnerEvent', sessionToken, input)
    },
    deletePartnerEvent: (
      sessionToken: string,
      eventId: string,
    ): Promise<{ ok: true; message?: string } | { ok: false; error: string }> => {
      return ipcRenderer.invoke('admin:deletePartnerEvent', sessionToken, eventId)
    },
    health: (
      sessionToken: string,
    ): Promise<
      | { ok: true; health: import('./services/healthDashboard').AdminHealthSnapshot }
      | { ok: false; error: string }
    > => {
      return ipcRenderer.invoke('admin:health', sessionToken)
    },
    staffLogin: (
      username: string,
      password: string,
    ): Promise<
      | {
          ok: true
          staff: {
            id: string
            username: string
            role: string
            offlineQuota: number
            offlineUsed: number
            email?: string | null
            emailBound?: boolean
            mustBindEmail?: boolean
          }
          expiresAt?: number
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('staff:login', username, password),
    staffLogout: () => ipcRenderer.invoke('staff:logout'),
    staffMe: () => ipcRenderer.invoke('staff:me'),
    staffForgotPassword: (
      username: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('staff:forgotPassword', username),
    staffResetPassword: (
      username: string,
      code: string,
      newPassword: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('staff:resetPassword', username, code, newPassword),
    staffBindEmail: (
      email: string,
    ): Promise<
      | {
          ok: true
          staff: {
            id: string
            username: string
            role: string
            offlineQuota: number
            offlineUsed: number
            email?: string | null
            emailBound?: boolean
            mustBindEmail?: boolean
          }
          message: string
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('staff:bindEmail', email),
    listStaffUsers: (sessionToken: string) => ipcRenderer.invoke('staff:listUsers', sessionToken),
    createStaffUser: (
      sessionToken: string,
      input: {
        username: string
        password: string
        role: string
        offlineQuota?: number
        email?: string
      },
    ) => ipcRenderer.invoke('staff:createUser', sessionToken, input),
    deleteStaffUser: (sessionToken: string, id: string) =>
      ipcRenderer.invoke('staff:deleteUser', sessionToken, id),
    listApprovals: (sessionToken: string, status?: string) =>
      ipcRenderer.invoke('staff:listApprovals', sessionToken, status),
    reviewApproval: (
      sessionToken: string,
      id: string,
      decision: 'approved' | 'rejected',
      note?: string,
    ) => ipcRenderer.invoke('staff:reviewApproval', sessionToken, id, decision, note),
    submitApproval: (
      sessionToken: string,
      input: { type: string; summary: string; payload: unknown },
    ) => ipcRenderer.invoke('staff:submitApproval', sessionToken, input),
    listFeaturedPacks: (all?: boolean) => ipcRenderer.invoke('featured:listPacks', all),
    saveFeaturedPack: (sessionToken: string, pack: unknown) =>
      ipcRenderer.invoke('featured:savePack', sessionToken, pack),
    deleteFeaturedPack: (sessionToken: string, id: string) =>
      ipcRenderer.invoke('featured:deletePack', sessionToken, id),
    adsCreateCode: (sessionToken: string, input?: { days?: number; code?: string; note?: string }) =>
      ipcRenderer.invoke('ads:createCode', sessionToken, input || {}),
    adsListClaims: (sessionToken: string) => ipcRenderer.invoke('ads:listClaims', sessionToken),
    adsGrant: (
      sessionToken: string,
      input: { deviceId: string; days?: number; claimId?: string; note?: string },
    ) => ipcRenderer.invoke('ads:grant', sessionToken, input),
    adsListCreatives: (sessionToken: string) =>
      ipcRenderer.invoke('ads:listCreatives', sessionToken),
    adsSaveCreative: (sessionToken: string, creative: Record<string, unknown>) =>
      ipcRenderer.invoke('ads:saveCreative', sessionToken, creative),
    adsDeleteCreative: (sessionToken: string, id: string) =>
      ipcRenderer.invoke('ads:deleteCreative', sessionToken, id),
    adsGetNetwork: (sessionToken: string) =>
      ipcRenderer.invoke('ads:getNetworkAdmin', sessionToken),
    adsSaveNetwork: (
      sessionToken: string,
      input: {
        enabled?: boolean
        provider?: string
        adsenseClient?: string
        adsenseSlot?: string
        customHtml?: string
      },
    ) => ipcRenderer.invoke('ads:saveNetwork', sessionToken, input),
  },
  featuredPacks: {
    listPublic: () => ipcRenderer.invoke('featured:listPublic'),
  },
  ads: {
    status: () => ipcRenderer.invoke('ads:status'),
    local: () => ipcRenderer.invoke('ads:local'),
    deviceId: () => ipcRenderer.invoke('ads:deviceId'),
    redeem: (code: string) => ipcRenderer.invoke('ads:redeem', code),
    claim: (input?: { email?: string; message?: string }) =>
      ipcRenderer.invoke('ads:claim', input || {}),
    paypalCheckout: () => ipcRenderer.invoke('ads:paypalCheckout'),
    inventory: (limit?: number) => ipcRenderer.invoke('ads:inventory', limit),
    network: () => ipcRenderer.invoke('ads:network'),
    track: (creativeId: string, event: 'impression' | 'click') =>
      ipcRenderer.invoke('ads:track', creativeId, event),
  },
}

contextBridge.exposeInMainWorld('hive', api)

export type HiveApi = typeof api
