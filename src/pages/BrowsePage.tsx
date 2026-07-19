import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ModrinthSearchHit, ModrinthVersion } from '../../shared/types'
import { IconDownload, IconSearch } from '../components/Icons'
import {
  checkModUpdate,
  installedModMap,
  type ModUpdateInfo,
} from '../modUpdates'
import { formatDownloads, loaderLabel, useAppStore } from '../store'

const PAGE_SIZE = 24

/** Build a compact page list like 1 … 4 5 [6] 7 8 … 40 */
function getPageNumbers(current: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages = new Set<number>()
  pages.add(1)
  pages.add(totalPages)
  for (let p = current - 2; p <= current + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p)
  }

  const sorted = [...pages].sort((a, b) => a - b)
  const result: Array<number | 'ellipsis'> = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      result.push('ellipsis')
    }
    result.push(sorted[i])
  }
  return result
}

export function BrowsePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const {
    instances,
    selectedInstanceId,
    setSelectedInstanceId,
    showToast,
    setDownloadProgress,
    downloadProgress,
    refreshAll,
  } = useAppStore()

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModrinthSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState('relevance')
  const [selectedProject, setSelectedProject] = useState<ModrinthSearchHit | null>(null)
  const [versions, setVersions] = useState<ModrinthVersion[]>([])
  const [versionId, setVersionId] = useState('')
  const [installing, setInstalling] = useState(false)
  const [quickInstallingId, setQuickInstallingId] = useState<string | null>(null)
  /** Latest-version check for mods already on the selected instance */
  const [updateInfo, setUpdateInfo] = useState<Record<string, ModUpdateInfo>>({})
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchGen = useRef(0)

  const instanceId = params.get('instance') || selectedInstanceId || instances[0]?.id || ''
  const instance = useMemo(
    () => instances.find((i) => i.id === instanceId) || null,
    [instances, instanceId],
  )

  // Stable key so update checks don't thrash on new Map identity every render
  const installedKey = useMemo(
    () =>
      (instance?.mods || [])
        .map((m) => `${m.projectId}:${m.versionId}`)
        .sort()
        .join('|'),
    [instance?.mods],
  )
  const installedByProject = useMemo(
    () => installedModMap(instance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instance?.id, installedKey],
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageNumbers = useMemo(() => getPageNumbers(page, totalPages), [page, totalPages])
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  useEffect(() => {
    if (instanceId) setSelectedInstanceId(instanceId)
  }, [instanceId, setSelectedInstanceId])

  useEffect(() => {
    const off = window.hive.modrinth.onDownloadProgress((p) => setDownloadProgress(p))
    return off
  }, [setDownloadProgress])

  async function search(options?: { query?: string; page?: number }) {
    const nextQuery = options?.query ?? query
    const nextPage = options?.page ?? page
    const offset = (nextPage - 1) * PAGE_SIZE
    const gen = ++searchGen.current

    setLoading(true)
    try {
      const result = await window.hive.modrinth.search({
        query: nextQuery,
        gameVersion: instance?.gameVersion,
        loader: instance?.loader === 'vanilla' ? undefined : instance?.loader,
        limit: PAGE_SIZE,
        offset,
        index: sort,
      })
      // Ignore stale responses if a newer search started
      if (gen !== searchGen.current) return

      const pages = Math.max(1, Math.ceil(result.total_hits / PAGE_SIZE))
      const clampedPage = Math.min(nextPage, pages)

      setHits(result.hits)
      setTotal(result.total_hits)
      setPage(clampedPage)

      const resultsEl = document.getElementById('mod-results')
      resultsEl?.scrollIntoView({ block: 'start', behavior: 'smooth' })

      if (clampedPage !== nextPage && result.total_hits > 0) {
        const retry = await window.hive.modrinth.search({
          query: nextQuery,
          gameVersion: instance?.gameVersion,
          loader: instance?.loader === 'vanilla' ? undefined : instance?.loader,
          limit: PAGE_SIZE,
          offset: (clampedPage - 1) * PAGE_SIZE,
          index: sort,
        })
        if (gen !== searchGen.current) return
        setHits(retry.hits)
        setTotal(retry.total_hits)
        setPage(clampedPage)
      }
    } catch (err) {
      if (gen === searchGen.current) {
        showToast('error', (err as Error).message)
      }
    } finally {
      if (gen === searchGen.current) {
        setLoading(false)
        // Keep focus usable after results load
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus({ preventScroll: true })
        })
      }
    }
  }

  // Reset to page 1 when filters change
  useEffect(() => {
    void search({ page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id, sort])

  // For installed mods on this page, check whether a newer compatible version exists
  useEffect(() => {
    if (!instance || hits.length === 0) {
      setUpdateInfo({})
      return
    }

    let cancelled = false
    const installedHits = hits.filter((h) => installedByProject.has(h.project_id))
    if (installedHits.length === 0) {
      setUpdateInfo({})
      return
    }

    ;(async () => {
      const next: Record<string, ModUpdateInfo> = {}
      await Promise.all(
        installedHits.map(async (hit) => {
          const mod = installedByProject.get(hit.project_id)
          if (!mod) return
          const info = await checkModUpdate(mod, instance.gameVersion, instance.loader)
          next[hit.project_id] = info
        }),
      )
      if (!cancelled) setUpdateInfo(next)
    })()

    return () => {
      cancelled = true
    }
    // Use stable installedKey instead of Map identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, instance?.id, instance?.gameVersion, instance?.loader, installedKey])

  function goToPage(target: number) {
    if (target < 1 || target > totalPages || target === page || loading) return
    search({ page: target })
  }

  function actionForHit(projectId: string): 'install' | 'update' | 'installed' {
    const mod = installedByProject.get(projectId)
    if (!mod) return 'install'
    const info = updateInfo[projectId]
    if (!info) return 'installed' // checking / not loaded yet — don't show false Update
    return info.hasUpdate ? 'update' : 'installed'
  }

  async function openProject(hit: ModrinthSearchHit) {
    setSelectedProject(hit)
    setVersions([])
    setVersionId('')
    try {
      const list = await window.hive.modrinth.versions(
        hit.project_id,
        instance?.gameVersion,
        instance?.loader === 'vanilla' ? undefined : instance?.loader,
      )
      setVersions(list)
      setVersionId(list[0]?.id || '')
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  async function quickInstall(hit: ModrinthSearchHit) {
    if (!instance) {
      showToast('error', 'Create or select an instance first')
      return
    }

    const action = actionForHit(hit.project_id)
    if (action === 'installed') {
      showToast('info', `${hit.title} is already up to date`)
      return
    }

    setQuickInstallingId(hit.project_id)
    try {
      const list = await window.hive.modrinth.versions(
        hit.project_id,
        instance.gameVersion,
        instance.loader === 'vanilla' ? undefined : instance.loader,
      )
      const best = list[0]
      if (!best) {
        showToast('error', `No compatible version of ${hit.title} for this instance`)
        return
      }

      const existing = installedByProject.get(hit.project_id)
      if (existing && existing.versionId === best.id) {
        setUpdateInfo((prev) => ({
          ...prev,
          [hit.project_id]: {
            projectId: hit.project_id,
            hasUpdate: false,
            latestVersionId: best.id,
            latestVersionNumber: best.version_number,
            installedVersionId: existing.versionId,
            installedVersionNumber: existing.versionNumber,
          },
        }))
        showToast('info', `${hit.title} is already up to date`)
        return
      }

      const result = await window.hive.modrinth.installMod({
        instanceId: instance.id,
        projectId: hit.project_id,
        versionId: best.id,
      })
      await refreshAll()
      const deps =
        result._installSummary?.installed.filter((i) => i.isDependency).map((i) => i.title) ?? []
      const failedDeps = result._installSummary?.failed.filter((f) => f.projectId !== hit.project_id) ?? []
      const base =
        action === 'update'
          ? `Updated ${hit.title} to ${best.version_number}`
          : `Installed ${hit.title} (${best.version_number})`
      const depMsg =
        deps.length > 0
          ? ` + ${deps.length} dependenc${deps.length === 1 ? 'y' : 'ies'} (${deps.slice(0, 3).join(', ')}${deps.length > 3 ? '…' : ''})`
          : ''
      showToast('success', base + depMsg)
      if (failedDeps.length > 0) {
        showToast(
          'error',
          `Some dependencies failed: ${failedDeps.map((f) => f.title || f.projectId).join(', ')}`,
        )
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setQuickInstallingId(null)
      setTimeout(() => setDownloadProgress(null), 1200)
    }
  }

  async function install() {
    if (!instance || !selectedProject || !versionId) {
      showToast('error', 'Select an instance and a mod version first')
      return
    }
    setInstalling(true)
    try {
      const result = await window.hive.modrinth.installMod({
        instanceId: instance.id,
        projectId: selectedProject.project_id,
        versionId,
      })
      await refreshAll()
      const deps =
        result._installSummary?.installed.filter((i) => i.isDependency).map((i) => i.title) ?? []
      const base = `Installed ${selectedProject.title}`
      const depMsg =
        deps.length > 0
          ? ` + ${deps.length} dependenc${deps.length === 1 ? 'y' : 'ies'} (${deps.slice(0, 3).join(', ')}${deps.length > 3 ? '…' : ''})`
          : ''
      showToast('success', base + depMsg)
      setSelectedProject(null)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setInstalling(false)
      setTimeout(() => setDownloadProgress(null), 1200)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Browse mods</h1>
          <p>Search Modrinth mods for your selected instance.</p>
        </div>
      </div>

      <form
        className="toolbar toolbar-sticky"
        onSubmit={(e) => {
          e.preventDefault()
          void search({ page: 1 })
        }}
      >
        <div className="search-box">
          <span className="search-icon" aria-hidden>
            <IconSearch />
          </span>
          <input
            ref={searchInputRef}
            className="input search-input"
            type="search"
            name="mod-search"
            placeholder="Search mods…"
            value={query}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <select
          className="select"
          value={instanceId}
          onChange={(e) => {
            setSelectedInstanceId(e.target.value)
            navigate(`/browse?instance=${e.target.value}`)
          }}
          style={{ minWidth: 200 }}
        >
          {instances.length === 0 && <option value="">No instances</option>}
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({loaderLabel(i.loader)} {i.gameVersion})
            </option>
          ))}
        </select>

        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="relevance">Relevance</option>
          <option value="downloads">Downloads</option>
          <option value="follows">Follows</option>
          <option value="newest">Newest</option>
          <option value="updated">Updated</option>
        </select>

        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {instance && (
        <div className="badge-row" style={{ marginBottom: 14 }}>
          <span className="badge badge-green">Filtering: {loaderLabel(instance.loader)}</span>
          <span className="badge badge-blue">MC {instance.gameVersion}</span>
          <span className="badge">{total.toLocaleString()} results</span>
          {total > 0 && (
            <span className="badge">
              Page {page} of {totalPages}
            </span>
          )}
          {downloadProgress && downloadProgress.stage !== 'done' && (
            <span className="badge badge-orange">
              {downloadProgress.message} ({Math.round(downloadProgress.progress * 100)}%)
            </span>
          )}
        </div>
      )}

      {!instance && (
        <div className="empty" style={{ marginBottom: 16 }}>
          <h3>Create an instance first</h3>
          <p>Mods install into an instance so versions and loaders stay compatible.</p>
          <Link to="/instances" className="btn btn-primary">
            Go to instances
          </Link>
        </div>
      )}

      <div id="mod-results">
      {loading ? (
        <div className="grid grid-mods">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card" style={{ height: 140 }}>
              <div className="skeleton" style={{ height: '100%' }} />
            </div>
          ))}
        </div>
      ) : hits.length === 0 ? (
        <div className="empty">
          <h3>No mods found</h3>
          <p>Try a different search or clear filters.</p>
        </div>
      ) : (
        <div className="grid grid-mods">
          {hits.map((hit) => {
            const action = actionForHit(hit.project_id)
            const busy = quickInstallingId === hit.project_id
            const info = updateInfo[hit.project_id]
            const installedMod = installedByProject.get(hit.project_id)
            return (
              <div key={hit.project_id} className="card mod-card-wrap">
                <button type="button" className="mod-card-body" onClick={() => openProject(hit)}>
                  {hit.icon_url ? (
                    <img className="mod-icon" src={hit.icon_url} alt="" />
                  ) : (
                    <div className="mod-icon placeholder">{hit.title.slice(0, 1)}</div>
                  )}
                  <div>
                    <div className="mod-title">{hit.title}</div>
                    <div className="mod-author">by {hit.author}</div>
                    <div className="mod-desc">{hit.description}</div>
                    <div className="mod-stats">
                      <span>↓ {formatDownloads(hit.downloads)}</span>
                      <span>★ {formatDownloads(hit.follows)}</span>
                      {action === 'installed' && (
                        <span className="badge badge-green">Installed</span>
                      )}
                      {action === 'update' && (
                        <span className="badge badge-orange">
                          Update
                          {info?.latestVersionNumber ? ` ${info.latestVersionNumber}` : ''}
                        </span>
                      )}
                      <span className="badge-row">
                        {(hit.display_categories || hit.categories).slice(0, 2).map((c) => (
                          <span key={c} className="badge">
                            {c}
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                </button>
                <div className="mod-card-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => openProject(hit)}
                  >
                    Details
                  </button>
                  {action === 'installed' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled
                      title={
                        installedMod
                          ? `Installed ${installedMod.versionNumber}`
                          : 'Already installed'
                      }
                    >
                      Installed
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!instance || busy || !!quickInstallingId}
                      onClick={() => quickInstall(hit)}
                      title={
                        action === 'update'
                          ? `Update to ${info?.latestVersionNumber || 'latest'}`
                          : 'Install latest compatible version'
                      }
                    >
                      <IconDownload />
                      {busy
                        ? action === 'update'
                          ? 'Updating…'
                          : 'Installing…'
                        : action === 'update'
                          ? 'Update'
                          : 'Install'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      </div>

      {total > 0 && (
        <div className="pagination">
          <div className="pagination-info">
            Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of{' '}
            {total.toLocaleString()}
          </div>
          <div className="pagination-controls">
            <button
              type="button"
              className="btn btn-secondary pagination-btn"
              disabled={page <= 1 || loading}
              onClick={() => goToPage(page - 1)}
            >
              ← Back
            </button>

            <div className="pagination-pages">
              {pageNumbers.map((item, idx) =>
                item === 'ellipsis' ? (
                  <span key={`e-${idx}`} className="pagination-ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={`pagination-page${item === page ? ' active' : ''}`}
                    disabled={loading || item === page}
                    onClick={() => goToPage(item)}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>

            <button
              type="button"
              className="btn btn-secondary pagination-btn"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(page + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {selectedProject && (
        <div className="modal-backdrop" onClick={() => setSelectedProject(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
            <div className="project-hero">
              {selectedProject.icon_url ? (
                <img src={selectedProject.icon_url} alt="" />
              ) : (
                <div className="mod-icon placeholder">{selectedProject.title.slice(0, 1)}</div>
              )}
              <div>
                <h2 style={{ marginBottom: 4 }}>{selectedProject.title}</h2>
                <div className="mod-author">by {selectedProject.author}</div>
                <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
                  {selectedProject.description}
                </p>
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: 18 }}>
              <div className="form-row">
                <label>Install to instance</label>
                <select
                  className="select"
                  value={instanceId}
                  onChange={(e) => setSelectedInstanceId(e.target.value)}
                >
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({loaderLabel(i.loader)} {i.gameVersion})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>Version</label>
                <select
                  className="select"
                  value={versionId}
                  onChange={(e) => setVersionId(e.target.value)}
                >
                  {versions.length === 0 && <option value="">No compatible versions</option>}
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version_number} · {v.loaders.join(', ')} · {v.version_type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {downloadProgress && (
              <div style={{ marginTop: 14 }}>
                <div className="progress-meta">
                  <span>{downloadProgress.message}</span>
                  <span>{Math.round(downloadProgress.progress * 100)}%</span>
                </div>
                <div className="progress-bar">
                  <div style={{ width: `${Math.round(downloadProgress.progress * 100)}%` }} />
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() =>
                  window.hive.shell.openExternal(`https://modrinth.com/mod/${selectedProject.slug}`)
                }
              >
                View on Modrinth
              </button>
              <button className="btn btn-secondary" onClick={() => setSelectedProject(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={
                  !instance ||
                  !versionId ||
                  installing ||
                  (!!selectedProject &&
                    installedByProject.get(selectedProject.project_id)?.versionId === versionId)
                }
                onClick={install}
              >
                <IconDownload />
                {installing
                  ? 'Installing…'
                  : selectedProject &&
                      installedByProject.get(selectedProject.project_id)?.versionId === versionId
                    ? 'Installed'
                    : selectedProject && installedByProject.has(selectedProject.project_id)
                      ? 'Update / Install'
                      : 'Install'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
