import { app, BrowserWindow, Notification } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'unavailable'; currentVersion: string }
  | {
      state: 'available'
      currentVersion: string
      version: string
      releaseName: string | null
      releaseNotes: string | null
      releaseDate: string | null
    }
  | {
      state: 'downloading'
      currentVersion: string
      version: string
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | {
      state: 'ready'
      currentVersion: string
      version: string
      releaseName: string | null
      releaseNotes: string | null
    }
  | { state: 'error'; message: string; currentVersion: string }

let mainWindow: BrowserWindow | null = null
let lastStatus: UpdateStatus = { state: 'idle' }
let configured = false
let checking = false
let downloading = false
/** Periodic background check (5 minutes). */
let autoCheckTimer: ReturnType<typeof setInterval> | null = null
const AUTO_CHECK_MS = 5 * 60 * 1000
/** Avoid spamming OS notifications for the same version. */
let lastNotifiedVersion: string | null = null

function currentVersion(): string {
  return app.getVersion()
}

function push(status: UpdateStatus) {
  lastStatus = status
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('updater:status', status)
    }
  } catch (err) {
    console.warn('[updater] push failed', err)
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Flatten electron-updater release notes for the UI.
 * Keep HTML/markdown as-is — the renderer sanitizes and displays HTML.
 */
function notesToString(notes: UpdateInfo['releaseNotes']): string | null {
  if (!notes) return null
  if (typeof notes === 'string') return notes.trim() || null
  if (Array.isArray(notes)) {
    const joined = notes
      .map((n) => {
        if (typeof n === 'string') return n
        return [n.version, n.note].filter(Boolean).join('\n')
      })
      .join('\n\n')
      .trim()
    return joined || null
  }
  return String(notes)
}

/**
 * Configure electron-updater for GitHub Releases (NSIS + AppImage).
 * No download until the user confirms.
 */
export function initAutoUpdater(win: BrowserWindow | null) {
  mainWindow = win

  if (!app.isPackaged) {
    lastStatus = {
      state: 'unavailable',
      currentVersion: currentVersion(),
    }
    return
  }

  if (configured) return
  configured = true

  try {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    // Differential packages often hang or corrupt on Windows — full download is safer
    autoUpdater.disableDifferentialDownload = true
    // Self-signed code signing (A1): Windows reports "root not trusted", so chain-based
    // verifyUpdateCodeSignature fails even when CN=EG Launcher matches. Installers remain
    // Authenticode-signed; re-enable when using a commercial OV/EV cert.
    // Property exists at runtime on Windows AppUpdater; typings omit it in some versions.
    ;(autoUpdater as unknown as { verifyUpdateCodeSignature?: boolean }).verifyUpdateCodeSignature =
      false
    // Avoid long SSL/DNS stalls blocking forever
    autoUpdater.requestHeaders = {
      'Cache-Control': 'no-cache',
    }

    autoUpdater.on('checking-for-update', () => {
      checking = true
      push({ state: 'checking' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      checking = false
      push({
        state: 'available',
        currentVersion: currentVersion(),
        version: info.version,
        releaseName: info.releaseName ?? null,
        releaseNotes: notesToString(info.releaseNotes),
        releaseDate: info.releaseDate ?? null,
      })
      notifyUpdateAvailable(info.version)
    })

    autoUpdater.on('update-not-available', () => {
      checking = false
      push({
        state: 'unavailable',
        currentVersion: currentVersion(),
      })
    })

    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      downloading = true
      const version =
        lastStatus.state === 'available' ||
        lastStatus.state === 'downloading' ||
        lastStatus.state === 'ready'
          ? lastStatus.version
          : ''
      // Throttle-ish: always push; renderer is cheap
      push({
        state: 'downloading',
        currentVersion: currentVersion(),
        version,
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      downloading = false
      checking = false
      push({
        state: 'ready',
        currentVersion: currentVersion(),
        version: info.version,
        releaseName: info.releaseName ?? null,
        releaseNotes: notesToString(info.releaseNotes),
      })
    })

    autoUpdater.on('error', (err: Error) => {
      checking = false
      downloading = false
      console.error('[updater]', err)
      push({
        state: 'error',
        message: err?.message || String(err),
        currentVersion: currentVersion(),
      })
    })
  } catch (err) {
    console.error('[updater] init failed', err)
    configured = false
    push({
      state: 'error',
      message: (err as Error).message,
      currentVersion: currentVersion(),
    })
  }
}

export function setUpdaterWindow(win: BrowserWindow | null) {
  mainWindow = win
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus
}

function notifyUpdateAvailable(version: string) {
  // One OS notification per version (modal still shows via status events)
  if (lastNotifiedVersion === version) return
  lastNotifiedVersion = version
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: 'EG Launcher update available',
      body: `Version ${version} is ready. Open the launcher to review and install.`,
      silent: false,
    })
    n.on('click', () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
      } catch {
        /* ignore */
      }
    })
    n.show()
  } catch (err) {
    console.warn('[updater] notification failed', err)
  }
}

/**
 * Background check every 5 minutes (packaged builds only).
 * Does not auto-download — user confirms in the update dialog.
 */
export function startPeriodicUpdateChecks(): void {
  if (!app.isPackaged) return
  if (autoCheckTimer) return
  autoCheckTimer = setInterval(() => {
    // Skip while busy or already downloaded / actively downloading
    if (checking || downloading) return
    if (lastStatus.state === 'downloading' || lastStatus.state === 'ready') return
    checkForUpdates(false)
      .then((status) => {
        // Re-push so the UI re-opens the dialog if the user chose "Later"
        if (status.state === 'available') {
          push({ ...status })
        }
      })
      .catch((err) => console.warn('[updater] periodic check failed', err))
  }, AUTO_CHECK_MS)
  // Don't prevent process exit
  if (typeof autoCheckTimer === 'object' && autoCheckTimer && 'unref' in autoCheckTimer) {
    try {
      ;(autoCheckTimer as NodeJS.Timeout).unref()
    } catch {
      /* ignore */
    }
  }
}

export function stopPeriodicUpdateChecks(): void {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer)
    autoCheckTimer = null
  }
}

export async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    const status: UpdateStatus = {
      state: 'unavailable',
      currentVersion: currentVersion(),
    }
    lastStatus = status
    push(status)
    return status
  }

  if (checking || downloading) return lastStatus

  try {
    if (!configured) initAutoUpdater(mainWindow)
    // Manual checks may re-notify the same version (user asked again)
    if (manual) lastNotifiedVersion = null
    // Never hang the app forever on a stuck GitHub request
    await withTimeout(autoUpdater.checkForUpdates().then(() => undefined), 45_000, 'Update check')
    // Events update lastStatus; if still "checking", mark unavailable
    if (lastStatus.state === 'checking' || lastStatus.state === 'idle') {
      checking = false
      const status: UpdateStatus = {
        state: 'unavailable',
        currentVersion: currentVersion(),
      }
      push(status)
      return status
    }
    return lastStatus
  } catch (err) {
    checking = false
    // Silent for background checks; keep last good status unless manual
    if (manual || lastStatus.state === 'idle' || lastStatus.state === 'checking') {
      const status: UpdateStatus = {
        state: 'error',
        message: (err as Error).message,
        currentVersion: currentVersion(),
      }
      push(status)
      return status
    }
    console.warn('[updater] background check error', err)
    return lastStatus
  }
}

/**
 * Start download after user confirmation.
 * Progress is pushed via events so the UI stays responsive.
 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return getUpdateStatus()
  }
  if (downloading) return lastStatus

  try {
    if (!configured) initAutoUpdater(mainWindow)
    downloading = true
    push({
      state: 'downloading',
      currentVersion: currentVersion(),
      version:
        lastStatus.state === 'available' || lastStatus.state === 'ready'
          ? lastStatus.version
          : '',
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
    })

    // Full package download; timeout after 15 minutes for slow links
    await withTimeout(autoUpdater.downloadUpdate().then(() => undefined), 15 * 60_000, 'Update download')
    downloading = false
    return lastStatus
  } catch (err) {
    downloading = false
    checking = false
    const status: UpdateStatus = {
      state: 'error',
      message: (err as Error).message,
      currentVersion: currentVersion(),
    }
    push(status)
    return status
  }
}

/**
 * Quit and run the NSIS/AppImage installer.
 * Deferred so the UI can close cleanly and Windows does not mark us "Not responding".
 */
export function installUpdate(): void {
  if (!app.isPackaged) return

  try {
    // isSilent=true avoids an interactive installer that waits on the still-running app
    // isForceRunAfter=true relaunches after install
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(true, true)
      } catch (err) {
        console.error('[updater] quitAndInstall failed', err)
        // Fallback: force quit so user can re-run installer manually
        app.exit(0)
      }
    }, 300)
  } catch (err) {
    console.error('[updater] installUpdate failed', err)
  }
}

export function getAppVersionInfo() {
  return {
    version: currentVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  }
}
