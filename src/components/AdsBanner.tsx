/**
 * Google AdSense banner (hosted ad-unit.php iframe).
 *
 * Disabled until the AdSense site is approved — renders nothing.
 * Set ADS_BANNER_ENABLED to true when ready to show ads again.
 */
export const ADS_BANNER_ENABLED = false

export function AdsBanner() {
  // Intentionally blank until AdSense is approved.
  if (!ADS_BANNER_ENABLED) return null
  return null
}
