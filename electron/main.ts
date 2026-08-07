import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
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
  ensureFreshActiveAccount,
  getMsAuthPublicInfo,
  setAuthProgressSink,
} from './services/auth'
import {
  addModToInstance,
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  removeModFromInstance,
  renameInstance,
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
import {
  defaultExportFileName,
  exportInstanceAsEgpack,
  importPackFile,
  listExportableContents,
  suggestedDownloadsDir,
} from './services/egpack'
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
  listPartnersForAdmin,
  upsertPartnerConfig,
} from './services/partnerConfig'
import { requireAdmin } from './services/admin'
import { installModWithDependencies, installModsBatch } from './services/modInstall'
import {
  CATALOG_SITE_ORIGIN,
  getProject,
  getProjectVersions,
  getVersion,
  searchMods,
} from './services/catalog'

function catalogSiteHost(): string {
  try {
    return new URL(CATALOG_SITE_ORIGIN).hostname
  } catch {
    return ''
  }
}
import { getSystemMemoryInfo, loadSettings, saveSettings } from './services/settings'
import {
  checkForUpdates,
  downloadUpdate,
  getAppVersionInfo,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  setUpdaterWindow,
  stopPeriodicUpdateChecks,
} from './services/updater'
import {
  adminDeletePartnerEvent,
  adminUpsertPartnerEvent,
  listPartnerEvents,
} from './services/partnerEvents'
import { getAdminHealthSnapshot } from './services/healthDashboard'
import {
  clearStaffSession,
  getStaffInfo,
  refreshStaffMe,
  staffBindEmail,
  staffForgotPassword,
  staffLogin,
  staffLogout,
  staffResetPassword,
} from './services/staffSession'
import { listApprovals, reviewApproval, staffMustQueue, submitApproval } from './services/approvals'
import {
  deleteFeaturedPack,
  listFeaturedPacks,
  saveFeaturedPack,
} from './services/featuredPacksRemote'
import {
  fetchAdInventory,
  fetchAdNetworkConfig,
  getDeviceId,
  getLocalAdFree,
  getPaypalCheckoutUrl,
  redeemAdCode,
  submitAdClaim,
  syncAdsStatus,
  trackAdEvent,
} from './services/adsService'
import { cmsRequest } from './services/cms/httpClient'
import { getStaffSessionToken } from './services/staffSession'
import { fetchNews, getDefaultNewsFeedUrl, setNewsUpdateListener } from './services/news'
import {
  getAdminStatus,
  loadNewsForAdmin,
  logoutAdmin,
  newNewsId,
  publishNewsFeed,
  setCmsApiKeyForAdmin,
  touchAdminSessionRemote,
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
import { getAdminUnlockInfo } from './services/adminUnlock'
import type { NewsItem } from '../shared/types'
import { getInstanceDir, getInstanceModsDir } from './paths'

/**
 * GPU / WebGL (Windows)
 * - Prefer hardware GPU (default). Avoids Chromium’s deprecated software-WebGL warning.
 * - Some broken drivers freeze the compositor; set EG_DISABLE_GPU=1 to force software.
 * - When software is forced, opt into SwiftShader so WebGL still works (ads, UI).
 */
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  const forceSoftware =
    process.env.EG_DISABLE_GPU === '1' ||
    process.env.EG_DISABLE_GPU === 'true' ||
    process.env.EG_FORCE_SOFTWARE_GL === '1'
  if (forceSoftware) {
    app.disableHardwareAcceleration()
    // Chromium 2024+: software WebGL requires explicit opt-in
    app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  }
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

  // No GitHub auto-updater — Windows updates via Microsoft Store.
  mainWindow.webContents.once('did-finish-load', () => {
    try {
      initAutoUpdater(mainWindow)
    } catch (err) {
      console.warn('[updater] init on load failed', err)
    }
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
  ipcMain.handle('auth:msInfo', () => getMsAuthPublicInfo())

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
  ipcMain.handle('instances:get', async (_e, id: string) => {
    const inst = getInstance(id)
    if (!inst) return null
    if (inst.mods.length === 0) return inst

    const hasLocal = inst.mods.some((m) => /^(local|import|disk)-/i.test(m.projectId || ''))
    const needsIcons = inst.mods.some(
      (m) =>
        m.projectId &&
        !/^(local|import|disk)-/i.test(m.projectId) &&
        (!m.iconUrl || !m.title || m.title === m.projectId || m.slug === m.projectId),
    )
    if (!hasLocal && !needsIcons) return inst

    try {
      const catalog = await import('./services/catalog')
      // Prefer fast batch project meta when ids are already known (no jar hashing)
      let mods = inst.mods
      if (needsIcons) {
        mods = await catalog.enrichModsWithProjectMeta(mods)
      }
      // Only hash jars for remaining synthetic local-* ids (expensive)
      if (hasLocal || mods.some((m) => /^(local|import|disk)-/i.test(m.projectId || ''))) {
        const modsDir = getInstanceModsDir(inst.id)
        mods = await catalog.repairInstalledModsMeta(mods, modsDir)
      }
      const changed = mods.some((m, i) => {
        const o = inst.mods[i]
        return (
          !o ||
          m.title !== o.title ||
          m.iconUrl !== o.iconUrl ||
          m.slug !== o.slug ||
          m.projectId !== o.projectId
        )
      })
      if (!changed) return { ...inst, mods }
      return updateInstance(inst.id, { mods })
    } catch {
      return inst
    }
  })
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
  ipcMain.handle('instances:rename', (_e, id: string, newName: string) => renameInstance(id, newName))
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

      // Refresh MSA session when near expiry so Store testers don't see "signed in" then fail launch
      const account = (await ensureFreshActiveAccount()) || getActiveAccountSecret()
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

  // Pack export (.egpack only) / import (.egpack + .mrpack)
  ipcMain.handle('instances:listExportContents', (_e, instanceId: string) =>
    listExportableContents(instanceId),
  )
  ipcMain.handle(
    'instances:exportEgpack',
    async (e, instanceId: string, exportOptions?: Partial<import('../shared/types').EgpackExportOptions>) => {
      const instance = getInstance(instanceId)
      if (!instance) throw new Error('Instance not found')
      const packName =
        (exportOptions?.packName || '').trim() || instance.name
      const win = BrowserWindow.fromWebContents(e.sender)
      const defaultPath = path.join(suggestedDownloadsDir(), defaultExportFileName(packName))
      const dialogOpts = {
        title: 'Export instance as .egpack',
        defaultPath,
        filters: [{ name: 'EG Launcher Pack', extensions: ['egpack'] }],
      }
      const result = win
        ? await dialog.showSaveDialog(win, dialogOpts)
        : await dialog.showSaveDialog(dialogOpts)
      if (result.canceled || !result.filePath) {
        return { ok: false as const, cancelled: true as const }
      }
      let dest = result.filePath
      if (!dest.toLowerCase().endsWith('.egpack')) dest = `${dest}.egpack`
      const out = await exportInstanceAsEgpack(
        instanceId,
        dest,
        (progress) => {
          sendProgress('instances:packProgress', progress)
        },
        exportOptions || null,
      )
      return { ok: true as const, path: out.path, size: out.size }
    },
  )

  ipcMain.handle(
    'instances:importPack',
    async (e, opts?: { filePath?: string; name?: string; installRuntime?: boolean }) => {
      let filePath = opts?.filePath?.trim() || ''
      if (!filePath) {
        const win = BrowserWindow.fromWebContents(e.sender)
        const dialogOpts = {
          title: 'Import pack (.egpack or .mrpack)',
          properties: ['openFile' as const],
          filters: [
            { name: 'Modpacks', extensions: ['egpack', 'mrpack'] },
            { name: 'EG Launcher Pack', extensions: ['egpack'] },
            { name: 'Mod pack', extensions: ['mrpack'] },
          ],
        }
        const result = win
          ? await dialog.showOpenDialog(win, dialogOpts)
          : await dialog.showOpenDialog(dialogOpts)
        if (result.canceled || !result.filePaths?.[0]) {
          return { ok: false as const, cancelled: true as const }
        }
        filePath = result.filePaths[0]
      }
      const imported = await importPackFile(
        filePath,
        { name: opts?.name, installRuntime: opts?.installRuntime },
        (progress) => {
          sendProgress('instances:packProgress', progress)
        },
      )
      return {
        ok: true as const,
        instance: imported.instance,
        format: imported.format,
      }
    },
  )

  // Minecraft server status (Server List Ping)
  ipcMain.handle('server:status', async (_e, address: string) => queryMinecraftServer(address))

  ipcMain.handle('mc:forceStop', () => forceClearRunningGame())
  ipcMain.handle('mc:running', () => getRunningGameInfo())

  // mod catalog
  ipcMain.handle(
    'mods:search',
    async (
      _e,
      opts: {
        query?: string
        gameVersion?: string
        loader?: string
        categories?: string[]
        offset?: number
        limit?: number
        index?: string
      },
    ) => searchMods(opts),
  )
  ipcMain.handle('mods:project', async (_e, id: string) => getProject(id))
  ipcMain.handle(
    'mods:versions',
    async (_e, id: string, gameVersion?: string, loader?: string) => {
      try {
        return await getProjectVersions(id, gameVersion, loader)
      } catch {
        // Never surface stack traces for missing/local mods — return empty version list
        return []
      }
    },
  )
  ipcMain.handle('mods:version', async (_e, versionId: string) => getVersion(versionId))

  ipcMain.handle(
    'mods:installMod',
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
          sendProgress('mods:downloadProgress', progress)
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

  /** Bulk update/install many mods as one parallel job ("Update all"). */
  ipcMain.handle(
    'mods:installModsBatch',
    async (
      _e,
      payload: {
        instanceId: string
        mods: Array<{ projectId: string; versionId: string }>
      },
    ) => {
      const settings = loadSettings()
      const result = await installModsBatch({
        instanceId: payload.instanceId,
        mods: payload.mods || [],
        resolveDependencies: settings.resolveDependencies !== false,
        concurrency: 6,
        onProgress: (progress) => {
          sendProgress('mods:downloadProgress', progress)
        },
      })

      if (result.installed.length === 0 && result.failed.length > 0) {
        const first = result.failed[0]?.error || 'Batch update failed'
        const rateLimited = result.failed.some((f) => /429|rate limit/i.test(f.error || ''))
        throw new Error(
          rateLimited
            ? `Mod catalog rate limit hit while preparing updates. Wait a few seconds and try Update all again. (${first})`
            : first,
        )
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
      host === catalogSiteHost() ||
      host.endsWith(`.${catalogSiteHost()}`) ||
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
      host === 'client116.ddns.net' ||
      // PayPal remove-ads checkout
      host === 'paypal.com' ||
      host.endsWith('.paypal.com') ||
      host === 'paypalobjects.com' ||
      host.endsWith('.paypalobjects.com')
    if (!allowed) {
      throw new Error(`Opening external host is not allowed: ${host}`)
    }
    await shell.openExternal(parsed.toString())
  })

  /** Any HTTPS URL — used for ad clicks / payment (user-initiated only). */
  ipcMain.handle('shell:openHttps', async (_e, url: string) => {
    const raw = String(url || '').trim()
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      throw new Error('Invalid URL')
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS links are allowed')
    }
    await shell.openExternal(parsed.toString())
  })

  ipcMain.handle('shell:openInstanceFolder', async (_e, instanceId: string) => {
    const dir = getInstanceModsDir(instanceId)
    await shell.openPath(path.dirname(dir))
  })
  ipcMain.handle(
    'shell:openInstancePath',
    async (_e, instanceId: string, sub?: 'root' | 'mods' | 'screenshots' | 'logs' | 'resourcepacks') => {
      const root = getInstanceDir(instanceId)
      let target = root
      if (sub === 'mods') target = getInstanceModsDir(instanceId)
      else if (sub === 'screenshots') {
        target = path.join(root, 'screenshots')
        fs.mkdirSync(target, { recursive: true })
      } else if (sub === 'logs') {
        target = path.join(root, 'logs')
        fs.mkdirSync(target, { recursive: true })
      } else if (sub === 'resourcepacks') {
        target = path.join(root, 'resourcepacks')
        fs.mkdirSync(target, { recursive: true })
      }
      await shell.openPath(target)
    },
  )
  /** Copy a local .jar into instance mods (simple drop install). */
  ipcMain.handle(
    'instances:installLocalJar',
    async (_e, instanceId: string, filePath: string) => {
      const inst = getInstance(instanceId)
      if (!inst) throw new Error('Instance not found')
      const src = path.resolve(filePath)
      if (!fs.existsSync(src) || !src.toLowerCase().endsWith('.jar')) {
        throw new Error('Only .jar mod files are supported for drag-and-drop right now')
      }
      const fileName = path.basename(src)
      const slug = fileName.replace(/\.jar$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const projectId = `local-${slug}`
      // Offline: local jars count as primary mods
      if (!inst.mods.some((m) => m.projectId === projectId)) {
        const { assertOfflineCanAddPrimaryMods } = await import('./services/offlineAuth')
        assertOfflineCanAddPrimaryMods(inst, 1)
      }
      const dest = path.join(getInstanceModsDir(instanceId), fileName)
      fs.copyFileSync(src, dest)
      const mod = {
        projectId,
        versionId: `local-${Date.now()}`,
        slug,
        title: fileName.replace(/\.jar$/i, ''),
        iconUrl: null,
        fileName,
        versionNumber: 'local',
        loaders: [inst.loader],
        gameVersions: [inst.gameVersion],
        enabled: true,
        downloadedAt: new Date().toISOString(),
        isDependency: false,
      }
      return addModToInstance(instanceId, mod)
    },
  )

  // Featured packs (public list for Live + Dev)
  ipcMain.handle('featured:listPublic', async () => listFeaturedPacks(false))

  // Ads (Live + Dev)
  ipcMain.handle('ads:status', async () => syncAdsStatus())
  ipcMain.handle('ads:local', () => getLocalAdFree())
  ipcMain.handle('ads:deviceId', () => getDeviceId())
  ipcMain.handle('ads:redeem', async (_e, code: string) => redeemAdCode(code))
  ipcMain.handle('ads:claim', async (_e, input: { email?: string; message?: string }) =>
    submitAdClaim(input || {}),
  )
  ipcMain.handle('ads:paypalCheckout', async () => getPaypalCheckoutUrl())
  ipcMain.handle('ads:inventory', async (_e, limit?: number) => fetchAdInventory(limit || 4))
  ipcMain.handle('ads:network', async () => fetchAdNetworkConfig())
  ipcMain.handle(
    'ads:track',
    async (_e, creativeId: string, event: 'impression' | 'click') => {
      await trackAdEvent(String(creativeId || ''), event === 'click' ? 'click' : 'impression')
      return { ok: true }
    },
  )

  // Featured permanent pack (Bee's SMP / CMS packs)
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

  // Version / open Store or releases (no in-app download/install)
  ipcMain.handle('updater:getStatus', () => getUpdateStatus())
  ipcMain.handle('updater:getVersion', () => getAppVersionInfo())
  ipcMain.handle('updater:check', async () => checkForUpdates(true))
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

  // Staff Menu: always available — gated by CMS staff accounts (Settings → Staff)
  ipcMain.on('admin:isUnlocked', (event) => {
    event.returnValue = true
  })
  ipcMain.handle('admin:unlockInfo', () => getAdminUnlockInfo())

  {
    console.log('[EG Launcher] Staff Menu ENABLED (CMS staff accounts)')
    ipcMain.handle('admin:login', (_e, password: string) => verifyAdminPassword(password))
    ipcMain.handle('admin:logout', (_e, sessionToken: string) => {
      logoutAdmin(sessionToken)
      return true
    })
    ipcMain.handle('admin:status', (_e, sessionToken: string) => getAdminStatus(sessionToken))
    ipcMain.handle('admin:touchSession', async (_e, sessionToken: string) =>
      touchAdminSessionRemote(sessionToken),
    )
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
      // Pure CMS list — never inject built-in Horizons/EG Forge after delete
      const partners = await listPartnersForAdmin()
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
    ipcMain.handle(
      'admin:listPartnerEvents',
      async (_e, sessionToken: string, partnerId?: string) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        try {
          const events = await listPartnerEvents(partnerId)
          return { ok: true as const, events }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
    )
    ipcMain.handle(
      'admin:upsertPartnerEvent',
      async (
        _e,
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
      ) => adminUpsertPartnerEvent(sessionToken, input, requireAdmin),
    )
    ipcMain.handle(
      'admin:deletePartnerEvent',
      async (_e, sessionToken: string, eventId: string) =>
        adminDeletePartnerEvent(sessionToken, eventId, requireAdmin),
    )
    ipcMain.handle('admin:health', async (_e, sessionToken: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      try {
        const health = await getAdminHealthSnapshot()
        return { ok: true as const, health }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    })

    // Staff role login (CMS accounts)
    ipcMain.handle('staff:login', async (_e, username: string, password: string) =>
      staffLogin(username, password),
    )
    ipcMain.handle('staff:logout', async () => {
      await staffLogout()
      return true
    })
    ipcMain.handle('staff:me', async () => {
      const staff = (await refreshStaffMe()) || getStaffInfo()
      return { staff, mustQueue: staffMustQueue() }
    })
    ipcMain.handle('staff:forgotPassword', async (_e, username: string) =>
      staffForgotPassword(username),
    )
    ipcMain.handle(
      'staff:resetPassword',
      async (_e, username: string, code: string, newPassword: string) =>
        staffResetPassword(username, code, newPassword),
    )
    ipcMain.handle('staff:bindEmail', async (_e, email: string) => staffBindEmail(email))
    ipcMain.handle('staff:listUsers', async (_e, sessionToken: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      try {
        const r = await cmsRequest<{ users?: unknown[] }>({
          path: 'staff.php?action=list',
          admin: true,
          sessionToken: getStaffSessionToken(),
        })
        return { ok: true as const, users: r.users || [] }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    })
    ipcMain.handle(
      'staff:createUser',
      async (
        _e,
        sessionToken: string,
        input: {
          username: string
          password: string
          role: string
          offlineQuota?: number
          email?: string
        },
      ) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        try {
          await cmsRequest({
            path: 'staff.php?action=create',
            method: 'POST',
            admin: true,
            sessionToken: getStaffSessionToken(),
            body: input,
          })
          return { ok: true as const, message: 'Staff user created' }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
    )
    ipcMain.handle('staff:deleteUser', async (_e, sessionToken: string, id: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      try {
        await cmsRequest({
          path: 'staff.php?action=delete',
          method: 'POST',
          admin: true,
          sessionToken: getStaffSessionToken(),
          body: { id },
        })
        return { ok: true as const }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    })
    ipcMain.handle('staff:listApprovals', async (_e, sessionToken: string, status?: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      return listApprovals(status || 'pending')
    })
    ipcMain.handle(
      'staff:reviewApproval',
      async (
        _e,
        sessionToken: string,
        id: string,
        decision: 'approved' | 'rejected',
        note?: string,
      ) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        return reviewApproval(id, decision, note)
      },
    )
    ipcMain.handle('staff:submitApproval', async (_e, sessionToken: string, input: unknown) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      return submitApproval(input as { type: string; summary: string; payload: unknown })
    })
    ipcMain.handle('featured:listPacks', async (_e, all?: boolean) => listFeaturedPacks(Boolean(all)))
    ipcMain.handle('featured:savePack', async (_e, sessionToken: string, pack: unknown) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      if (staffMustQueue()) {
        return submitApproval({
          type: 'featured_pack',
          summary: `Featured pack: ${(pack as { title?: string }).title || 'pack'}`,
          payload: pack,
        })
      }
      return saveFeaturedPack(pack as never)
    })
    ipcMain.handle('featured:deletePack', async (_e, sessionToken: string, id: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      if (staffMustQueue()) {
        return { ok: false as const, error: 'Staff cannot delete featured packs — ask an Admin' }
      }
      return deleteFeaturedPack(id)
    })
    ipcMain.handle(
      'ads:createCode',
      async (_e, sessionToken: string, input: { days?: number; code?: string; note?: string }) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        try {
          const r = await cmsRequest<{ code?: string; days?: number }>({
            path: 'ads.php?action=create_code',
            method: 'POST',
            admin: true,
            body: input || {},
          })
          return { ok: true as const, code: r.code, days: r.days }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
    )
    ipcMain.handle('ads:listClaims', async (_e, sessionToken: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      try {
        const r = await cmsRequest<{ claims?: unknown[] }>({
          path: 'ads.php?action=claims',
          admin: true,
        })
        return { ok: true as const, claims: r.claims || [] }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    })
    ipcMain.handle('ads:listCreatives', async (_e, sessionToken: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      try {
        const r = await cmsRequest<{ creatives?: unknown[] }>({
          path: 'ads.php?action=creatives',
          admin: true,
        })
        return { ok: true as const, creatives: r.creatives || [] }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    })
    ipcMain.handle('ads:getNetworkAdmin', async (_e, sessionToken: string) => {
      if (!requireAdmin(sessionToken)) {
        return { ok: false as const, error: 'Session expired — sign in again under Settings → Staff' }
      }
      try {
        const r = await cmsRequest<Record<string, unknown>>({
          path: 'ads.php?action=network',
          admin: true,
          sessionToken: getStaffSessionToken(),
        })
        return { ok: true as const, network: r }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    })
    ipcMain.handle(
      'ads:saveNetwork',
      async (
        _e,
        sessionToken: string,
        input: {
          enabled?: boolean
          provider?: string
          adsenseClient?: string
          adsenseSlot?: string
          customHtml?: string
        },
      ) => {
        if (!requireAdmin(sessionToken)) {
          return { ok: false as const, error: 'Session expired — sign in again under Settings → Staff' }
        }
        try {
          const r = await cmsRequest<{ provider?: string; enabled?: boolean }>({
            path: 'ads.php?action=save_network',
            method: 'POST',
            admin: true,
            sessionToken: getStaffSessionToken(),
            body: input || {},
          })
          return { ok: true as const, provider: r.provider, enabled: r.enabled }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
    )
    ipcMain.handle(
      'ads:saveCreative',
      async (_e, sessionToken: string, creative: Record<string, unknown>) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        try {
          const r = await cmsRequest<{ id?: string }>({
            path: 'ads.php?action=save_creative',
            method: 'POST',
            admin: true,
            body: creative || {},
          })
          return { ok: true as const, id: r.id }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
    )
    ipcMain.handle('ads:deleteCreative', async (_e, sessionToken: string, id: string) => {
      if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
      try {
        await cmsRequest({
          path: 'ads.php?action=delete_creative',
          method: 'POST',
          admin: true,
          body: { id },
        })
        return { ok: true as const }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    })
    ipcMain.handle(
      'ads:grant',
      async (
        _e,
        sessionToken: string,
        input: { deviceId: string; days?: number; claimId?: string; note?: string },
      ) => {
        if (!requireAdmin(sessionToken)) return { ok: false as const, error: 'Not authenticated' }
        try {
          const r = await cmsRequest<{ paidUntil?: string }>({
            path: 'ads.php?action=grant',
            method: 'POST',
            admin: true,
            body: input,
          })
          return { ok: true as const, paidUntil: r.paidUntil }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
    )
  }

  // Public partner events (Live + Dev)
  ipcMain.handle('partners:listEvents', async (_e, partnerId?: string) => {
    try {
      return await listPartnerEvents(partnerId)
    } catch {
      return []
    }
  })

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
  ipcMain.handle(
    'partnerAuth:upsertEvent',
    async (
      _e,
      sessionToken: string,
      input: {
        id?: string
        title: string
        description?: string
        startsAt: string
        endsAt?: string | null
        location?: string | null
      },
    ) => {
      const st = getPartnerSessionInfo(sessionToken)
      if (!st.authenticated) return { ok: false as const, error: 'Partner login required' }
      try {
        const r = await cmsRequest<{ event?: unknown; message?: string; error?: string }>({
          path: 'partner_events.php',
          method: 'POST',
          sessionToken,
          body: {
            action: 'upsert',
            partnerId: st.partnerId,
            ...input,
          },
        })
        if (!r.event) return { ok: false as const, error: r.error || 'Save failed' }
        return { ok: true as const, event: r.event, message: r.message }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    },
  )
  ipcMain.handle(
    'partnerAuth:deleteEvent',
    async (_e, sessionToken: string, eventId: string) => {
      const st = getPartnerSessionInfo(sessionToken)
      if (!st.authenticated) return { ok: false as const, error: 'Partner login required' }
      try {
        await cmsRequest({
          path: 'partner_events.php',
          method: 'POST',
          sessionToken,
          body: { action: 'delete', id: eventId },
        })
        return { ok: true as const }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    },
  )
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  // userData path must be set before any service reads disk (usually a no-op after first run)
  try {
    const migration = migrateToHiveLauncher()
    if (migration.migrated) {
      console.log('[EG Launcher] Migration:', migration.message)
    }
  } catch (err) {
    console.warn('[EG Launcher] Migration error (continuing):', err)
  }

  // Register IPC then open the window as soon as possible
  registerIpc()
  setAuthProgressSink((message) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.webContents.send('auth:progress', message)
      } catch {
        /* ignore */
      }
    }
  })
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
