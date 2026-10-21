import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateStatus } from '../../shared/types'
import { notifyUpdateAvailable } from './updateNotify'

let updaterWin: BrowserWindow | null = null
let lastStatus: UpdateStatus = { state: 'idle' }
let configured = false
let checking = false
let downloading = false

function currentVersion(): string {
  return app.getVersion()
}

function emit(status: UpdateStatus): UpdateStatus {
  lastStatus = status
  try {
    if (updaterWin && !updaterWin.isDestroyed()) {
      updaterWin.webContents.send('updater:status', status)
    }
  } catch {
    /* ignore */
  }
  return status
}

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

function availableFromInfo(info: UpdateInfo): UpdateStatus {
  return {
    state: 'available',
    currentVersion: currentVersion(),
    version: info.version,
    tag: `v${info.version}`,
    releaseName: info.releaseName ?? null,
    releaseNotes: notesToString(info.releaseNotes),
    releaseDate: info.releaseDate ?? null,
    assetName: `EG-Launcher-${info.version}-win-x64-setup.exe`,
    assetSize: 0,
  }
}

export function setNsisUpdaterWindow(win: BrowserWindow | null): void {
  updaterWin = win
}

export function getNsisUpdateStatus(): UpdateStatus {
  return lastStatus
}

/** GitHub NSIS auto-update. Download only after the user confirms. */
export function initNsisUpdater(win: BrowserWindow | null): void {
  updaterWin = win
  if (!app.isPackaged) {
    emit({ state: 'unavailable', currentVersion: currentVersion(), reason: 'dev' })
    return
  }
  if (configured) return
  configured = true

  try {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.disableDifferentialDownload = true
    autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache' }

    autoUpdater.on('checking-for-update', () => {
      checking = true
      emit({ state: 'checking' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      checking = false
      emit(availableFromInfo(info))
      notifyUpdateAvailable(info.version)
    })

    autoUpdater.on('update-not-available', () => {
      checking = false
      emit({ state: 'unavailable', currentVersion: currentVersion(), reason: 'up-to-date' })
    })

    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      downloading = true
      const version =
        lastStatus.state === 'available' ||
        lastStatus.state === 'downloading' ||
        lastStatus.state === 'ready'
          ? lastStatus.version
          : ''
      emit({
        state: 'downloading',
        currentVersion: currentVersion(),
        version,
        tag: version ? `v${version}` : '',
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      downloading = false
      checking = false
      emit({
        state: 'ready',
        currentVersion: currentVersion(),
        version: info.version,
        tag: `v${info.version}`,
        releaseName: info.releaseName ?? null,
        releaseNotes: notesToString(info.releaseNotes),
      })
    })

    autoUpdater.on('error', (err: Error) => {
      checking = false
      downloading = false
      console.error('[updater:nsis]', err)
      emit({
        state: 'error',
        message: err?.message || String(err),
        currentVersion: currentVersion(),
      })
    })
  } catch (err) {
    configured = false
    emit({
      state: 'error',
      message: (err as Error).message || String(err),
      currentVersion: currentVersion(),
    })
  }
}

export async function checkNsisUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return emit({ state: 'unavailable', currentVersion: currentVersion(), reason: 'dev' })
  }
  if (checking || downloading) return lastStatus
  try {
    if (!configured) initNsisUpdater(updaterWin)
    await withTimeout(autoUpdater.checkForUpdates().then(() => undefined), 45_000, 'Update check')
    if (lastStatus.state === 'checking' || lastStatus.state === 'idle') {
      checking = false
      return emit({
        state: 'unavailable',
        currentVersion: currentVersion(),
        reason: 'up-to-date',
      })
    }
    return lastStatus
  } catch (err) {
    checking = false
    return emit({
      state: 'error',
      message: (err as Error).message || String(err),
      currentVersion: currentVersion(),
    })
  }
}

export async function downloadNsisUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) return getNsisUpdateStatus()
  if (downloading) return lastStatus
  try {
    if (!configured) initNsisUpdater(updaterWin)
    downloading = true
    const version =
      lastStatus.state === 'available' || lastStatus.state === 'ready' ? lastStatus.version : ''
    emit({
      state: 'downloading',
      currentVersion: currentVersion(),
      version,
      tag: version ? `v${version}` : '',
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
    })
    await withTimeout(autoUpdater.downloadUpdate().then(() => undefined), 15 * 60_000, 'Update download')
    downloading = false
    return lastStatus
  } catch (err) {
    downloading = false
    checking = false
    return emit({
      state: 'error',
      message: (err as Error).message || String(err),
      currentVersion: currentVersion(),
    })
  }
}

export function installNsisUpdate(): UpdateStatus {
  if (!app.isPackaged) return getNsisUpdateStatus()
  const version =
    lastStatus.state === 'ready' || lastStatus.state === 'available' || lastStatus.state === 'downloading'
      ? lastStatus.version
      : currentVersion()
  emit({
    state: 'installing',
    currentVersion: currentVersion(),
    version,
    tag: `v${version}`,
  })
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(true, true)
    } catch (err) {
      console.error('[updater:nsis] quitAndInstall failed', err)
      app.exit(0)
    }
  }, 300)
  return lastStatus
}

export async function applyNsisUpdate(): Promise<UpdateStatus> {
  const ready = lastStatus.state === 'ready' ? lastStatus : await downloadNsisUpdate()
  if (ready.state === 'error' || ready.state !== 'ready') return ready
  return installNsisUpdate()
}
