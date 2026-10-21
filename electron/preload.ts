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
  CatalogProject,
  CatalogSearchResult,
  CatalogVersion,
  ProgressEvent,
  RunningGameInfo,
  UpdateStatus,
  AppVersionInfo,
  NewsFeedResult,
  NewsItem,
  PartnerConfig,
} from '../shared/types'
import type { PartnerDefinition } from '../shared/branding'

/** Strip Electron’s “Error invoking remote method …” wrapper so toasts show the real cause. */
function inv<T = any>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err)
    const msg = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').trim()
    throw new Error(msg || raw)
  }) as Promise<T>
}

const api = {
  settings: {
    get: (): Promise<LauncherSettings> => inv('settings:get'),
    save: (settings: LauncherSettings): Promise<LauncherSettings> =>
      inv('settings:save', settings),
    systemMemory: (): Promise<SystemMemoryInfo> => inv('settings:systemMemory'),
  },
  java: {
    find: (): Promise<{ path: string; version: string } | null> => inv('java:find'),
    version: (javaPath: string): Promise<string | null> =>
      inv('java:version', javaPath),
  },
  auth: {
    getAccounts: (): Promise<{ accounts: MinecraftAccount[]; activeAccountId: string | null }> =>
      inv('auth:getAccounts'),
    setActive: (
      id: string | null,
    ): Promise<{ accounts: MinecraftAccount[]; activeAccountId: string | null }> =>
      inv('auth:setActive', id),
    remove: (
      id: string,
    ): Promise<{ accounts: MinecraftAccount[]; activeAccountId: string | null }> =>
      inv('auth:remove', id),
    startDeviceCode: (): Promise<DeviceCodeResponse> => inv('auth:startDeviceCode'),
    pollDeviceCode: (
      deviceCode: string,
    ): Promise<
      | { status: 'pending' }
      | { status: 'slow_down' }
      | { status: 'completed'; account: MinecraftAccount }
      | { status: 'expired' }
      | { status: 'declined' }
      | { status: 'failed'; message: string; code?: string }
    > => inv('auth:pollDeviceCode', deviceCode),
    msInfo: (): Promise<{ clientId: string; sharedClient: boolean; consentAppHint: string }> =>
      inv('auth:msInfo'),
    onProgress: (cb: (message: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, message: string) => cb(message)
      ipcRenderer.on('auth:progress', handler)
      return () => ipcRenderer.removeListener('auth:progress', handler)
    },
  },
  offline: {
    status: (): Promise<{
      offlineModeEnabled: boolean
      unlockConfigured: boolean
      activeIsOffline: boolean
      activeUsername: string | null
    }> => inv('offline:status'),
    unlock: (password: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      inv('offline:unlock', password),
    lock: (): Promise<{
      offlineModeEnabled: boolean
      unlockConfigured: boolean
      activeIsOffline: boolean
      activeUsername: string | null
    }> => inv('offline:lock'),
    login: (
      username: string,
      password: string,
    ): Promise<{ ok: true; account: MinecraftAccount } | { ok: false; error: string }> =>
      inv('offline:login', username, password),
    warning: (): Promise<string> => inv('offline:warning'),
  },
  instances: {
    list: (): Promise<GameInstance[]> => inv('instances:list'),
    get: (id: string): Promise<GameInstance | null> => inv('instances:get', id),
    create: (input: {
      name: string
      gameVersion: string
      loader: LoaderType
      loaderVersion?: string
    }): Promise<GameInstance> => inv('instances:create', input),
    update: (id: string, patch: Partial<GameInstance>): Promise<GameInstance> =>
      inv('instances:update', id, patch),
    rename: (id: string, newName: string): Promise<GameInstance> =>
      inv('instances:rename', id, newName),
    delete: (id: string): Promise<boolean> => inv('instances:delete', id),
    toggleMod: (instanceId: string, projectId: string, enabled: boolean): Promise<GameInstance> =>
      inv('instances:toggleMod', instanceId, projectId, enabled),
    removeMod: (instanceId: string, projectId: string): Promise<GameInstance> =>
      inv('instances:removeMod', instanceId, projectId),
    installLocalJar: (instanceId: string, filePath: string): Promise<GameInstance> =>
      inv('instances:installLocalJar', instanceId, filePath),
    listBackups: (instanceId: string): Promise<InstanceBackupInfo[]> =>
      inv('instances:listBackups', instanceId),
    createBackup: (
      instanceId: string,
      opts?: { includeSaves?: boolean; label?: string },
    ): Promise<InstanceBackupInfo> =>
      inv('instances:createBackup', instanceId, opts || {}),
    restoreBackup: (
      instanceId: string,
      backupId: string,
    ): Promise<{ ok: true; message: string }> =>
      inv('instances:restoreBackup', instanceId, backupId),
    deleteBackup: (instanceId: string, backupId: string): Promise<boolean> =>
      inv('instances:deleteBackup', instanceId, backupId),
    openBackupsFolder: (instanceId?: string): Promise<string> =>
      inv('instances:openBackupsFolder', instanceId),
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
      inv('instances:listExportContents', instanceId),
    /** Export instance as .egpack only (options → save dialog). */
    exportEgpack: (
      instanceId: string,
      options?: import('../shared/types').EgpackExportOptions,
    ): Promise<
      | { ok: true; path: string; size: number }
      | { ok: false; cancelled: true }
    > => inv('instances:exportEgpack', instanceId, options),
    /** Import .egpack or .mrpack (open dialog if no path). */
    importPack: (opts?: {
      filePath?: string
      name?: string
      installRuntime?: boolean
    }): Promise<
      | { ok: true; instance: GameInstance; format: 'egpack' | 'mrpack' }
      | { ok: false; cancelled: true }
    > => inv('instances:importPack', opts || {}),
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
    }> => inv('mc:listVersions'),
    listLoaders: (loader: LoaderType, gameVersion: string): Promise<LoaderVersionInfo[]> =>
      inv('mc:listLoaders', loader, gameVersion),
    install: (instanceId: string): Promise<{ versionId: string }> =>
      inv('mc:install', instanceId),
    launch: (
      instanceId: string,
      options?: { acknowledgeLowMemory?: boolean; quickPlayServer?: string },
    ): Promise<LaunchResult> => inv('mc:launch', instanceId, options),
    stop: (): Promise<RunningGameInfo> => inv('mc:forceStop'),
    running: (): Promise<RunningGameInfo> => inv('mc:running'),
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
      inv('server:status', address),
  },
  mods: {
    search: (opts: {
      query?: string
      gameVersion?: string
      loader?: string
      categories?: string[]
      offset?: number
      limit?: number
      index?: string
    }): Promise<CatalogSearchResult> => inv('mods:search', opts),
    project: (id: string): Promise<CatalogProject> => inv('mods:project', id),
    versions: (id: string, gameVersion?: string, loader?: string): Promise<CatalogVersion[]> =>
      inv('mods:versions', id, gameVersion, loader),
    version: (versionId: string): Promise<CatalogVersion> =>
      inv('mods:version', versionId),
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
    > => inv('mods:installMod', payload),
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
    > => inv('mods:installModsBatch', payload),
    onDownloadProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('mods:downloadProgress', listener)
      return () => {
        ipcRenderer.removeListener('mods:downloadProgress', listener)
      }
    },
  },
  shell: {
    openExternal: (url: string): Promise<void> => inv('shell:openExternal', url),
    /** Any HTTPS (ads / payment) — user-initiated only. */
    openHttps: (url: string): Promise<void> => inv('shell:openHttps', url),
    openInstanceFolder: (instanceId: string): Promise<void> =>
      inv('shell:openInstanceFolder', instanceId),
    openInstancePath: (
      instanceId: string,
      sub?: 'root' | 'mods' | 'screenshots' | 'logs' | 'resourcepacks',
    ): Promise<void> => inv('shell:openInstancePath', instanceId, sub),
  },
  featured: {
    getStatus: (slug?: string) => inv('featured:status', slug),
    install: async (payload?: { slug?: string; versionId?: string }) => {
      const result = await inv<{
        ok: boolean
        instanceId?: string
        versionNumber?: string
        error?: string
      }>('featured:install', payload || {})
      if (!result || result.ok === false) {
        throw new Error(result?.error || 'Pack install failed')
      }
      return result
    },
    onInstallProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('featured:installProgress', listener)
      return () => {
        ipcRenderer.removeListener('featured:installProgress', listener)
      }
    },
  },
  partners: {
    list: (): Promise<PartnerDefinition[]> => inv('partners:list'),
    listConfig: (force?: boolean): Promise<PartnerConfig[]> =>
      inv('partners:listConfig', force),
    getStatus: (id: string) => inv('partners:status', id),
    install: (id: string) => inv('partners:install', id),
    prepareJoin: (
      id: string,
    ): Promise<{ instanceId: string; serverAddress: string; serverName: string }> =>
      inv('partners:prepareJoin', id),
    listEvents: (partnerId?: string): Promise<
      import('../shared/types').PartnerEvent[]
    > => inv('partners:listEvents', partnerId),
    onInstallProgress: (cb: (event: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ProgressEvent) => cb(event)
      ipcRenderer.on('partners:installProgress', listener)
      return () => {
        ipcRenderer.removeListener('partners:installProgress', listener)
      }
    },
  },
  updater: {
    getStatus: (): Promise<UpdateStatus> => inv('updater:getStatus'),
    getVersion: (): Promise<AppVersionInfo> => inv('updater:getVersion'),
    check: (): Promise<UpdateStatus> => inv('updater:check'),
    download: (): Promise<UpdateStatus> => inv('updater:download'),
    install: (): Promise<UpdateStatus> => inv('updater:install'),
    apply: (): Promise<UpdateStatus> => inv('updater:apply'),
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
    ): Promise<NewsFeedResult> => inv('news:fetch', opts),
    defaultUrl: (): Promise<string> => inv('news:defaultUrl'),
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
    > => inv('partnerAuth:login', username, password),
    logout: (sessionToken: string): Promise<boolean> =>
      inv('partnerAuth:logout', sessionToken),
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
    > => inv('partnerAuth:status', sessionToken),
    loadNews: (
      sessionToken: string,
    ): Promise<
      { ok: true; feed: NewsFeedResult; newsTag: string } | { ok: false; error: string }
    > => inv('partnerAuth:loadNews', sessionToken),
    publish: (
      sessionToken: string,
      items: NewsItem[],
    ): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> =>
      inv('partnerAuth:publish', sessionToken, items),
    newId: (): Promise<string> => inv('partnerAuth:newId'),
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
    ) => inv('partnerAuth:upsertEvent', sessionToken, input),
    deleteEvent: (sessionToken: string, eventId: string) =>
      inv('partnerAuth:deleteEvent', sessionToken, eventId),
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
    > => inv('admin:login', password),
    logout: (sessionToken: string): Promise<boolean> =>
      inv('admin:logout', sessionToken),
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
    }> => inv('admin:status', sessionToken),
    /** Reset idle timeout (call on clicks / typing). */
    touchSession: (
      sessionToken: string,
    ): Promise<{ ok: true; expiresAt: number } | { ok: false; error: string }> =>
      inv('admin:touchSession', sessionToken),
    setCmsApiKey: (
      sessionToken: string,
      key: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      inv('admin:setCmsApiKey', sessionToken, key),
    loadNews: (
      sessionToken: string,
    ): Promise<{ ok: true; feed: NewsFeedResult } | { ok: false; error: string }> =>
      inv('admin:loadNews', sessionToken),
    publishNews: (
      sessionToken: string,
      items: NewsItem[],
      title?: string,
    ): Promise<
      { ok: true; commitUrl?: string; message: string } | { ok: false; error: string }
    > => inv('admin:publishNews', sessionToken, items, title),
    newId: (): Promise<string> => inv('admin:newId'),
    listPartners: (
      sessionToken: string,
    ): Promise<{ ok: true; partners: PartnerConfig[] } | { ok: false; error: string }> =>
      inv('admin:listPartners', sessionToken),
    upsertPartner: (
      sessionToken: string,
      input: Record<string, unknown>,
    ): Promise<{ ok: true; partner: PartnerConfig } | { ok: false; error: string }> => {
      return inv('admin:upsertPartner', sessionToken, input)
    },
    deletePartner: (
      sessionToken: string,
      partnerId: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      return inv('admin:deletePartner', sessionToken, partnerId)
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
      return inv('admin:uploadImage', sessionToken, input ?? null)
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
            instanceQuota?: number
            modQuota?: number
          }>
          unlockPasswordConfigured: boolean
          remoteSynced: boolean
          cmsOnline: boolean
          userCount: number
          error?: string
        }
      | { ok: false; error: string; cmsOnline?: boolean }
    > => {
      return inv('admin:listOfflineUsers', sessionToken)
    },
    createOfflineUser: (
      sessionToken: string,
      username: string,
      password: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      return inv('admin:createOfflineUser', sessionToken, username, password)
    },
    deleteOfflineUser: (
      sessionToken: string,
      userId: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      return inv('admin:deleteOfflineUser', sessionToken, userId)
    },
    updateOfflineUser: (
      sessionToken: string,
      input: {
        id: string
        username?: string
        displayName?: string
        password?: string
        instanceQuota?: number
        modQuota?: number
      },
    ): Promise<
      | {
          ok: true
          message: string
          user: {
            id: string
            username: string
            uuid: string
            displayName: string
            instanceQuota: number
            modQuota: number
          }
        }
      | { ok: false; error: string }
    > => {
      return inv('admin:updateOfflineUser', sessionToken, input)
    },
    setOfflineUnlockPassword: (
      sessionToken: string,
      password: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
      return inv('admin:setOfflineUnlockPassword', sessionToken, password)
    },
    publishOfflineAuth: (
      sessionToken: string,
    ): Promise<{ ok: true; message: string; commitUrl?: string } | { ok: false; error: string }> => {
      return inv('admin:publishOfflineAuth', sessionToken)
    },
    listPartnerEvents: (
      sessionToken: string,
      partnerId?: string,
    ): Promise<
      | { ok: true; events: import('../shared/types').PartnerEvent[] }
      | { ok: false; error: string }
    > => {
      return inv('admin:listPartnerEvents', sessionToken, partnerId)
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
      return inv('admin:upsertPartnerEvent', sessionToken, input)
    },
    deletePartnerEvent: (
      sessionToken: string,
      eventId: string,
    ): Promise<{ ok: true; message?: string } | { ok: false; error: string }> => {
      return inv('admin:deletePartnerEvent', sessionToken, eventId)
    },
    health: (
      sessionToken: string,
    ): Promise<
      | { ok: true; health: import('./services/healthDashboard').AdminHealthSnapshot }
      | { ok: false; error: string }
    > => {
      return inv('admin:health', sessionToken)
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
    > => inv('staff:login', username, password),
    staffLogout: () => inv('staff:logout'),
    staffMe: () => inv('staff:me'),
    staffForgotPassword: (
      username: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> =>
      inv('staff:forgotPassword', username),
    staffResetPassword: (
      username: string,
      code: string,
      newPassword: string,
    ): Promise<{ ok: true; message: string } | { ok: false; error: string }> =>
      inv('staff:resetPassword', username, code, newPassword),
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
    > => inv('staff:bindEmail', email),
    listStaffUsers: (sessionToken: string) => inv('staff:listUsers', sessionToken),
    createStaffUser: (
      sessionToken: string,
      input: {
        username: string
        password: string
        role: string
        offlineQuota?: number
        email?: string
      },
    ) => inv('staff:createUser', sessionToken, input),
    deleteStaffUser: (sessionToken: string, id: string) =>
      inv('staff:deleteUser', sessionToken, id),
    listApprovals: (sessionToken: string, status?: string) =>
      inv('staff:listApprovals', sessionToken, status),
    reviewApproval: (
      sessionToken: string,
      id: string,
      decision: 'approved' | 'rejected',
      note?: string,
    ) => inv('staff:reviewApproval', sessionToken, id, decision, note),
    submitApproval: (
      sessionToken: string,
      input: { type: string; summary: string; payload: unknown },
    ) => inv('staff:submitApproval', sessionToken, input),
    listFeaturedPacks: (all?: boolean) => inv('featured:listPacks', all),
    saveFeaturedPack: (sessionToken: string, pack: unknown) =>
      inv('featured:savePack', sessionToken, pack),
    deleteFeaturedPack: (sessionToken: string, id: string) =>
      inv('featured:deletePack', sessionToken, id),
    adsCreateCode: (sessionToken: string, input?: { days?: number; code?: string; note?: string }) =>
      inv('ads:createCode', sessionToken, input || {}),
    adsListClaims: (sessionToken: string) => inv('ads:listClaims', sessionToken),
    adsGrant: (
      sessionToken: string,
      input: { deviceId: string; days?: number; claimId?: string; note?: string },
    ) => inv('ads:grant', sessionToken, input),
    adsListCreatives: (sessionToken: string) =>
      inv('ads:listCreatives', sessionToken),
    adsSaveCreative: (sessionToken: string, creative: Record<string, unknown>) =>
      inv('ads:saveCreative', sessionToken, creative),
    adsDeleteCreative: (sessionToken: string, id: string) =>
      inv('ads:deleteCreative', sessionToken, id),
    adsGetNetwork: (sessionToken: string) =>
      inv('ads:getNetworkAdmin', sessionToken),
    adsSaveNetwork: (
      sessionToken: string,
      input: {
        enabled?: boolean
        provider?: string
        adsenseClient?: string
        adsenseSlot?: string
        customHtml?: string
      },
    ) => inv('ads:saveNetwork', sessionToken, input),
  },
  featuredPacks: {
    listPublic: () => inv('featured:listPublic'),
  },
  ads: {
    status: () => inv('ads:status'),
    local: () => inv('ads:local'),
    deviceId: () => inv('ads:deviceId'),
    redeem: (code: string) => inv('ads:redeem', code),
    claim: (input?: { email?: string; message?: string }) =>
      inv('ads:claim', input || {}),
    paypalCheckout: () => inv('ads:paypalCheckout'),
    inventory: (limit?: number) => inv('ads:inventory', limit),
    network: () => inv('ads:network'),
    track: (creativeId: string, event: 'impression' | 'click') =>
      inv('ads:track', creativeId, event),
  },
}

contextBridge.exposeInMainWorld('hive', api)

export type HiveApi = typeof api
