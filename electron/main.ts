import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
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
  createInstanceBackup,
  deleteInstanceBackup,
  listInstanceBackups,
  openBackupsFolder,
  restoreInstanceBackup,
} from './services/instanceBackup'
import { queryMinecraftServer } from './services/serverStatus'
import {
  checkFeaturedPackPlay,
  getFeaturedPackStatus,
  installFeaturedPack,
} from './services/featuredPack'
import {
  getPartnerStatus,
  installPartner,
  listPartnerDefinitions,
  preparePartnerJoin,
} from './services/partners'
import {
  deletePartnerConfig,
  fetchPartnerConfigs,
  upsertPartnerConfig,
} from './services/partnerConfig'
import { requireAdmin } from './services/admin'
import { installModWithDependencies } from './services/modInstall'
import {
  getProject,
  getProjectVersions,
  getVersion,
  searchMods,
} from './services/modrinth'
import { getSystemMemoryInfo, loadSettings, saveSettings } from './services/settings'
import {
  checkForUpdates,
  downloadUpdate,
  getAppVersionInfo,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  setUpdaterWindow,
  startPeriodicUpdateChecks,
  stopPeriodicUpdateChecks,
} from './services/updater'
import { fetchNews, getDefaultNewsFeedUrl, setNewsUpdateListener } from './services/news'
import {
  getAdminStatus,
  loadNewsForAdmin,
  logoutAdmin,
  newNewsId,
  publishNewsFeed,
  setCmsApiKeyForAdmin,
  verifyAdminPassword,
} from './services/admin'
import { uploadAdminImage } from './services/adminUpload'
import {
  getPartnerSessionInfo,
  loadPartnerNewsForEditor,
  newPartnerNewsId,
  partnerLogin,
  partnerLogout,
  publishPartnerNews,
  mirrorPartnerAuthToPublic,
} from './services/partnerAuth'
import {
  adminCreateOfflineUser,
  adminDeleteOfflineUser,
  adminPublishOfflineAuth,
  getOfflinePublicStatus,
  listOfflineUsersAdmin,
  lockOfflineMode,
  loginOfflineAccount,
  offlineMultiplayerWarning,
  setOfflineUnlockPassword,
  unlockOfflineMode,
} from './services/offlineAuth'
import { isAdminBuild } from '../shared/features'
import { getAdminUnlockInfo, isAdminAvailable } from './services/adminUnlock'
import type { NewsItem } from '../shared/types'
import { getInstanceModsDir } from './paths'

// Reduce GPU / compositor freezes on some Windows setups after install
if (process.platform === 'win32') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

// Only one instance — second launch focuses the first (avoids installer/double-start freezes)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../build/icon.png')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0b0e14',
    title: 'EG Launcher',
    autoHideMenuBar: true,
    show: false, // show after ready-to-show so Windows doesn't mark "Not responding"
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: false,
      backgroundThrottling: false,
    },
  })

  setUpdaterWindow(mainWindow)
  setNewsUpdateListener((kind, feed) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('news:updated', { kind, feed })
      }
    } catch {
      /* ignore */
    }
  })

  // Show as soon as the window is paintable
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    mainWindow.focus()
  })

  // Failsafe: never stay invisible if ready-to-show never fires
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 4000)

  const loadPromise = process.env.VITE_DEV_SERVER_URL
    ? mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    : mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))

  loadPromise.catch((err) => {
    console.error('[EG Launcher] failed to load UI', err)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    }
  })

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

  mainWindow.on('closed', () => {
    mainWindow = null
    setUpdaterWindow(null)
    setNewsUpdateListener(null)
  })

  // Init updater after the window exists; check much later so first paint is smooth
  mainWindow.webContents.once('did-finish-load', () => {
    try {
      initAutoUpdater(mainWindow)
    } catch (err) {
      console.warn('[updater] init on load failed', err)
    }
    // Delayed first check — never blocks startup
    setTimeout(() => {
      checkForUpdates(false)
        .catch((err) => console.warn('[updater] startup check', err))
        .finally(() => {
          // Then re-check every 5 minutes and notify when an update appears
          startPeriodicUpdateChecks()
        })
    }, 12_000)
  })
}

function sendProgress(channel: string, event: ProgressEvent) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, event)
    }
  } catch {
    /* ignore */
  }
}

function registerIpc() {
  // Settings
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', (_e, settings: LauncherSettings) => saveSettings(settings))
  ipcMain.handle('settings:systemMemory', () => getSystemMemoryInfo())

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

  // Offline (cracked) accounts — feature unlock + register/login
  ipcMain.handle('offline:status', () => getOfflinePublicStatus())
  ipcMain.handle('offline:unlock', async (_e, password: string) => unlockOfflineMode(password))
  ipcMain.handle('offline:lock', () => {
    lockOfflineMode()
    return getOfflinePublicStatus()
  })
  // Offline account creation is Admin-only (admin:createOfflineUser) — no public register
  ipcMain.handle('offline:login', async (_e, username: string, password: string) =>
    loginOfflineAccount(username, password),
  )
  ipcMain.handle('offline:warning', () => offlineMultiplayerWarning())

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
      sendProgress('mc:installProgress', {
        ...progress,
        message: `[${instance.name}] ${progress.message}`,
      })
    })
  })

  ipcMain.handle(
    'mc:launch',
    async (
      _e,
      instanceId: string,
      options?: { acknowledgeLowMemory?: boolean; quickPlayServer?: string },
    ) => {
      const instance = getInstance(instanceId)
      if (!instance) throw new Error('Instance not found')

      // Heavy featured pack (Bee's SMP): system / allocated RAM rules
      const packGate = checkFeaturedPackPlay(instanceId)
      if (packGate && 'error' in packGate) {
        return { success: false, message: packGate.error }
      }
      if (packGate && 'warning' in packGate && !options?.acknowledgeLowMemory) {
        return {
          success: false,
          message: packGate.warning,
          requiresConfirmation: true,
        }
      }

      const account = getActiveAccountSecret()
      const result = await launchInstance(instance, account, {
        quickPlayServer: options?.quickPlayServer,
      })
      if (result.success) {
        updateInstance(instanceId, { lastPlayed: new Date().toISOString() })
        // Soft warning for offline / cracked accounts (official servers won't work)
        if (
          account &&
          (account.type === 'offline' || String(account.id || '').startsWith('offline-'))
        ) {
          return {
            ...result,
            message: `${result.message}\n\n${offlineMultiplayerWarning()}`,
          }
        }
      }
      return result
    },
  )

  // Instance backups
  ipcMain.handle('instances:listBackups', (_e, instanceId: string) =>
    listInstanceBackups(instanceId),
  )
  ipcMain.handle(
    'instances:createBackup',
    async (_e, instanceId: string, opts?: { includeSaves?: boolean; label?: string }) => {
      return createInstanceBackup(instanceId, opts || {}, (progress) => {
        sendProgress('instances:backupProgress', progress)
      })
    },
  )
  ipcMain.handle(
    'instances:restoreBackup',
    async (_e, instanceId: string, backupId: string) => {
      return restoreInstanceBackup(instanceId, backupId, (progress) => {
        sendProgress('instances:backupProgress', progress)
      })
    },
  )
  ipcMain.handle('instances:deleteBackup', (_e, instanceId: string, backupId: string) =>
    deleteInstanceBackup(instanceId, backupId),
  )
  ipcMain.handle('instances:openBackupsFolder', async (_e, instanceId?: string) => {
    const dir = openBackupsFolder(instanceId)
    await shell.openPath(dir)
    return dir
  })

  // Minecraft server status (Server List Ping)
  ipcMain.handle('server:status', async (_e, address: string) => queryMinecraftServer(address))

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
        resolveDependencies: settings.resolveDependencies !== false,
        onProgress: (progress) => {
          sendProgress('modrinth:downloadProgress', progress)
        },
      })

      const mainFailed = result.failed.find((f) => f.projectId === payload.projectId)
      if (mainFailed && !result.installed.some((i) => i.projectId === payload.projectId)) {
        throw new Error(mainFailed.error)
      }

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
    const raw = String(url || '').trim()
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      throw new Error('Invalid URL')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only http(s) links are allowed')
    }
    const host = parsed.hostname.toLowerCase()
    const allowed =
      host === 'discord.gg' ||
      host === 'discord.com' ||
      host.endsWith('.discord.com') ||
      host === 'modrinth.com' ||
      host.endsWith('.modrinth.com') ||
      host === 'github.com' ||
      host.endsWith('.github.com') ||
      host.endsWith('.githubusercontent.com') ||
      host === 'microsoft.com' ||
      host.endsWith('.microsoft.com') ||
      host === 'live.com' ||
      host.endsWith('.live.com') ||
      host === 'xboxlive.com' ||
      host.endsWith('.xboxlive.com') ||
      host === 'minecraft.net' ||
      host.endsWith('.minecraft.net') ||
      host === 'mojang.com' ||
      host.endsWith('.mojang.com') ||
      host === 'client116.ddns.net'
    if (!allowed) {
      throw new Error(`Opening external host is not allowed: ${host}`)
    }
    await shell.openExternal(parsed.toString())
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

  // Partners (dynamic CMS list)
  ipcMain.handle('partners:list', async () => listPartnerDefinitions())
  ipcMain.handle('partners:listConfig', async (_e, force?: boolean) =>
    fetchPartnerConfigs(Boolean(force)),
  )
  ipcMain.handle('partners:prepareJoin', async (_e, id: string) => preparePartnerJoin(id))
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
  // Download stays async; progress is pushed via events so the window can repaint
  ipcMain.handle('updater:download', async () => downloadUpdate())
  ipcMain.handle('updater:install', () => {
    installUpdate()
    return true
  })

  // Remote news — public mirrors; optional kind=launcher|partners, optional tag filter
  ipcMain.handle(
    'news:fetch',
    async (
      _e,
      opts?: boolean | { force?: boolean; kind?: 'launcher' | 'partners'; tag?: string },
    ) => {
      if (typeof opts === 'boolean') return fetchNews({ force: opts })
      return fetchNews({
        force: Boolean(opts?.force),
        kind: opts?.kind || 'launcher',
        tag: opts?.tag,
      })
    },
  )
  ipcMain.handle('news:defaultUrl', () => getDefaultNewsFeedUrl())

  // Admin: Dev build + local unlock file only (public clones without unlock never get Admin)
  ipcMain.on('admin:isUnlocked', (event) => {
    event.returnValue = isAdminAvailable()
  })
  ipcMain.handle('admin:unlockInfo', () => getAdminUnlockInfo())

  if (isAdminAvailable()) {
    console.log('[EG Launcher] Admin ENABLED (Dev + local unlock file)')
    ipcMain.handle('admin:login', (_e, password: string) => verifyAdminPassword(password))
    ipcMain.handle('admin:logout', (_e, sessionToken: string) => {
      logoutAdmin(sessionToken)
      return true
    })
    ipcMain.handle('admin:status', (_e, sessionToken: string) => getAdminStatus(sessionToken))
    ipcMain.handle('admin:setCmsApiKey', (_e, sessionToken: string, key: string) =>
      setCmsApiKeyForAdmin(sessionToken, key),
    )
    ipcMain.handle('admin:loadNews', async (_e, sessionToken: string) => loadNewsForAdmin(sessionToken))
    ipcMain.handle(
      'admin:publishNews',
      async (_e, sessionToken: string, items: NewsItem[], title?: string) =>
        publishNewsFeed(sessionToken, items, title),
    )
    ipcMain.handle('admin:newId', () => newNewsId())
    ipcMain.handle('admin:mirrorPartnerAuth', async () => mirrorPartnerAuthToPublic())
    ipcMain.handle('admin:listPartners', async (_e, sessionToken: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      const partners = await fetchPartnerConfigs(true)
      return { ok: true as const, partners }
    })
    ipcMain.handle(
      'admin:upsertPartner',
      async (_e, sessionToken: string, input: unknown) =>
        upsertPartnerConfig(sessionToken, input as never, requireAdmin),
    )
    ipcMain.handle(
      'admin:deletePartner',
      async (_e, sessionToken: string, partnerId: string) =>
        deletePartnerConfig(sessionToken, partnerId, requireAdmin),
    )
    // Offline accounts CMS
    ipcMain.handle('admin:listOfflineUsers', async (_e, sessionToken: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      return listOfflineUsersAdmin()
    })
    ipcMain.handle(
      'admin:createOfflineUser',
      async (_e, sessionToken: string, username: string, password: string) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        return adminCreateOfflineUser(username, password)
      },
    )
    ipcMain.handle(
      'admin:deleteOfflineUser',
      async (_e, sessionToken: string, userId: string) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        return adminDeleteOfflineUser(userId)
      },
    )
    ipcMain.handle(
      'admin:setOfflineUnlockPassword',
      async (_e, sessionToken: string, password: string) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        return setOfflineUnlockPassword(password)
      },
    )
    ipcMain.handle(
      'admin:uploadImage',
      async (
        _e,
        sessionToken: string,
        input?:
          | { filePath: string }
          | { name: string; mime?: string; base64: string }
          | null,
      ) => uploadAdminImage(sessionToken, input),
    )
    ipcMain.handle('admin:publishOfflineAuth', async (_e, sessionToken: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      return adminPublishOfflineAuth()
    })
  } else {
    const info = getAdminUnlockInfo()
    console.log('[EG Launcher] Admin DISABLED:', info.reason)
  }

  // Partner news auth + editor (available Live + Dev; publish needs write token on PC)
  ipcMain.handle('partnerAuth:login', async (_e, username: string, password: string) =>
    partnerLogin(username, password),
  )
  ipcMain.handle('partnerAuth:logout', (_e, sessionToken: string) => {
    partnerLogout(sessionToken)
    return true
  })
  ipcMain.handle('partnerAuth:status', (_e, sessionToken: string) =>
    getPartnerSessionInfo(sessionToken),
  )
  ipcMain.handle('partnerAuth:loadNews', async (_e, sessionToken: string) =>
    loadPartnerNewsForEditor(sessionToken),
  )
  ipcMain.handle(
    'partnerAuth:publish',
    async (_e, sessionToken: string, items: NewsItem[]) =>
      publishPartnerNews(sessionToken, items),
  )
  ipcMain.handle('partnerAuth:newId', () => newPartnerNewsId())
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  // Defer migration so the window can open immediately (large legacy copies can block)
  try {
    const migration = migrateToHiveLauncher()
    if (migration.migrated) {
      console.log('[EG Launcher] Migration:', migration.message)
    }
  } catch (err) {
    console.warn('[EG Launcher] Migration error (continuing):', err)
  }

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopPeriodicUpdateChecks()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
