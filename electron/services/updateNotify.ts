import { Notification } from 'electron'

let lastNotifiedVersion = ''

/** OS toast once per version so a new GitHub release is obvious. */
export function notifyUpdateAvailable(version: string): void {
  const ver = (version || '').replace(/^v/i, '').trim()
  if (!ver || lastNotifiedVersion === ver) return
  lastNotifiedVersion = ver
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: 'EG Launcher update',
      body: `Version ${ver} is available. Open Settings or the banner to install.`,
    })
    n.show()
  } catch (err) {
    console.warn('[updater] notification failed', err)
  }
}
