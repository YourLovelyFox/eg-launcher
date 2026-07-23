import { useEffect, useMemo, useRef, useState } from 'react'
import type { UpdateStatus } from '../../shared/types'
import { useAppStore } from '../store'

function formatBytes(n: number): string {
  if (!n || n < 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`
  return `${n} B`
}

/**
 * Sanitize release-note HTML from GitHub / electron-updater.
 * Allows common formatting tags only; drops scripts and event handlers.
 */
function sanitizeReleaseHtml(input: string): string {
  let s = input.replace(/\r\n/g, '\n')

  // Remove dangerous blocks entirely
  s = s
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1="#"')

  // Drop disallowed tags but keep their text content
  s = s.replace(
    /<\/?(?!\/?(?:p|br|hr|strong|b|em|i|u|ul|ol|li|a|h[1-6]|code|pre|tt|blockquote|span|div|table|thead|tbody|tr|th|td)\b)[a-z][a-z0-9]*\b[^>]*>/gi,
    '',
  )

  return s.trim()
}

/** If notes are plain markdown (no HTML), convert a useful subset to HTML. */
function markdownToHtml(md: string): string {
  let s = md.trim()
  if (!s) return ''

  // Escape HTML first
  s = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Headings
  s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  s = s.replace(/^# (.+)$/gm, '<h3>$1</h3>')

  // Bold / code (apply bold before single-asterisk italic)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')

  // Links [text](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noreferrer noopener">$1</a>',
  )

  // Unordered list blocks
  s = s.replace(/(?:^|\n)((?:[-*] .+(?:\n|$))+)/g, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => line.replace(/^[-*] /, '').trim())
      .filter(Boolean)
      .map((item) => `<li>${item}</li>`)
      .join('')
    return `\n<ul>${items}</ul>\n`
  })

  // Paragraphs: split on blank lines (skip lines that already became blocks)
  s = s
    .split(/\n{2,}/)
    .map((chunk) => {
      const t = chunk.trim()
      if (!t) return ''
      if (/^<(h[1-6]|ul|ol|pre|blockquote)/i.test(t)) return t
      return `<p>${t.replace(/\n/g, '<br/>')}</p>`
    })
    .filter(Boolean)
    .join('\n')

  return s
}

/** Build safe HTML for the What's new panel. */
function notesToSafeHtml(text: string | null | undefined): string {
  if (!text) return ''
  const raw = text.trim()
  if (!raw) return ''

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw)
  if (looksLikeHtml) {
    return sanitizeReleaseHtml(raw)
  }
  return sanitizeReleaseHtml(markdownToHtml(raw))
}

/**
 * Update dialog — confirms before download/install.
 * "What's new" renders sanitized HTML (GitHub notes + our CHANGELOG body).
 */
export function UpdateModal() {
  const showToast = useAppStore((s) => s.showToast)
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lastToastVersion = useRef<string | null>(null)

  useEffect(() => {
    window.hive.updater.getStatus().then(setStatus).catch(() => undefined)
    return window.hive.updater.onStatus((next) => {
      setStatus(next)
      if (next.state === 'available') {
        // Background 5‑min checks re-show the dialog after "Later"
        setDismissedVersion((prev) => (prev === next.version ? null : prev))
        if (lastToastVersion.current !== next.version) {
          lastToastVersion.current = next.version
          showToast(
            'success',
            `Update ${next.version} is available — review and install when ready`,
          )
        }
      }
    })
  }, [showToast])

  const notesHtml = useMemo(() => {
    if (status.state !== 'available' && status.state !== 'ready') return ''
    return notesToSafeHtml(status.releaseNotes)
  }, [status])

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
      // Progress arrives via onStatus events; do not block the UI thread conceptually —
      // the main process still downloads asynchronously with timeouts.
      await window.hive.updater.download()
    } catch (err) {
      // Status event usually carries the error; keep UI usable
      console.error(err)
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

        {(status.state === 'available' || status.state === 'ready') && notesHtml && (
          <div className="update-notes">
            <div className="meta-label">What&apos;s new</div>
            <div
              className="update-notes-body update-notes-html"
              // Sanitized above — only allowlisted tags from GitHub/CHANGELOG content we publish.
              dangerouslySetInnerHTML={{ __html: notesHtml }}
            />
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
