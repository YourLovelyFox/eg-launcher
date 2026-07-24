import type { LauncherTheme } from '../shared/types'

const THEMES: LauncherTheme[] = ['dark', 'light', 'high-contrast']

export function normalizeTheme(value?: string | null): LauncherTheme {
  if (value && THEMES.includes(value as LauncherTheme)) return value as LauncherTheme
  return 'dark'
}

export function applyTheme(theme?: string | null): LauncherTheme {
  const t = normalizeTheme(theme)
  document.documentElement.setAttribute('data-theme', t)
  try {
    localStorage.setItem('eg-theme', t)
  } catch {
    /* ignore */
  }
  return t
}

export function readStoredTheme(): LauncherTheme {
  try {
    return normalizeTheme(localStorage.getItem('eg-theme'))
  } catch {
    return 'dark'
  }
}
