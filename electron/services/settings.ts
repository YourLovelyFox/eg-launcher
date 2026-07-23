import path from 'path'
import { app } from 'electron'
import type { LauncherSettings } from '../../shared/types'
import { getSettingsPath, readJsonFile, writeJsonFile } from '../paths'
import { clampRamSettings, getSystemMemoryInfo } from './systemMemory'

const DEFAULT_SETTINGS: LauncherSettings = {
  ramMinMb: 2048,
  ramMaxMb: 4096,
  javaPath: '',
  gameDirectory: '',
  closeOnLaunch: false,
  resolveDependencies: true,
  /** Always on — offline login is on Account page (Admin-created users only). */
  offlineModeEnabled: true,
}

export function getDefaultSettings(): LauncherSettings {
  const mem = getSystemMemoryInfo()
  // Prefer 4 GB when allowed; otherwise use the system cap (e.g. ~3 GB on 6 GB PCs)
  const defaultMax = Math.min(4096, mem.maxAllowedMb)
  return clampRamSettings({
    ...DEFAULT_SETTINGS,
    ramMaxMb: defaultMax,
    gameDirectory: path.join(app.getPath('userData'), 'eg-data'),
  })
}

export function loadSettings(): LauncherSettings {
  const defaults = getDefaultSettings()
  const stored = readJsonFile<Partial<LauncherSettings>>(getSettingsPath(), {})
  return clampRamSettings({ ...defaults, ...stored })
}

export function saveSettings(settings: LauncherSettings): LauncherSettings {
  const merged = clampRamSettings({ ...getDefaultSettings(), ...settings })
  writeJsonFile(getSettingsPath(), merged)
  return merged
}

export { getSystemMemoryInfo } from './systemMemory'
