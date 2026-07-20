import os from 'os'
import type { LauncherSettings, SystemMemoryInfo } from '../../shared/types'

const MB = 1024 * 1024

/** Fixed Minecraft heap minimum (-Xms). Not user-editable. */
export const FIXED_RAM_MIN_MB = 2048

/**
 * Detect physical RAM and compute max allocatable for Minecraft.
 *
 * Policy (by rounded system size):
 * - 6 / 8 / 12 GB (and anything ≤12 GB) → 50% of total
 * - 14 / 16 GB (and 13–16 GB) → 75% of total
 * - Above 16 GB → 75% (still leave headroom for the OS)
 */
export function getSystemMemoryInfo(): SystemMemoryInfo {
  const totalMb = Math.max(1024, Math.floor(os.totalmem() / MB))
  // Round to nearest whole GB so 7.7–8.2 classifies as 8, etc.
  const totalGbRounded = Math.max(1, Math.round(totalMb / 1024))

  let allowedPercent: number
  if (totalGbRounded <= 12) {
    // 6 GB, 8 GB, 12 GB (and lower)
    allowedPercent = 50
  } else if (totalGbRounded <= 16) {
    // 14 GB, 16 GB
    allowedPercent = 75
  } else {
    allowedPercent = 75
  }

  // Floor to 256 MB steps so the Settings sliders stay clean
  let maxAllowedMb = Math.floor((totalMb * allowedPercent) / 100)
  maxAllowedMb = Math.max(512, Math.floor(maxAllowedMb / 256) * 256)

  return {
    totalMb,
    totalGbRounded,
    maxAllowedMb,
    allowedPercent,
  }
}

/** Clamp max RAM to the system cap; always force min RAM to 2 GB (hidden). */
export function clampRamSettings(settings: LauncherSettings): LauncherSettings {
  const { maxAllowedMb } = getSystemMemoryInfo()
  let ramMaxMb = Math.min(Math.max(FIXED_RAM_MIN_MB, settings.ramMaxMb), maxAllowedMb)
  // If the system cap is below 2 GB (very low RAM PCs), keep both equal to the cap
  if (maxAllowedMb < FIXED_RAM_MIN_MB) {
    ramMaxMb = maxAllowedMb
  }
  const ramMinMb = Math.min(FIXED_RAM_MIN_MB, ramMaxMb)
  return { ...settings, ramMinMb, ramMaxMb }
}

export function formatMbLabel(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`
  }
  return `${mb} MB`
}
