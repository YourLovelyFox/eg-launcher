import { app } from 'electron'
import path from 'path'

/**
 * Microsoft Store / MSIX installs live under WindowsApps.
 * Updates come from the Store — no in-app updater.
 */
export function isMicrosoftStoreInstall(): boolean {
  if (process.env.EG_MS_STORE === '1' || process.env.EG_MS_STORE === 'true') {
    return true
  }
  // Electron sets this for AppX / Windows Store packages
  try {
    if ((process as NodeJS.Process & { windowsStore?: boolean }).windowsStore) {
      return true
    }
  } catch {
    /* ignore */
  }
  const exe = process.execPath || ''
  if (/\\WindowsApps\\/i.test(exe)) return true
  try {
    // Packaged path under Program Files\WindowsApps\...
    const appPath = app.isPackaged ? app.getAppPath() : ''
    if (/\\WindowsApps\\/i.test(appPath)) return true
    if (/\\WindowsApps\\/i.test(path.dirname(exe))) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * In-app self-update (electron-updater / GitHub) is disabled.
 * Windows updates are handled by the Microsoft Store.
 */
export function isSelfUpdateChannel(): boolean {
  return false
}
