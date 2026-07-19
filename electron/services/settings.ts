import path from 'path'
import { app } from 'electron'
import type { LauncherSettings } from '../../shared/types'
import { getSettingsPath, readJsonFile, writeJsonFile } from '../paths'

const DEFAULT_SETTINGS: LauncherSettings = {
  ramMinMb: 512,
  ramMaxMb: 4096,
  javaPath: '',
  gameDirectory: '',
  closeOnLaunch: false,
  resolveDependencies: true,
}

export function getDefaultSettings(): LauncherSettings {
  return {
    ...DEFAULT_SETTINGS,
    gameDirectory: path.join(app.getPath('userData'), 'eg-data'),
  }
}

export function loadSettings(): LauncherSettings {
  const defaults = getDefaultSettings()
  const stored = readJsonFile<Partial<LauncherSettings>>(getSettingsPath(), {})
  return { ...defaults, ...stored }
}

export function saveSettings(settings: LauncherSettings): LauncherSettings {
  const merged = { ...getDefaultSettings(), ...settings }
  writeJsonFile(getSettingsPath(), merged)
  return merged
}
