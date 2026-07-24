import { useEffect, useMemo, useState } from 'react'
import type { EgpackExportEntry, EgpackExportOptions, GameInstance } from '../../shared/types'

type Props = {
  open: boolean
  instance: GameInstance
  busy?: boolean
  onClose: () => void
  onExport: (options: EgpackExportOptions) => void
}

const GROUP_META: Record<
  EgpackExportEntry['group'],
  { title: string; hint: string }
> = {
  mods: { title: 'Mods', hint: 'Jar files in mods/' },
  content: { title: 'Content', hint: 'Configs, packs, scripts' },
  worlds: { title: 'Worlds', hint: 'Can be very large' },
  settings: { title: 'Settings', hint: 'Game options files' },
}

const GROUP_ORDER: EgpackExportEntry['group'][] = ['mods', 'content', 'worlds', 'settings']

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function entryIcon(entry: EgpackExportEntry): string {
  if (entry.kind === 'mod') return '🧩'
  if (entry.group === 'worlds') return '🌍'
  if (entry.group === 'settings') return '⚙️'
  if (entry.path === 'resourcepacks' || entry.path === 'shaderpacks') return '🎨'
  if (entry.path === 'config' || entry.path === 'defaultconfigs') return '📁'
  return '📦'
}

export function ExportEgpackModal({ open, instance, busy, onClose, onExport }: Props) {
  const [packName, setPackName] = useState(instance.name)
  const [summary, setSummary] = useState(
    `EG Launcher pack · ${instance.loader} ${instance.gameVersion}`,
  )
  const [preferCdn, setPreferCdn] = useState(true)
  const [entries, setEntries] = useState<EgpackExportEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [loadingList, setLoadingList] = useState(false)
  const [filter, setFilter] = useState('')
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPackName(instance.name)
    setSummary(`EG Launcher pack · ${instance.loader} ${instance.gameVersion}`)
    setPreferCdn(true)
    setFilter('')
    setListError(null)
    let cancelled = false
    ;(async () => {
      setLoadingList(true)
      try {
        const list = await window.hive.instances.listExportContents(instance.id)
        if (cancelled) return
        setEntries(list)
        setSelected(new Set(list.filter((e) => e.recommended).map((e) => e.path)))
      } catch (err) {
        if (!cancelled) {
          setEntries([])
          setSelected(new Set())
          setListError((err as Error).message)
        }
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, instance.id, instance.name, instance.loader, instance.gameVersion])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.title || '').toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q),
    )
  }, [entries, filter])

  const grouped = useMemo(() => {
    const map = new Map<EgpackExportEntry['group'], EgpackExportEntry[]>()
    for (const g of GROUP_ORDER) map.set(g, [])
    for (const e of filtered) {
      map.get(e.group)?.push(e)
    }
    return map
  }, [filtered])

  const selectedSize = useMemo(() => {
    let total = 0
    for (const e of entries) {
      if (selected.has(e.path)) total += e.sizeBytes
    }
    return total
  }, [entries, selected])

  const selectedCount = selected.size

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function selectGroup(group: EgpackExportEntry['group'], value: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const e of entries) {
        if (e.group !== group) continue
        if (value) next.add(e.path)
        else next.delete(e.path)
      }
      return next
    })
  }

  function selectAll(value: boolean) {
    if (value) setSelected(new Set(entries.map((e) => e.path)))
    else setSelected(new Set())
  }

  function selectRecommended() {
    setSelected(new Set(entries.filter((e) => e.recommended).map((e) => e.path)))
  }

  function handleExport() {
    const name = packName.trim()
    if (!name || selected.size === 0) return
    onExport({
      packName: name,
      summary: summary.trim(),
      preferModrinthDownloads: preferCdn,
      selectedPaths: Array.from(selected),
    })
  }

  if (!open) return null

  const canExport = packName.trim().length > 0 && selectedCount > 0 && !loadingList

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-egpack-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="export-modal-head">
          <div>
            <h2 id="export-egpack-title">Export as .egpack</h2>
            <p className="hint" style={{ marginBottom: 0 }}>
              Same format as Modrinth <strong>.mrpack</strong> — pick every file and folder like the
              Modrinth App.
            </p>
          </div>
        </div>

        <div className="export-modal-meta form-grid">
          <div className="form-row">
            <label>Pack name</label>
            <input
              className="input"
              value={packName}
              disabled={!!busy}
              onChange={(e) => setPackName(e.target.value)}
              placeholder={instance.name}
            />
          </div>
          <div className="form-row">
            <label>Summary</label>
            <input
              className="input"
              value={summary}
              disabled={!!busy}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <label className="export-cdn-row">
            <input
              type="checkbox"
              checked={preferCdn}
              disabled={!!busy}
              onChange={(e) => setPreferCdn(e.target.checked)}
            />
            <span>
              Prefer Modrinth CDN for tracked mods
              <span className="hint" style={{ display: 'block', margin: 0 }}>
                Smaller pack · needs internet on import. Uncheck to embed every jar offline.
              </span>
            </span>
          </label>
        </div>

        <div className="export-list-toolbar">
          <input
            className="input export-list-filter"
            placeholder="Filter files…"
            value={filter}
            disabled={!!busy || loadingList}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="export-list-actions">
            <button
              type="button"
              className="btn btn-ghost export-mini-btn"
              disabled={!!busy || loadingList}
              onClick={() => selectRecommended()}
            >
              Recommended
            </button>
            <button
              type="button"
              className="btn btn-ghost export-mini-btn"
              disabled={!!busy || loadingList}
              onClick={() => selectAll(true)}
            >
              All
            </button>
            <button
              type="button"
              className="btn btn-ghost export-mini-btn"
              disabled={!!busy || loadingList}
              onClick={() => selectAll(false)}
            >
              None
            </button>
          </div>
        </div>

        <div className="export-list-scroll eg-scrollbar">
          {loadingList ? (
            <div className="export-list-empty">Scanning instance…</div>
          ) : listError ? (
            <div className="export-list-empty export-list-error">{listError}</div>
          ) : entries.length === 0 ? (
            <div className="export-list-empty">Nothing exportable in this instance yet.</div>
          ) : (
            GROUP_ORDER.map((group) => {
              const rows = grouped.get(group) || []
              if (!rows.length) return null
              const groupPaths = entries.filter((e) => e.group === group).map((e) => e.path)
              const allOn = groupPaths.every((p) => selected.has(p))
              const someOn = groupPaths.some((p) => selected.has(p))
              const meta = GROUP_META[group]
              const groupSize = rows.reduce((s, e) => s + e.sizeBytes, 0)
              return (
                <section key={group} className="export-group">
                  <div className="export-group-head">
                    <label className="export-group-title">
                      <input
                        type="checkbox"
                        checked={allOn}
                        ref={(el) => {
                          if (el) el.indeterminate = someOn && !allOn
                        }}
                        disabled={!!busy}
                        onChange={(e) => selectGroup(group, e.target.checked)}
                      />
                      <span>
                        {meta.title}
                        <span className="export-group-hint">{meta.hint}</span>
                      </span>
                    </label>
                    <span className="export-group-meta">
                      {rows.length} · {formatBytes(groupSize)}
                    </span>
                  </div>
                  <ul className="export-entry-list">
                    {rows.map((entry) => {
                      const checked = selected.has(entry.path)
                      return (
                        <li key={entry.path}>
                          <label className={`export-entry ${checked ? 'is-selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!!busy}
                              onChange={() => toggle(entry.path)}
                            />
                            <span className="export-entry-icon" aria-hidden>
                              {entryIcon(entry)}
                            </span>
                            <span className="export-entry-main">
                              <span className="export-entry-name">
                                {entry.title || entry.name}
                                {entry.disabled ? (
                                  <span className="badge export-badge-off">Disabled</span>
                                ) : null}
                                {entry.kind === 'folder' ? (
                                  <span className="badge">Folder</span>
                                ) : null}
                              </span>
                              <span className="export-entry-path">{entry.path}</span>
                            </span>
                            <span className="export-entry-size">
                              {entry.itemCount != null ? (
                                <span className="export-entry-count">{entry.itemCount} files</span>
                              ) : null}
                              {formatBytes(entry.sizeBytes)}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })
          )}
        </div>

        <div className="export-modal-footer">
          <div className="export-summary">
            <strong>{selectedCount}</strong> selected
            <span className="export-summary-sep">·</span>
            ~{formatBytes(selectedSize)}
            {preferCdn ? (
              <span className="hint" style={{ margin: 0 }}>
                {' '}
                (CDN mods may be smaller on disk)
              </span>
            ) : null}
          </div>
          <div className="modal-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy || !canExport}
              onClick={handleExport}
            >
              {busy ? 'Exporting…' : 'Continue…'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
