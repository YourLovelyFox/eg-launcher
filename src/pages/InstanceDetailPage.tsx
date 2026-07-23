import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { GameInstance, InstanceBackupInfo } from '../../shared/types'
import { IconDownload, IconFolder, IconPlay, IconStop, IconTrash } from '../components/Icons'
import { checkModsUpdates, type ModUpdateInfo } from '../modUpdates'
import { loaderLabel, useAppStore } from '../store'

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

export function InstanceDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    showToast,
    refreshAll,
    installProgress,
    setInstallProgress,
    setDownloadProgress,
    downloadProgress,
    running,
    stopGame,
    refreshRunning,
    accounts,
    activeAccountId,
  } = useAppStore()
  const [instance, setInstance] = useState<GameInstance | null>(null)
  const [busy, setBusy] = useState<'install' | 'launch' | 'backup' | 'restore' | null>(null)
  const [updateMap, setUpdateMap] = useState<Record<string, ModUpdateInfo>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [backups, setBackups] = useState<InstanceBackupInfo[]>([])
  const [includeSaves, setIncludeSaves] = useState(true)
  const [backupProgress, setBackupProgress] = useState<{ message: string; progress: number } | null>(
    null,
  )

  const isLive = !!(instance && running.running && running.instanceId === instance.id)
  const loggedIn = accounts.some((a) => a.id === activeAccountId)
  const updatesAvailable = Object.values(updateMap).filter((u) => u.hasUpdate)

  async function reload() {
    if (!id) return
    const data = await window.hive.instances.get(id)
    setInstance(data)
    return data
  }

  async function reloadBackups() {
    if (!id) return
    try {
      const list = await window.hive.instances.listBackups(id)
      setBackups(list)
    } catch {
      setBackups([])
    }
  }

  async function refreshUpdateChecks(target?: GameInstance | null) {
    const inst = target ?? instance
    if (!inst || inst.mods.length === 0) {
      setUpdateMap({})
      return
    }
    setCheckingUpdates(true)
    try {
      const map = await checkModsUpdates(inst.mods, inst.gameVersion, inst.loader)
      setUpdateMap(map)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setCheckingUpdates(false)
    }
  }

  useEffect(() => {
    reload()
      .then((data) => {
        void refreshUpdateChecks(data)
        void reloadBackups()
      })
      .catch((err) => showToast('error', (err as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const offInstall = window.hive.mc.onInstallProgress((p) => setInstallProgress(p))
    const offDl = window.hive.modrinth.onDownloadProgress((p) => setDownloadProgress(p))
    const offBackup = window.hive.instances.onBackupProgress((p) =>
      setBackupProgress({ message: p.message, progress: p.progress }),
    )
    return () => {
      offInstall()
      offDl()
      offBackup()
    }
  }, [setInstallProgress, setDownloadProgress])

  if (!instance) {
    return (
      <div className="page">
        <div className="empty">
          <h3>Instance not found</h3>
          <Link to="/instances" className="btn btn-secondary">
            Back
          </Link>
        </div>
      </div>
    )
  }

  async function install() {
    setBusy('install')
    setInstallProgress({ stage: 'start', progress: 0, message: 'Starting…' })
    try {
      await window.hive.mc.install(instance!.id)
      showToast('success', 'Game files installed')
      await reload()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
      setTimeout(() => setInstallProgress(null), 1500)
    }
  }

  async function launch(acknowledgeLowMemory = false) {
    if (!loggedIn) {
      showToast('error', 'Sign in with Microsoft to play')
      navigate('/account')
      return
    }
    setBusy('launch')
    try {
      const result = await window.hive.mc.launch(instance!.id, { acknowledgeLowMemory })
      await refreshRunning()
      if (result.success) {
        showToast('success', result.message)
        await refreshAll()
        await reload()
      } else if (result.requiresConfirmation) {
        if (window.confirm(result.message)) {
          await launch(true)
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

  async function toggle(projectId: string, enabled: boolean) {
    try {
      const updated = await window.hive.instances.toggleMod(instance!.id, projectId, enabled)
      setInstance(updated)
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  async function removeMod(projectId: string, title: string) {
    if (!confirm(`Remove “${title}” from this instance?`)) return
    try {
      const updated = await window.hive.instances.removeMod(instance!.id, projectId)
      setInstance(updated)
      setUpdateMap((prev) => {
        const next = { ...prev }
        delete next[projectId]
        return next
      })
      showToast('success', `Removed ${title}`)
      await refreshAll()
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  async function updateMod(projectId: string) {
    const info = updateMap[projectId]
    const mod = instance!.mods.find((m) => m.projectId === projectId)
    if (!info?.hasUpdate || !info.latestVersionId || !mod) return

    setUpdatingId(projectId)
    try {
      const result = await window.hive.modrinth.installMod({
        instanceId: instance!.id,
        projectId,
        versionId: info.latestVersionId,
      })
      const updated = await reload()
      await refreshAll()
      const deps =
        result._installSummary?.installed.filter((i) => i.isDependency).map((i) => i.title) ?? []
      const depMsg =
        deps.length > 0
          ? ` (+ ${deps.length} dependenc${deps.length === 1 ? 'y' : 'ies'})`
          : ''
      showToast(
        'success',
        `Updated ${mod.title} to ${info.latestVersionNumber || 'latest'}${depMsg}`,
      )
      await refreshUpdateChecks(updated)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setUpdatingId(null)
      setTimeout(() => setDownloadProgress(null), 1200)
    }
  }

  async function updateAll() {
    if (updatesAvailable.length === 0) return
    setUpdatingAll(true)
    let ok = 0
    try {
      for (const info of updatesAvailable) {
        if (!info.latestVersionId) continue
        setUpdatingId(info.projectId)
        try {
          await window.hive.modrinth.installMod({
            instanceId: instance!.id,
            projectId: info.projectId,
            versionId: info.latestVersionId,
          })
          ok++
        } catch (err) {
          showToast('error', (err as Error).message)
        }
      }
      const updated = await reload()
      await refreshAll()
      await refreshUpdateChecks(updated)
      if (ok > 0) showToast('success', `Updated ${ok} mod${ok === 1 ? '' : 's'}`)
    } finally {
      setUpdatingId(null)
      setUpdatingAll(false)
      setTimeout(() => setDownloadProgress(null), 1200)
    }
  }

  async function createBackup() {
    if (!instance) return
    if (isLive) {
      showToast('error', 'Stop the game before creating a backup')
      return
    }
    setBusy('backup')
    setBackupProgress({ message: 'Starting backup…', progress: 0 })
    try {
      const info = await window.hive.instances.createBackup(instance.id, {
        includeSaves,
        label: `${instance.name} · ${new Date().toLocaleString()}`,
      })
      await reloadBackups()
      showToast(
        'success',
        `Backup saved (${formatBytes(info.sizeBytes)}${info.includeSaves ? ', with worlds' : ''})`,
      )
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
      setTimeout(() => setBackupProgress(null), 1200)
    }
  }

  async function restoreBackup(backup: InstanceBackupInfo) {
    if (!instance) return
    if (isLive) {
      showToast('error', 'Stop the game before restoring a backup')
      return
    }
    if (
      !confirm(
        `Restore “${backup.label}”?\n\nThis overwrites mods/config${
          backup.includeSaves ? '/saves' : ''
        } in this instance. A safety snapshot is created first.`,
      )
    ) {
      return
    }
    setBusy('restore')
    setBackupProgress({ message: 'Restoring…', progress: 0 })
    try {
      const res = await window.hive.instances.restoreBackup(instance.id, backup.id)
      await reload()
      await reloadBackups()
      await refreshAll()
      showToast('success', res.message)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
      setTimeout(() => setBackupProgress(null), 1200)
    }
  }

  async function removeBackup(backup: InstanceBackupInfo) {
    if (!instance) return
    if (!confirm(`Delete backup “${backup.label}”?`)) return
    try {
      await window.hive.instances.deleteBackup(instance.id, backup.id)
      await reloadBackups()
      showToast('success', 'Backup deleted')
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn btn-ghost" style={{ marginBottom: 8 }} onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1>{instance.name}</h1>
          <p>
            {loaderLabel(instance.loader)}
            {instance.loaderVersion ? ` ${instance.loaderVersion}` : ''} · Minecraft{' '}
            {instance.gameVersion}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={() => window.hive.shell.openInstanceFolder(instance.id)}
          >
            <IconFolder />
            Folder
          </button>
          <button className="btn btn-secondary" onClick={install} disabled={busy === 'install'}>
            <IconDownload />
            {busy === 'install' ? 'Installing…' : 'Install / Repair'}
          </button>
          {isLive ? (
            <button className="btn btn-danger btn-lg" onClick={() => stopGame()} disabled={!!busy}>
              <IconStop />
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary btn-lg"
              onClick={() => launch()}
              disabled={!!busy || running.running || !loggedIn}
              title={loggedIn ? 'Play' : 'Sign in with Microsoft first'}
            >
              <IconPlay />
              {busy === 'launch' ? 'Launching…' : loggedIn ? 'Play' : 'Sign in to play'}
            </button>
          )}
        </div>
      </div>

      {isLive && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="badge-row" style={{ marginBottom: 8 }}>
            <span className="badge badge-running">Running</span>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            This instance is live (PID {running.pid ?? '—'}
            {running.startedAt
              ? `, started ${new Date(running.startedAt).toLocaleTimeString()}`
              : ''}
            ). Use Stop to close Minecraft.
          </p>
        </div>
      )}

      {installProgress && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="progress-meta">
            <span>{installProgress.message}</span>
            <span>{Math.round(installProgress.progress * 100)}%</span>
          </div>
          <div className="progress-bar">
            <div style={{ width: `${Math.round(installProgress.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {downloadProgress && downloadProgress.stage !== 'done' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="progress-meta">
            <span>{downloadProgress.message}</span>
            <span>{Math.round(downloadProgress.progress * 100)}%</span>
          </div>
          <div className="progress-bar">
            <div style={{ width: `${Math.round(downloadProgress.progress * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="split">
        <section className="panel">
          <div className="page-header" style={{ marginBottom: 12 }}>
            <div>
              <h2>Installed mods</h2>
              <p className="hint" style={{ marginBottom: 0 }}>
                {instance.mods.length} mod{instance.mods.length === 1 ? '' : 's'}
                {updatesAvailable.length > 0
                  ? ` · ${updatesAvailable.length} update${updatesAvailable.length === 1 ? '' : 's'} available`
                  : checkingUpdates
                    ? ' · checking for updates…'
                    : instance.mods.length > 0
                      ? ' · all up to date'
                      : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {instance.mods.length > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => refreshUpdateChecks()}
                  disabled={checkingUpdates || updatingAll || !!updatingId}
                >
                  {checkingUpdates ? 'Checking…' : 'Check updates'}
                </button>
              )}
              {updatesAvailable.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={updateAll}
                  disabled={updatingAll || !!updatingId || checkingUpdates}
                >
                  <IconDownload />
                  {updatingAll ? 'Updating…' : `Update all (${updatesAvailable.length})`}
                </button>
              )}
              <Link className="btn btn-primary" to={`/browse?instance=${instance.id}`}>
                Browse mods
              </Link>
            </div>
          </div>

          {instance.mods.length === 0 ? (
            <div className="empty" style={{ padding: 28 }}>
              <h3>No mods installed</h3>
              <p>Search Modrinth and install mods that match this loader and version.</p>
              <Link className="btn btn-primary" to={`/browse?instance=${instance.id}`}>
                Find mods
              </Link>
            </div>
          ) : (
            <div className="list">
              {instance.mods.map((mod) => {
                const info = updateMap[mod.projectId]
                const hasUpdate = Boolean(info?.hasUpdate)
                const isUpdating = updatingId === mod.projectId
                return (
                  <div key={mod.projectId} className="list-item">
                    {mod.iconUrl ? (
                      <img
                        src={mod.iconUrl}
                        alt=""
                        width={40}
                        height={40}
                        style={{ borderRadius: 8, objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        className="mod-icon placeholder"
                        style={{ width: 40, height: 40, fontSize: 12 }}
                      >
                        {mod.title.slice(0, 1)}
                      </div>
                    )}
                    <div className="grow">
                      <div className="title">{mod.title}</div>
                      <div className="sub">
                        {mod.versionNumber}
                        {hasUpdate && info?.latestVersionNumber
                          ? ` → ${info.latestVersionNumber}`
                          : ''}
                        {' · '}
                        {mod.fileName}
                      </div>
                      <div className="badge-row" style={{ marginTop: 6 }}>
                        {hasUpdate ? (
                          <span className="badge badge-orange">Update available</span>
                        ) : info && !checkingUpdates ? (
                          <span className="badge badge-green">Installed</span>
                        ) : checkingUpdates ? (
                          <span className="badge">Checking…</span>
                        ) : null}
                      </div>
                    </div>
                    {hasUpdate && (
                      <button
                        className="btn btn-primary"
                        disabled={isUpdating || updatingAll}
                        onClick={() => updateMod(mod.projectId)}
                        title={`Update to ${info?.latestVersionNumber || 'latest'}`}
                      >
                        <IconDownload />
                        {isUpdating ? 'Updating…' : 'Update'}
                      </button>
                    )}
                    <label className="switch" title={mod.enabled ? 'Enabled' : 'Disabled'}>
                      <input
                        type="checkbox"
                        checked={mod.enabled}
                        onChange={(e) => toggle(mod.projectId, e.target.checked)}
                      />
                      <span />
                    </label>
                    <button
                      className="btn btn-ghost"
                      onClick={() => removeMod(mod.projectId, mod.title)}
                      title="Remove"
                    >
                      <IconTrash />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Details</h2>
          <p className="hint">Instance configuration</p>
          <div className="list">
            <div className="list-item">
              <div className="grow">
                <div className="sub">Loader</div>
                <div className="title">{loaderLabel(instance.loader)}</div>
              </div>
            </div>
            <div className="list-item">
              <div className="grow">
                <div className="sub">Minecraft</div>
                <div className="title">{instance.gameVersion}</div>
              </div>
            </div>
            {instance.loaderVersion && (
              <div className="list-item">
                <div className="grow">
                  <div className="sub">Loader version</div>
                  <div className="title mono">{instance.loaderVersion}</div>
                </div>
              </div>
            )}
            <div className="list-item">
              <div className="grow">
                <div className="sub">Created</div>
                <div className="title">{new Date(instance.createdAt).toLocaleString()}</div>
              </div>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 16, marginBottom: 0 }}>
            Tip: run <strong>Install / Repair</strong> once before the first launch so client jars,
            libraries, and assets are downloaded.
          </p>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <div>
            <h2>Backups</h2>
            <p className="hint" style={{ marginBottom: 0 }}>
              Snapshot mods, configs, and optional worlds. Stored under your EG Launcher data folder.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="checkbox-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={includeSaves}
                onChange={(e) => setIncludeSaves(e.target.checked)}
                disabled={busy === 'backup' || busy === 'restore'}
              />
              Include worlds (saves)
            </label>
            <button
              className="btn btn-primary"
              onClick={() => void createBackup()}
              disabled={busy === 'backup' || busy === 'restore' || isLive}
            >
              {busy === 'backup' ? 'Backing up…' : 'Create backup'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void window.hive.instances.openBackupsFolder(instance.id)}
            >
              <IconFolder />
              Open folder
            </button>
          </div>
        </div>

        {backupProgress && (
          <div style={{ marginBottom: 12 }}>
            <div className="progress-meta">
              <span>{backupProgress.message}</span>
              <span>{Math.round(backupProgress.progress * 100)}%</span>
            </div>
            <div className="progress-bar">
              <div style={{ width: `${Math.round(backupProgress.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {backups.length === 0 ? (
          <div className="empty" style={{ padding: 20 }}>
            <p>No backups yet. Create one before big mod updates.</p>
          </div>
        ) : (
          <div className="list">
            {backups.map((b) => (
              <div key={b.id} className="list-item">
                <div className="grow">
                  <div className="title">{b.label}</div>
                  <div className="sub">
                    {new Date(b.createdAt).toLocaleString()} · {formatBytes(b.sizeBytes)} ·{' '}
                    {b.modCount} mods
                    {b.includeSaves ? ' · includes worlds' : ''}
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  disabled={busy === 'backup' || busy === 'restore' || isLive}
                  onClick={() => void restoreBackup(b)}
                >
                  {busy === 'restore' ? '…' : 'Restore'}
                </button>
                <button className="btn btn-ghost" onClick={() => void removeBackup(b)} title="Delete">
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
