import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FEATURED_PACK } from '../../shared/branding'
import type { FeaturedPackMemoryGate } from '../../shared/types'
import { IconDownload, IconPlay, IconStop } from '../components/Icons'
import { loaderLabel, useAppStore } from '../store'

type PackNewsItem = {
  versionId: string
  versionNumber: string
  name: string
  datePublished: string
  changelog: string
  versionType: string
  isLatest: boolean
  isNew: boolean
}

type PackStatus = {
  project: {
    id: string
    slug: string
    title: string
    description: string
    iconUrl: string | null
    loaders: string[]
    gameVersions: string[]
  }
  latest: {
    id: string
    versionNumber: string
    name: string
    gameVersions: string[]
    loaders: string[]
    datePublished: string
    downloads: number
    fileName: string
    fileSize: number
    downloadUrl: string
    changelog: string
  } | null
  local: {
    slug: string
    installed: boolean
    instanceId: string | null
    versionId: string | null
    versionNumber: string | null
    installedAt: string | null
  }
  updateAvailable: boolean
  instance: { id: string; name: string } | null
  news: PackNewsItem[]
  memory: FeaturedPackMemoryGate
  requiresPaidAccount: boolean
  paidAccountOk: boolean
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`
  return `${n} B`
}

function formatNewsDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

/** Light cleanup of Modrinth markdown-ish changelogs for plain display */
function formatChangelog(text: string): string {
  if (!text) return ''
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

export function BeesSmpPage() {
  const navigate = useNavigate()
  const {
    showToast,
    accounts,
    activeAccountId,
    running,
    stopGame,
    refreshRunning,
    refreshAll,
    setDownloadProgress,
    downloadProgress,
  } = useAppStore()

  const [status, setStatus] = useState<PackStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'install' | 'launch' | null>(null)
  const loggedIn = accounts.some((a) => a.id === activeAccountId)
  const isLive = !!(
    status?.local.instanceId &&
    running.running &&
    running.instanceId === status.local.instanceId
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = (await window.hive.featured.getStatus(FEATURED_PACK.slug)) as PackStatus
      setStatus(data)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const off = window.hive.featured.onInstallProgress((p) => setDownloadProgress(p))
    return off
  }, [setDownloadProgress])

  async function installOrUpdate() {
    if (status?.memory && !status.memory.canInstall) {
      showToast('error', status.memory.installBlockReason || 'Not enough system RAM')
      return
    }
    if (status && !status.paidAccountOk) {
      showToast(
        'error',
        `${FEATURED_PACK.title} requires a paid Microsoft Minecraft account. Offline accounts cannot install this pack.`,
      )
      navigate('/account')
      return
    }
    setBusy('install')
    setDownloadProgress({ stage: 'start', progress: 0, message: 'Starting pack install…' })
    try {
      const result = await window.hive.featured.install({
        slug: FEATURED_PACK.slug,
        versionId: status?.latest?.id,
      })
      await refreshAll()
      await refresh()
      showToast('success', `${FEATURED_PACK.title} ${result.versionNumber} installed`)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
      setTimeout(() => setDownloadProgress(null), 1500)
    }
  }

  async function play(acknowledgeLowMemory = false) {
    if (!loggedIn) {
      showToast('error', 'Sign in with Microsoft to play')
      navigate('/account')
      return
    }
    const instanceId = status?.local.instanceId
    if (!instanceId) {
      showToast('error', 'Install the pack first')
      return
    }
    const mem = status?.memory
    if (mem?.playNeedsMoreAllocated) {
      showToast(
        'error',
        `Set Maximum RAM to at least ${mem.recommendedLabel} in Settings (currently ${Math.round(mem.allocatedMb / 1024)} GB).`,
      )
      navigate('/settings')
      return
    }
    if (mem?.playNeedsLowMemoryWarning && !acknowledgeLowMemory) {
      const ok = window.confirm(
        `${FEATURED_PACK.title} ideally needs ${mem.recommendedLabel} of RAM.\n\n` +
          `Your PC has about ${mem.system.totalGbRounded} GB total, so the launcher only allows ${mem.maxAllowedLabel}.\n\n` +
          `Playing on ${mem.maxAllowedLabel} will likely feel slow, laggy, or unstable. Continue anyway?`,
      )
      if (!ok) return
      acknowledgeLowMemory = true
    }
    setBusy('launch')
    try {
      const result = await window.hive.mc.launch(instanceId, { acknowledgeLowMemory })
      await refreshRunning()
      if (result.success) {
        showToast('success', result.message)
        await refreshAll()
      } else if (result.requiresConfirmation) {
        const ok = window.confirm(result.message)
        if (ok) {
          await play(true)
          return
        }
      } else {
        if (result.message.length > 120 || result.message.includes('\n')) {
          window.alert(result.message)
        }
        showToast('error', result.message.split('\n')[0])
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (loading && !status) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 240, borderRadius: 20 }} />
        <div className="skeleton" style={{ height: 180, borderRadius: 20, marginTop: 16 }} />
      </div>
    )
  }

  if (!status) {
    return (
      <div className="page">
        <div className="empty">
          <h3>Could not load {FEATURED_PACK.title}</h3>
          <button className="btn btn-primary" onClick={() => refresh()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const { project, latest, local, updateAvailable, news, memory, paidAccountOk } = status
  const newCount = news.filter((n) => n.isNew).length
  const canInstallPack = memory.canInstall && paidAccountOk

  return (
    <div className="page pack-page">
      <div className="featured-hero">
        <div className="featured-hero-glow" />
        <div className="featured-hero-inner">
          <div className="featured-badge-row">
            <span className="badge badge-orange">Featured pack</span>
            <span className="badge badge-blue">Modrinth · .mrpack</span>
            {updateAvailable && <span className="badge badge-orange">Update available</span>}
            {local.installed && !updateAvailable && (
              <span className="badge badge-green">Up to date</span>
            )}
            {!local.installed && <span className="badge">Not installed</span>}
            {!memory.canInstall && <span className="badge badge-orange">Needs 12+ GB RAM</span>}
            {!paidAccountOk && <span className="badge badge-orange">Paid account required</span>}
            {memory.canInstall && paidAccountOk && memory.playNeedsLowMemoryWarning && (
              <span className="badge badge-orange">Low memory PC</span>
            )}
          </div>

          <div className="featured-title-row featured-title-row-clean">
            <div>
              <h1>{project.title}</h1>
              <p className="featured-desc">
                {project.description || FEATURED_PACK.description}
              </p>
            </div>
          </div>

          <div className="featured-meta grid-meta">
            <div>
              <span className="meta-label">Latest</span>
              <strong>{latest?.versionNumber || '—'}</strong>
            </div>
            <div>
              <span className="meta-label">Installed</span>
              <strong>{local.versionNumber || 'Not installed'}</strong>
            </div>
            <div>
              <span className="meta-label">Minecraft</span>
              <strong>
                {latest?.gameVersions?.join(', ') || project.gameVersions.join(', ') || '—'}
              </strong>
            </div>
            <div>
              <span className="meta-label">Loader</span>
              <strong>
                {(latest?.loaders || project.loaders).map((l) => loaderLabel(l)).join(', ') ||
                  '—'}
              </strong>
            </div>
            <div>
              <span className="meta-label">Pack size</span>
              <strong>{latest ? formatBytes(latest.fileSize) : '—'}</strong>
            </div>
            <div>
              <span className="meta-label">Downloads</span>
              <strong>{latest ? latest.downloads.toLocaleString() : '—'}</strong>
            </div>
          </div>

          {!memory.canInstall && (
            <div
              className="panel"
              style={{
                marginTop: 12,
                marginBottom: 4,
                borderColor: 'rgba(239, 68, 68, 0.45)',
                background: 'rgba(239, 68, 68, 0.08)',
              }}
            >
              <strong style={{ color: 'var(--danger, #f87171)' }}>Cannot install — low system RAM</strong>
              <p className="hint" style={{ marginBottom: 0, marginTop: 6 }}>
                {memory.installBlockReason}
              </p>
            </div>
          )}

          {!paidAccountOk && (
            <div
              className="panel"
              style={{
                marginTop: 12,
                marginBottom: 4,
                borderColor: 'rgba(239, 68, 68, 0.45)',
                background: 'rgba(239, 68, 68, 0.08)',
              }}
            >
              <strong style={{ color: 'var(--danger, #f87171)' }}>
                Paid Microsoft account required
              </strong>
              <p className="hint" style={{ marginBottom: 0, marginTop: 6 }}>
                {FEATURED_PACK.title} cannot be downloaded or played with an offline (cracked)
                account. Sign in with a Microsoft account that owns Minecraft: Java Edition.
              </p>
            </div>
          )}

          {canInstallPack && memory.playNeedsLowMemoryWarning && (
            <div
              className="panel"
              style={{
                marginTop: 12,
                marginBottom: 4,
                borderColor: 'rgba(245, 158, 11, 0.45)',
                background: 'rgba(245, 158, 11, 0.08)',
              }}
            >
              <strong>Low memory warning</strong>
              <p className="hint" style={{ marginBottom: 0, marginTop: 6 }}>
                {FEATURED_PACK.title} ideally needs {memory.recommendedLabel} allocated. Your PC has
                about {memory.system.totalGbRounded} GB total, so max is {memory.maxAllowedLabel}. You
                can still play, but performance will likely be poor.
              </p>
            </div>
          )}

          {canInstallPack && memory.playNeedsMoreAllocated && (
            <div
              className="panel"
              style={{
                marginTop: 12,
                marginBottom: 4,
                borderColor: 'rgba(245, 158, 11, 0.45)',
                background: 'rgba(245, 158, 11, 0.08)',
              }}
            >
              <strong>Raise Maximum RAM to play</strong>
              <p className="hint" style={{ marginBottom: 0, marginTop: 6 }}>
                Set Maximum RAM to at least {memory.recommendedLabel} in Settings (currently{' '}
                {Math.round((memory.allocatedMb / 1024) * 10) / 10} GB). Your PC allows up to{' '}
                {memory.maxAllowedLabel}.
              </p>
            </div>
          )}

          <div className="featured-actions">
            {!local.installed ? (
              <button
                className="btn btn-primary btn-lg"
                disabled={busy === 'install' || !latest || !canInstallPack}
                onClick={installOrUpdate}
                title={
                  !canInstallPack
                    ? memory.installBlockReason || 'Not enough system RAM'
                    : 'Install pack'
                }
              >
                <IconDownload />
                {busy === 'install'
                  ? 'Installing…'
                  : !memory.canInstall
                    ? 'Needs 12+ GB RAM'
                    : !paidAccountOk
                      ? 'Paid account required'
                      : 'Install pack'}
              </button>
            ) : updateAvailable ? (
              <button
                className="btn btn-primary btn-lg"
                disabled={busy === 'install' || !canInstallPack}
                onClick={installOrUpdate}
              >
                <IconDownload />
                {busy === 'install'
                  ? 'Updating…'
                  : `Update to ${latest?.versionNumber || 'latest'}`}
              </button>
            ) : (
              <button className="btn btn-secondary btn-lg" disabled>
                Up to date
              </button>
            )}

            {isLive ? (
              <button className="btn btn-danger btn-lg" onClick={() => stopGame()}>
                <IconStop />
                Stop
              </button>
            ) : (
              <button
                className="btn btn-primary btn-lg"
                disabled={
                  !local.installed ||
                  busy !== null ||
                  running.running ||
                  !loggedIn ||
                  !canInstallPack ||
                  memory.playNeedsMoreAllocated
                }
                onClick={() => play(false)}
                title={
                  !local.installed
                    ? 'Install first'
                    : !loggedIn
                      ? 'Sign in required'
                      : !canInstallPack
                        ? memory.installBlockReason || 'Not enough system RAM'
                        : memory.playNeedsMoreAllocated
                          ? `Set Maximum RAM to ${memory.recommendedLabel} in Settings`
                          : `Play ${FEATURED_PACK.title}`
                }
              >
                <IconPlay />
                {!loggedIn
                  ? 'Sign in to play'
                  : memory.playNeedsMoreAllocated
                    ? `Need ${memory.recommendedLabel} RAM`
                    : 'Play'}
              </button>
            )}

            <button className="btn btn-secondary" onClick={() => refresh()} disabled={loading}>
              {loading ? 'Checking…' : 'Check for updates'}
            </button>

            <button
              className="btn btn-ghost"
              onClick={() =>
                window.hive.shell.openExternal(`https://modrinth.com/modpack/${project.slug}`)
              }
            >
              View on Modrinth
            </button>

            {local.instanceId && (
              <button
                className="btn btn-ghost"
                onClick={() => navigate(`/instances/${local.instanceId}`)}
              >
                Open instance
              </button>
            )}
          </div>

          {(busy === 'install' || (downloadProgress && downloadProgress.stage !== 'done')) && (
            <div className="featured-progress">
              <div className="progress-meta">
                <span>{downloadProgress?.message || 'Working…'}</span>
                <span>{Math.round((downloadProgress?.progress || 0) * 100)}%</span>
              </div>
              <div className="progress-bar">
                <div
                  style={{ width: `${Math.round((downloadProgress?.progress || 0) * 100)}%` }}
                />
              </div>
              <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>
                First install can take a while — the .mrpack and mods are large.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* News — changelogs from Modrinth versions */}
      <section className="panel news-panel">
        <div className="news-header">
          <div>
            <h2>News & updates</h2>
            <p className="hint" style={{ marginBottom: 0 }}>
              What&apos;s new in {project.title}
              {newCount > 0 ? ` · ${newCount} version${newCount === 1 ? '' : 's'} you haven&apos;t installed yet` : ''}
            </p>
          </div>
          {updateAvailable && (
            <button
              className="btn btn-primary"
              disabled={busy === 'install'}
              onClick={installOrUpdate}
            >
              <IconDownload />
              Get update
            </button>
          )}
        </div>

        {news.length === 0 ? (
          <div className="empty" style={{ padding: 28 }}>
            <h3>No release notes yet</h3>
            <p>When new pack versions are published on Modrinth, they&apos;ll show up here.</p>
          </div>
        ) : (
          <div className="news-feed">
            {news.map((item) => {
              const body = formatChangelog(item.changelog)
              return (
                <article
                  key={item.versionId}
                  className={`news-card${item.isNew ? ' news-card-new' : ''}${item.isLatest ? ' news-card-latest' : ''}`}
                >
                  <div className="news-card-top">
                    <div className="news-card-titles">
                      <div className="news-version-row">
                        <span className="news-version">v{item.versionNumber}</span>
                        {item.isLatest && <span className="badge badge-green">Latest</span>}
                        {item.isNew && !item.isLatest && (
                          <span className="badge badge-orange">New for you</span>
                        )}
                        {item.isNew && item.isLatest && updateAvailable && (
                          <span className="badge badge-orange">Update</span>
                        )}
                        <span className="badge">{item.versionType}</span>
                      </div>
                      <h3 className="news-title">{item.name || `Version ${item.versionNumber}`}</h3>
                      <time className="news-date" dateTime={item.datePublished}>
                        {formatNewsDate(item.datePublished)}
                      </time>
                    </div>
                  </div>
                  {body ? (
                    <div className="news-body">{body}</div>
                  ) : (
                    <p className="news-body news-body-empty">
                      No changelog was published for this version on Modrinth.
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>About</h2>
        <p className="hint">
          <strong>{FEATURED_PACK.title}</strong> is pinned in EG Launcher permanently. It is never
          installed automatically — use Install when you want it. The News section above always
          shows Modrinth release notes so everyone can see what changed.
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          <strong>RAM requirements:</strong> at least {FEATURED_PACK.minSystemRamGb} GB system
          memory to install. Recommended allocation {FEATURED_PACK.recommendedAllocatedMb / 1024} GB
          (required when your PC can provide it). On 12 GB PCs the launcher caps Minecraft at ~50%
          (~6 GB) — play is allowed after a warning, but the experience will be poor.
        </p>
        <div className="list" style={{ marginTop: 12 }}>
          <div className="list-item">
            <div className="grow">
              <div className="sub">Modrinth</div>
              <div className="title mono">{project.slug}</div>
            </div>
          </div>
          {local.installedAt && (
            <div className="list-item">
              <div className="grow">
                <div className="sub">Last installed</div>
                <div className="title">{new Date(local.installedAt).toLocaleString()}</div>
              </div>
            </div>
          )}
          {latest && (
            <div className="list-item">
              <div className="grow">
                <div className="sub">Latest file</div>
                <div className="title mono">{latest.fileName}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
