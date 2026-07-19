import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../shared/types'

function formatBytes(n: number): string {
  if (!n || n < 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`
  return `${n} B`
}

/** Turn GitHub HTML / markdown release notes into plain readable text. */
function stripNotes(text: string | null | undefined): string {
  if (!text) return ''
  let s = text.replace(/\r\n/g, '\n')

  // Prefer extracting link labels before stripping tags
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
    const t = String(label)
      .replace(/<[^>]+>/g, '')
      .replace(/<\/?tt>/gi, '')
      .trim()
    return t || String(href)
  })

  // Block tags → newlines
  s = s
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')

  // Entities
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")

  // Light markdown cleanup
  s = s
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return s
}

/**
 * Listens for electron-updater events. Shows a confirm dialog when a new
 * NSIS / AppImage release is available — never downloads until the user agrees.
 */
export function UpdateModal() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.hive.updater.getStatus().then(setStatus).catch(() => undefined)
    return window.hive.updater.onStatus(setStatus)
  }, [])

  // Only show modal when there is something to act on (or an error)
  const hiddenByDismiss =
    status.state === 'available' && dismissedVersion === status.version

  const showModal =
    !hiddenByDismiss &&
    (status.state === 'available' ||
      status.state === 'downloading' ||
      status.state === 'ready' ||
      (status.state === 'error' && dismissedVersion !== 'error'))

  if (!showModal) return null

  async function onUpdateNow() {
    setBusy(true)
    try {
      await window.hive.updater.download()
    } finally {
      setBusy(false)
    }
  }

  function onLater() {
    if (status.state === 'available') {
      setDismissedVersion(status.version)
    } else {
      setDismissedVersion('error')
    }
  }

  function onInstall() {
    window.hive.updater.install()
  }

  const title =
    status.state === 'ready'
      ? `Update ${status.version} ready`
      : status.state === 'downloading'
        ? `Downloading ${status.version}…`
        : status.state === 'error'
          ? 'Update failed'
          : status.state === 'available'
            ? `Update ${status.version} available`
            : 'Update'

  return (
    <div className="update-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="update-modal panel">
        <div className="update-modal-head">
          <span className="badge badge-orange">Launcher update</span>
          <h2 id="update-title">{title}</h2>
          {(status.state === 'available' ||
            status.state === 'downloading' ||
            status.state === 'ready') && (
            <p className="hint" style={{ marginBottom: 0 }}>
              You have v{status.currentVersion}.{' '}
              {status.state === 'ready'
                ? 'Restart to install the new version.'
                : 'Install only after you confirm.'}
            </p>
          )}
        </div>

        {(status.state === 'available' || status.state === 'ready') &&
          stripNotes(status.releaseNotes) && (
            <div className="update-notes">
              <div className="meta-label">What&apos;s new</div>
              <pre className="update-notes-body">{stripNotes(status.releaseNotes)}</pre>
            </div>
          )}

        {status.state === 'downloading' && (
          <div className="featured-progress" style={{ marginTop: 12 }}>
            <div className="progress-meta">
              <span>
                {formatBytes(status.transferred)} / {formatBytes(status.total)}
                {status.bytesPerSecond > 0
                  ? ` · ${formatBytes(status.bytesPerSecond)}/s`
                  : ''}
              </span>
              <span>{Math.round(status.percent)}%</span>
            </div>
            <div className="progress-bar">
              <div style={{ width: `${Math.min(100, Math.round(status.percent))}%` }} />
            </div>
          </div>
        )}

        {status.state === 'error' && (
          <p className="hint" style={{ color: 'var(--red)', marginTop: 8 }}>
            {status.message}
          </p>
        )}

        <div className="update-modal-actions">
          {status.state === 'available' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={onLater} disabled={busy}>
                Later
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onUpdateNow}
                disabled={busy}
              >
                {busy ? 'Starting…' : 'Download & install'}
              </button>
            </>
          )}

          {status.state === 'downloading' && (
            <button type="button" className="btn btn-secondary" disabled>
              Downloading…
            </button>
          )}

          {status.state === 'ready' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={onLater}>
                Later
              </button>
              <button type="button" className="btn btn-primary" onClick={onInstall}>
                Restart & install
              </button>
            </>
          )}

          {status.state === 'error' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={onLater}>
                Dismiss
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  setBusy(true)
                  try {
                    await window.hive.updater.check()
                  } finally {
                    setBusy(false)
                  }
                }}
                disabled={busy}
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
