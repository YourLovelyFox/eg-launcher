import { app, shell } from 'electron'
import { GITHUB_RELEASES_URL, MS_STORE_URL } from '../../shared/branding'
import { isMicrosoftStoreInstall } from './distribution'
import type { UpdateStatus } from '../../shared/types'

/**
 * In-app GitHub auto-update (electron-updater) is disabled.
 * Windows is expected to update via the Microsoft Store.
 * Other builds open the releases page for a manual download.
 */

let lastStatus: UpdateStatus = { state: 'idle' }

function currentVersion(): string {
  return app.getVersion()
}

function unavailable(): UpdateStatus {
  const status: UpdateStatus = {
    state: 'unavailable',
    currentVersion: currentVersion(),
  }
  lastStatus = status
  return status
}

export function initAutoUpdater(_win: unknown): void {
  unavailable()
}

export function setUpdaterWindow(_win: unknown): void {
  /* no-op */
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus.state === 'idle' ? unavailable() : lastStatus
}

export function startPeriodicUpdateChecks(): void {
  /* no-op — Store / manual only */
}

export function stopPeriodicUpdateChecks(): void {
  /* no-op */
}

/**
 * Manual "check": open Microsoft Store (Store installs) or GitHub Releases (other).
 * Never downloads or installs via electron-updater.
 */
export async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  const status = unavailable()
  if (!manual) return status

  try {
    if (isMicrosoftStoreInstall() || process.platform === 'win32') {
      await shell.openExternal(MS_STORE_URL)
    } else {
      await shell.openExternal(GITHUB_RELEASES_URL)
    }
  } catch {
    /* ignore */
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  return unavailable()
}

export function installUpdate(): void {
  /* no-op */
}

export function getAppVersionInfo() {
  return {
    version: currentVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    microsoftStore: isMicrosoftStoreInstall(),
    /** Always false — in-app GitHub auto-update removed */
    selfUpdateChannel: false,
  }
}
