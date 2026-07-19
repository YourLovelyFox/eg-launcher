import { app, BrowserWindow } from 'electron'
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

function currentVersion(): string {
  return app.getVersion()
}

function push(status: UpdateStatus) {
  lastStatus = status
  mainWindow?.webContents.send('updater:status', status)
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

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // Public repo — no GH_TOKEN required for checking/downloading
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

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
  })

  autoUpdater.on('update-not-available', () => {
    checking = false
    push({
      state: 'unavailable',
      currentVersion: currentVersion(),
    })
  })

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const version =
      lastStatus.state === 'available' ||
      lastStatus.state === 'downloading' ||
      lastStatus.state === 'ready'
        ? lastStatus.version
        : ''
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
    console.error('[updater]', err)
    push({
      state: 'error',
      message: err?.message || String(err),
      currentVersion: currentVersion(),
    })
  })
}

export function setUpdaterWindow(win: BrowserWindow | null) {
  mainWindow = win
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus
}

export async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    const status: UpdateStatus = {
      state: 'unavailable',
      currentVersion: currentVersion(),
    }
    lastStatus = status
    if (manual) push(status)
    return status
  }

  if (checking) return lastStatus

  try {
    // ensure configured
    if (!configured) initAutoUpdater(mainWindow)
    const result = await autoUpdater.checkForUpdates()
    // Status events update lastStatus; if nothing fired, treat as unavailable
    if (!result) {
      const status: UpdateStatus = {
        state: 'unavailable',
        currentVersion: currentVersion(),
      }
      push(status)
      return status
    }
    return lastStatus
  } catch (err) {
    const status: UpdateStatus = {
      state: 'error',
      message: (err as Error).message,
      currentVersion: currentVersion(),
    }
    push(status)
    return status
  }
}

/** Start download after user confirmation. */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return getUpdateStatus()
  }
  if (lastStatus.state !== 'available' && lastStatus.state !== 'error') {
    // allow retry from error if an update was previously found
    if (lastStatus.state !== 'downloading') {
      // still try download if update is cached by electron-updater
    }
  }
  try {
    await autoUpdater.downloadUpdate()
    return lastStatus
  } catch (err) {
    const status: UpdateStatus = {
      state: 'error',
      message: (err as Error).message,
      currentVersion: currentVersion(),
    }
    push(status)
    return status
  }
}

/** Quit and install the downloaded update (user confirmed). */
export function installUpdate(): void {
  if (!app.isPackaged) return
  // isSilent=false, isForceRunAfter=true
  autoUpdater.quitAndInstall(false, true)
}

export function getAppVersionInfo() {
  return {
    version: currentVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  }
}
