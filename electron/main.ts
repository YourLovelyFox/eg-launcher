import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { migrateToHiveLauncher } from './migrate'
import type {
  GameInstance,
  LauncherSettings,
  LoaderType,
  ProgressEvent,
} from '../shared/types'
import {
  getAccounts,
  pollDeviceCodeLogin,
  removeAccount,
  setActiveAccount,
  startDeviceCodeLogin,
  getActiveAccountSecret,
} from './services/auth'
import {
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  removeModFromInstance,
  toggleMod,
  updateInstance,
} from './services/instances'
import { findJava, getJavaVersion } from './services/java'
import {
  forceClearRunningGame,
  getRunningGameInfo,
  installInstanceRuntime,
  launchInstance,
  listLoaderVersions,
  listMinecraftVersions,
} from './services/minecraft'
import {
  getFeaturedPackStatus,
  installFeaturedPack,
} from './services/featuredPack'
import { getPartnerStatus, installPartner } from './services/partners'
import { installModWithDependencies } from './services/modInstall'
import {
  getProject,
  getProjectVersions,
  getVersion,
  searchMods,
} from './services/modrinth'
import { loadSettings, saveSettings } from './services/settings'
import {
  checkForUpdates,
  downloadUpdate,
  getAppVersionInfo,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  setUpdaterWindow,
} from './services/updater'
import { getInstanceModsDir } from './paths'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0b0e14',
    title: 'EG Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: false,
    },
  })

  setUpdaterWindow(mainWindow)
  initAutoUpdater(mainWindow)

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Never open DevTools (including F12 / Ctrl+Shift+I)
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow?.webContents.closeDevTools()
  })
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key?.toLowerCase()
    if (
      key === 'f12' ||
      (input.control && input.shift && (key === 'i' || key === 'j' || key === 'c')) ||
      (input.control && key === 'u')
    ) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Background update check a few seconds after UI is ready
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      checkForUpdates(false).catch((err) => console.warn('[updater] startup check', err))
    }, 4000)
  })
}

function sendProgress(channel: string, event: ProgressEvent) {
  mainWindow?.webContents.send(channel, event)
}

function registerIpc() {
  // Settings
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', (_e, settings: LauncherSettings) => saveSettings(settings))

  // Java
  ipcMain.handle('java:find', async () => findJava())
  ipcMain.handle('java:version', async (_e, javaPath: string) => getJavaVersion(javaPath))

  // Auth
  ipcMain.handle('auth:getAccounts', () => getAccounts())
  ipcMain.handle('auth:setActive', (_e, id: string | null) => {
    setActiveAccount(id)
    return getAccounts()
  })
  ipcMain.handle('auth:remove', (_e, id: string) => {
    removeAccount(id)
    return getAccounts()
  })
  ipcMain.handle('auth:startDeviceCode', async () => startDeviceCodeLogin())
  ipcMain.handle('auth:pollDeviceCode', async (_e, deviceCode: string) => pollDeviceCodeLogin(deviceCode))

  // Instances
  ipcMain.handle('instances:list', () => listInstances())
  ipcMain.handle('instances:get', (_e, id: string) => getInstance(id))
  ipcMain.handle(
    'instances:create',
    (
      _e,
      input: { name: string; gameVersion: string; loader: LoaderType; loaderVersion?: string },
    ) => createInstance(input),
  )
  ipcMain.handle('instances:update', (_e, id: string, patch: Partial<GameInstance>) =>
    updateInstance(id, patch),
  )
  ipcMain.handle('instances:delete', (_e, id: string) => {
    deleteInstance(id)
    return true
  })
  ipcMain.handle('instances:toggleMod', (_e, instanceId: string, projectId: string, enabled: boolean) =>
    toggleMod(instanceId, projectId, enabled),
  )
  ipcMain.handle('instances:removeMod', (_e, instanceId: string, projectId: string) =>
    removeModFromInstance(instanceId, projectId),
  )

  // Minecraft versions / loaders
  ipcMain.handle('mc:listVersions', async () => listMinecraftVersions())
  ipcMain.handle('mc:listLoaders', async (_e, loader: LoaderType, gameVersion: string) =>
    listLoaderVersions(loader, gameVersion),
  )

  ipcMain.handle('mc:install', async (_e, instanceId: string) => {
    const instance = getInstance(instanceId)
    if (!instance) throw new Error('Instance not found')
    return installInstanceRuntime(instance, (progress) => {
      sendProgress('mc:installProgress', { ...progress, message: `[${instance.name}] ${progress.message}` })
    })
  })

  ipcMain.handle('mc:launch', async (_e, instanceId: string) => {
    const instance = getInstance(instanceId)
    if (!instance) throw new Error('Instance not found')
    const account = getActiveAccountSecret()
    const result = await launchInstance(instance, account)
    if (result.success) {
      updateInstance(instanceId, { lastPlayed: new Date().toISOString() })
    }
    return result
  })

  ipcMain.handle('mc:forceStop', () => forceClearRunningGame())
  ipcMain.handle('mc:running', () => getRunningGameInfo())

  // Modrinth
  ipcMain.handle(
    'modrinth:search',
    async (
      _e,
      opts: {
        query?: string
        gameVersion?: string
        loader?: string
        offset?: number
        limit?: number
        index?: string
      },
    ) => searchMods(opts),
  )
  ipcMain.handle('modrinth:project', async (_e, id: string) => getProject(id))
  ipcMain.handle(
    'modrinth:versions',
    async (_e, id: string, gameVersion?: string, loader?: string) =>
      getProjectVersions(id, gameVersion, loader),
  )
  ipcMain.handle('modrinth:version', async (_e, versionId: string) => getVersion(versionId))

  ipcMain.handle(
    'modrinth:installMod',
    async (
      _e,
      payload: {
        instanceId: string
        projectId: string
        versionId: string
      },
    ) => {
      const settings = loadSettings()
      const result = await installModWithDependencies({
        instanceId: payload.instanceId,
        projectId: payload.projectId,
        versionId: payload.versionId,
        // Always install required deps unless user turned the setting off
        resolveDependencies: settings.resolveDependencies !== false,
        onProgress: (progress) => {
          sendProgress('modrinth:downloadProgress', progress)
        },
      })

      // Surface hard failures for the main mod
      const mainFailed = result.failed.find((f) => f.projectId === payload.projectId)
      if (mainFailed && !result.installed.some((i) => i.projectId === payload.projectId)) {
        throw new Error(mainFailed.error)
      }

      // Return instance for UI compatibility, plus install summary
      return {
        ...result.instance,
        _installSummary: {
          installed: result.installed,
          skipped: result.skipped,
          failed: result.failed,
        },
      }
    },
  )

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:openInstanceFolder', async (_e, instanceId: string) => {
    const dir = getInstanceModsDir(instanceId)
    await shell.openPath(path.dirname(dir))
  })

  // Featured permanent pack (Bee's SMP)
  ipcMain.handle('featured:status', async (_e, slug?: string) =>
    getFeaturedPackStatus(slug || undefined),
  )
  ipcMain.handle(
    'featured:install',
    async (_e, payload: { slug?: string; versionId?: string } = {}) => {
      return installFeaturedPack(payload, (progress) => {
        sendProgress('featured:installProgress', progress)
      })
    },
  )

  // Partners (e.g. Horizons SMP)
  ipcMain.handle('partners:status', async (_e, id: string) => getPartnerStatus(id))
  ipcMain.handle('partners:install', async (_e, id: string) => {
    return installPartner(id, (progress) => {
      sendProgress('partners:installProgress', progress)
    })
  })

  // App auto-update (NSIS / AppImage via GitHub Releases)
  ipcMain.handle('updater:getStatus', () => getUpdateStatus())
  ipcMain.handle('updater:getVersion', () => getAppVersionInfo())
  ipcMain.handle('updater:check', async () => checkForUpdates(true))
  ipcMain.handle('updater:download', async () => downloadUpdate())
  ipcMain.handle('updater:install', () => {
    installUpdate()
    return true
  })
}

app.whenReady().then(() => {
  // Migrate legacy data folders into EG Launcher userData
  const migration = migrateToHiveLauncher()
  if (migration.migrated) {
    console.log('[EG Launcher] Migration:', migration.message)
  }

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
