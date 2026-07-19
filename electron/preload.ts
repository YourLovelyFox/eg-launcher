import { contextBridge, ipcRenderer } from 'electron'
import type {
  DeviceCodeResponse,
  GameInstance,
  LauncherSettings,
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
} from '../shared/types'

const api = {
  settings: {
    get: (): Promise<LauncherSettings> => ipcRenderer.invoke('settings:get'),
    save: (settings: LauncherSettings): Promise<LauncherSettings> =>
      ipcRenderer.invoke('settings:save', settings),
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
    launch: (instanceId: string): Promise<LaunchResult> =>
      ipcRenderer.invoke('mc:launch', instanceId),
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
}

contextBridge.exposeInMainWorld('hive', api)

export type HiveApi = typeof api
