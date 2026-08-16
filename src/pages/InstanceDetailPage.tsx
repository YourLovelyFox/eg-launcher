import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type {
  EgpackExportOptions,
  GameInstance,
  InstanceBackupInfo,
  InstanceProfile,
  LoaderType,
} from '../../shared/types'
import { ExportEgpackModal } from '../components/ExportEgpackModal'
import { EditInstanceModal } from '../components/EditInstanceModal'
import {
  countPrimaryMods,
  quotasForAccount,
} from '../../shared/offlineLimits'
import { IconDownload, IconFolder, IconPlay, IconStop, IconTrash } from '../components/Icons'
import { checkModsUpdates, type ModUpdateInfo } from '../modUpdates'
import { pushRecent } from '../qolPrefs'
import { loaderIconColor, loaderLabel, useAppStore } from '../store'

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
  const activeAcc = accounts.find((a) => a.id === activeAccountId)
  const offlineActive = Boolean(
    activeAcc && (activeAcc.type === 'offline' || activeAcc.id.startsWith('offline-')),
  )
  const offlineQuotas = quotasForAccount(activeAcc)
  const [busy, setBusy] = useState<
    'install' | 'launch' | 'backup' | 'restore' | 'export' | 'edit' | null
  >(null)
  const [packProgress, setPackProgress] = useState<{ message: string; progress: number } | null>(
    null,
  )
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [updateMap, setUpdateMap] = useState<Record<string, ModUpdateInfo>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updateCheckProgress, setUpdateCheckProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [backups, setBackups] = useState<InstanceBackupInfo[]>([])
  const [includeSaves, setIncludeSaves] = useState(true)
  const [backupProgress, setBackupProgress] = useState<{ message: string; progress: number } | null>(
    null,
  )
  const [profileName, setProfileName] = useState('Performance')
  const [profileJvm, setProfileJvm] = useState('')
  const [profileRam, setProfileRam] = useState('')
  const [profilePacks, setProfilePacks] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [modFilter, setModFilter] = useState('')
  const [cancelUpdateAll, setCancelUpdateAll] = useState(false)
  const cancelUpdateAllRef = useRef(false)
  const [loadingInstance, setLoadingInstance] = useState(true)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const isLive = !!(instance && running.running && running.instanceId === instance.id)
  const loggedIn = accounts.some((a) => a.id === activeAccountId)
  const updatesAvailable = Object.values(updateMap).filter((u) => u.hasUpdate)
  const incompatibleMods = Object.values(updateMap).filter((u) => u.incompatible)

  // Must stay above any conditional return (Rules of Hooks)
  const filteredMods = useMemo(() => {
    const mods = instance?.mods || []
    const q = modFilter.trim().toLowerCase()
    const filtered = !q
      ? mods
      : mods.filter(
          (m) =>
            m.title.toLowerCase().includes(q) ||
            m.slug.toLowerCase().includes(q) ||
            m.fileName.toLowerCase().includes(q),
        )
    return [...filtered].sort((a, b) => {
      const ai = updateMap[a.projectId]
      const bi = updateMap[b.projectId]
      const ar = ai?.incompatible ? 0 : ai?.hasUpdate ? 1 : 2
      const br = bi?.incompatible ? 0 : bi?.hasUpdate ? 1 : 2
      if (ar !== br) return ar - br
      return a.title.localeCompare(b.title)
    })
  }, [instance?.mods, modFilter, updateMap])

  async function reload(): Promise<GameInstance | null> {
    if (!id) return null
    const data = await window.hive.instances.get(id)
    setInstance(data)
    return data
  }

  async function submitRename() {
    if (!instance) return
    const next = renameValue.trim()
    if (!next) {
      showToast('error', 'Name cannot be empty')
      return
    }
    if (isLive) {
      showToast('error', 'Stop the game before renaming this instance')
      return
    }
    setRenaming(true)
    try {
      const oldId = instance.id
      const updated = await window.hive.instances.rename(instance.id, next)
      setInstance(updated)
      setRenameOpen(false)
      await refreshAll()
      // Folder / id may change to match the name — keep URL in sync
      if (updated.id !== oldId) {
        navigate(`/instances/${encodeURIComponent(updated.id)}`, { replace: true })
      }
      showToast('success', `Renamed to “${updated.name}”`)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setRenaming(false)
    }
  }

  async function applyInstanceEdit(patch: {
    gameVersion: string
    loader: LoaderType
    loaderVersion?: string
  }) {
    if (!instance) return
    if (isLive) {
      showToast('error', 'Stop the game before changing version or loader')
      return
    }
    setBusy('edit')
    setInstallProgress({ stage: 'start', progress: 0, message: 'Saving instance…' })
    try {
      const updated = await window.hive.instances.update(instance.id, {
        gameVersion: patch.gameVersion,
        loader: patch.loader,
        // Empty string so IPC actually overwrites the previous loader build
        loaderVersion: patch.loader === 'vanilla' ? '' : patch.loaderVersion || '',
        iconColor: loaderIconColor(patch.loader),
      })
      setInstance(updated)
      await window.hive.mc.install(updated.id)
      const reloaded = await reload()
      await refreshAll()
      const map = await refreshUpdateChecks(reloaded)
      const incompat = Object.values(map).filter((u) => u.incompatible)
      const updates = Object.values(map).filter((u) => u.hasUpdate)
      let disabled = 0
      if (reloaded && incompat.length > 0) {
        for (const info of incompat) {
          const mod = reloaded.mods.find((m) => m.projectId === info.projectId)
          if (mod?.enabled) {
            await window.hive.instances.toggleMod(reloaded.id, info.projectId, false)
            disabled++
          }
        }
        if (disabled > 0) {
          await reload()
        }
      }

      const parts: string[] = [
        `Now ${loaderLabel(patch.loader)} ${patch.gameVersion}`,
      ]
      if (updates.length > 0) {
        parts.push(
          `${updates.length} mod${updates.length === 1 ? '' : 's'} have a matching build — use Update Mods`,
        )
      }
      if (incompat.length > 0) {
        parts.push(
          `${incompat.length} incompatible${disabled > 0 ? ` (${disabled} disabled)` : ''}`,
        )
      }
      showToast(incompat.length > 0 && updates.length === 0 ? 'info' : 'success', parts.join(' · '))
      setEditOpen(false)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
      setTimeout(() => setInstallProgress(null), 1500)
    }
  }

  async function disableIncompatible() {
    if (!instance || incompatibleMods.length === 0) return
    let disabled = 0
    for (const info of incompatibleMods) {
      const mod = instance.mods.find((m) => m.projectId === info.projectId)
      if (mod?.enabled) {
        await window.hive.instances.toggleMod(instance.id, info.projectId, false)
        disabled++
      }
    }
    await reload()
    await refreshAll()
    showToast(
      'success',
      disabled > 0
        ? `Disabled ${disabled} incompatible mod${disabled === 1 ? '' : 's'}`
        : 'Incompatible mods are already disabled',
    )
  }

  async function addProfile() {
    if (!instance) return
    setProfileBusy(true)
    try {
      const ram = profileRam.trim() ? Number(profileRam) : null
      const profile: InstanceProfile = {
        id: `prof-${Date.now().toString(36)}`,
        name: profileName.trim() || 'Profile',
        jvmArgs: profileJvm.trim() || undefined,
        ramMaxMb: ram && Number.isFinite(ram) && ram >= 1024 ? ram : null,
        resourcePacks: profilePacks
          .split(/[,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      }
      const profiles = [...(instance.profiles || []), profile]
      const updated = await window.hive.instances.update(instance.id, {
        profiles,
        activeProfileId: instance.activeProfileId || profile.id,
      })
      setInstance(updated)
      await refreshAll()
      showToast('success', `Profile “${profile.name}” added`)
      setProfileJvm('')
      setProfileRam('')
      setProfilePacks('')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setProfileBusy(false)
    }
  }

  async function setActiveProfile(profileId: string) {
    if (!instance) return
    setProfileBusy(true)
    try {
      const updated = await window.hive.instances.update(instance.id, {
        activeProfileId: profileId,
      })
      setInstance(updated)
      await refreshAll()
      showToast('success', 'Active profile updated')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setProfileBusy(false)
    }
  }

  async function removeProfile(profileId: string) {
    if (!instance) return
    setProfileBusy(true)
    try {
      const profiles = (instance.profiles || []).filter((p) => p.id !== profileId)
      const activeProfileId =
        instance.activeProfileId === profileId
          ? profiles[0]?.id || null
          : instance.activeProfileId
      const updated = await window.hive.instances.update(instance.id, {
        profiles,
        activeProfileId,
      })
      setInstance(updated)
      await refreshAll()
      showToast('success', 'Profile removed')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setProfileBusy(false)
    }
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

  async function refreshUpdateChecks(
    target?: GameInstance | null,
  ): Promise<Record<string, ModUpdateInfo>> {
    const inst = target ?? instance
    if (!inst || inst.mods.length === 0) {
      setUpdateMap({})
      setUpdateCheckProgress(null)
      return {}
    }
    setCheckingUpdates(true)
    setUpdateCheckProgress({ done: 0, total: inst.mods.length })
    try {
      const map = await checkModsUpdates(
        inst.mods,
        inst.gameVersion,
        inst.loader,
        4,
        (done, total) => setUpdateCheckProgress({ done, total }),
      )
      setUpdateMap(map)
      return map
    } catch (err) {
      showToast('error', (err as Error).message)
      return {}
    } finally {
      setCheckingUpdates(false)
      setUpdateCheckProgress(null)
    }
  }

  useEffect(() => {
    setLoadingInstance(true)
    setInstance(null)
    reload()
      .then((data) => {
        void refreshUpdateChecks(data)
        void reloadBackups()
      })
      .catch((err) => showToast('error', (err as Error).message))
      .finally(() => setLoadingInstance(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const offInstall = window.hive.mc.onInstallProgress((p) => setInstallProgress(p))
    const offDl = window.hive.mods.onDownloadProgress((p) => setDownloadProgress(p))
    const offBackup = window.hive.instances.onBackupProgress((p) =>
      setBackupProgress({ message: p.message, progress: p.progress }),
    )
    return () => {
      offInstall()
      offDl()
      offBackup()
    }
  }, [setInstallProgress, setDownloadProgress])

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
      showToast('error', 'Sign in to play')
      navigate('/account')
      return
    }
    setBusy('launch')
    try {
      const result = await window.hive.mc.launch(instance!.id, { acknowledgeLowMemory })
      await refreshRunning()
      if (result.success) {
        pushRecent({
          kind: 'played',
          label: `Played ${instance!.name}`,
          href: `/instances/${instance!.id}`,
        })
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
      const result = await window.hive.mods.installMod({
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
    if (updatesAvailable.length === 0 || !instance) return
    const batch = updatesAvailable
      .filter((u) => u.latestVersionId)
      .map((u) => ({
        projectId: u.projectId,
        versionId: u.latestVersionId as string,
      }))
    if (batch.length === 0) return

    setUpdatingAll(true)
    cancelUpdateAllRef.current = false
    setCancelUpdateAll(false)
    setUpdatingId(null)
    try {
      const result = await window.hive.mods.installModsBatch({
        instanceId: instance.id,
        mods: batch,
      })
      const updated = await reload()
      await refreshAll()
      await refreshUpdateChecks(updated)

      const ok = result._installSummary?.installed.filter((i) => !i.isDependency).length ?? 0
      const deps = result._installSummary?.installed.filter((i) => i.isDependency).length ?? 0
      const fail = result._installSummary?.failed.length ?? 0
      const parts: string[] = []
      if (ok > 0) parts.push(`Updated ${ok} mod${ok === 1 ? '' : 's'}`)
      if (deps > 0) parts.push(`${deps} dependenc${deps === 1 ? 'y' : 'ies'}`)
      if (fail > 0) parts.push(`${fail} failed`)
      if (parts.length) {
        showToast(fail > 0 && ok === 0 ? 'error' : fail > 0 ? 'info' : 'success', parts.join(' · '))
      } else {
        showToast('info', 'All selected mods were already up to date')
      }
      if (fail > 0 && result._installSummary?.failed[0]) {
        showToast('error', result._installSummary.failed[0].error)
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setUpdatingId(null)
      setUpdatingAll(false)
      cancelUpdateAllRef.current = false
      setCancelUpdateAll(false)
      setTimeout(() => setDownloadProgress(null), 1200)
    }
  }

  async function bulkSetEnabled(enabled: boolean) {
    if (!instance) return
    const mods = instance.mods
    for (const m of mods) {
      if (m.enabled === enabled) continue
      await window.hive.instances.toggleMod(instance.id, m.projectId, enabled)
    }
    await reload()
    await refreshAll()
    showToast('success', enabled ? 'Enabled all mods' : 'Disabled all mods')
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

  function openExportModal() {
    if (!instance) return
    if (isLive) {
      showToast('error', 'Stop the game before exporting')
      return
    }
    setExportModalOpen(true)
  }

  async function runExport(options: EgpackExportOptions) {
    if (!instance) return
    if (isLive) {
      showToast('error', 'Stop the game before exporting')
      return
    }
    setBusy('export')
    setPackProgress({ message: 'Choose save location…', progress: 0 })
    const off = window.hive.instances.onPackProgress((e) => {
      setPackProgress({ message: e.message, progress: e.progress })
    })
    try {
      const res = await window.hive.instances.exportEgpack(instance.id, options)
      if (!res.ok) {
        setPackProgress(null)
        return
      }
      setExportModalOpen(false)
      showToast(
        'success',
        `Exported .egpack (${formatBytes(res.size)}) → ${res.path.split(/[/\\]/).pop()}`,
      )
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      off()
      setBusy(null)
      setPackProgress(null)
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

  if (loadingInstance) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
      </div>
    )
  }

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

  return (
    <div className="page">
      <ExportEgpackModal
        open={exportModalOpen}
        instance={instance}
        busy={busy === 'export'}
        onClose={() => {
          if (busy !== 'export') setExportModalOpen(false)
        }}
        onExport={(options) => void runExport(options)}
      />
      <EditInstanceModal
        open={editOpen}
        instance={instance}
        busy={busy === 'edit'}
        installProgress={busy === 'edit' ? installProgress : null}
        onClose={() => {
          if (busy !== 'edit') setEditOpen(false)
        }}
        onApply={(patch) => applyInstanceEdit(patch)}
      />
      {renameOpen && (
        <div
          className="update-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => !renaming && setRenameOpen(false)}
        >
          <div className="update-modal panel" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Rename instance</h2>
            <p className="hint">
              This also renames the folder under your EG Launcher data so Explorer shows the name,
              not a random ID.
            </p>
            <input
              className="input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitRename()
                if (e.key === 'Escape') setRenameOpen(false)
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={renaming}
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={renaming || !renameValue.trim()}
                onClick={() => void submitRename()}
              >
                {renaming ? 'Renaming…' : 'Save name'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="page-header">
        <div>
          <button className="btn btn-ghost" style={{ marginBottom: 8 }} onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {instance.name}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '4px 10px', fontSize: 13 }}
              disabled={isLive || renaming}
              onClick={() => {
                setRenameValue(instance.name)
                setRenameOpen(true)
              }}
              title={isLive ? 'Stop the game to rename' : 'Rename instance'}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '4px 10px', fontSize: 13 }}
              disabled={isLive || busy === 'edit'}
              onClick={() => setEditOpen(true)}
              title={isLive ? 'Stop the game to edit version or loader' : 'Change version or loader'}
            >
              Edit
            </button>
          </h1>
          <p>
            {loaderLabel(instance.loader)}
            {instance.loaderVersion ? ` ${instance.loaderVersion}` : ''} · Minecraft{' '}
            {instance.gameVersion}
          </p>
          <p className="hint mono" style={{ marginBottom: 0 }}>
            Folder: eg-data/instances/{instance.id}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={() => window.hive.shell.openInstancePath(instance.id, 'root')}
            title="Open instance folder"
          >
            <IconFolder />
            Folder
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => openExportModal()}
            disabled={!!busy || isLive}
            title="Export as .egpack — choose name and what to include"
          >
            {busy === 'export' ? 'Exporting…' : 'Export .egpack'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => window.hive.shell.openInstancePath(instance.id, 'screenshots')}
            title="Screenshots"
          >
            Shots
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => window.hive.shell.openInstancePath(instance.id, 'logs')}
            title="Logs"
          >
            Logs
          </button>
          <button className="btn btn-secondary" onClick={install} disabled={busy === 'install' || isLive}>
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
              title={loggedIn ? 'Play' : 'Sign in first'}
            >
              <IconPlay />
              {busy === 'launch'
                ? 'Launching…'
                : running.running
                  ? 'Game running'
                  : loggedIn
                    ? 'Play'
                    : 'Sign in to play'}
            </button>
          )}
        </div>
      </div>

      {packProgress && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="progress-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{packProgress.message}</span>
            <span>{Math.round(packProgress.progress * 100)}%</span>
          </div>
          <div className="progress-bar">
            <div style={{ width: `${Math.round(packProgress.progress * 100)}%` }} />
          </div>
        </div>
      )}

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

      {installProgress && !editOpen && (
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
              <h2>Installed content</h2>
              <p className="hint" style={{ marginBottom: 0 }}>
                {instance.mods.length} mod{instance.mods.length === 1 ? '' : 's'}
                {offlineActive
                  ? ` · ${countPrimaryMods(instance.mods)}/${offlineQuotas.mods} count toward offline limit (deps free)`
                  : ''}
                {updatesAvailable.length > 0
                  ? ` · ${updatesAvailable.length} update${updatesAvailable.length === 1 ? '' : 's'} available`
                  : ''}
                {incompatibleMods.length > 0
                  ? ` · ${incompatibleMods.length} incompatible`
                  : ''}
                {updatesAvailable.length === 0 && incompatibleMods.length === 0
                  ? checkingUpdates
                    ? updateCheckProgress && updateCheckProgress.total > 0
                      ? ` · checking updates ${updateCheckProgress.done}/${updateCheckProgress.total}…`
                      : ' · checking for updates…'
                    : instance.mods.length > 0
                      ? ' · all up to date'
                      : ''
                  : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {instance.mods.length > 0 && (
                <>
                  <button
                    className="btn btn-ghost"
                    onClick={() => void bulkSetEnabled(true)}
                    disabled={updatingAll || !!updatingId}
                    title="Enable all mods"
                  >
                    Enable all
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => void bulkSetEnabled(false)}
                    disabled={updatingAll || !!updatingId}
                    title="Disable all mods"
                  >
                    Disable all
                  </button>
                </>
              )}
              {instance.mods.length > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => refreshUpdateChecks()}
                  disabled={checkingUpdates || updatingAll || !!updatingId}
                >
                  {checkingUpdates
                    ? updateCheckProgress && updateCheckProgress.total > 0
                      ? `Checking ${updateCheckProgress.done}/${updateCheckProgress.total}…`
                      : 'Checking…'
                    : 'Check updates'}
                </button>
              )}
              {incompatibleMods.some((u) =>
                instance.mods.find((m) => m.projectId === u.projectId && m.enabled),
              ) && (
                <button
                  className="btn btn-ghost"
                  onClick={() => void disableIncompatible()}
                  disabled={updatingAll || !!updatingId || checkingUpdates}
                  title="Turn off mods with no matching build for this version/loader"
                >
                  Disable incompatible
                </button>
              )}
              {updatesAvailable.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={() => void updateAll()}
                  disabled={updatingAll || !!updatingId || checkingUpdates}
                  title="Download every available update in parallel as one job"
                >
                  <IconDownload />
                  {updatingAll
                    ? `Updating all (${updatesAvailable.length})…`
                    : `Update Mods (${updatesAvailable.length})`}
                </button>
              )}
              <Link className="btn btn-primary" to={`/browse?instance=${instance.id}`}>
                Add content
              </Link>
            </div>
          </div>

          {(updatesAvailable.length > 0 || incompatibleMods.length > 0) && (
            <div
              className="panel"
              style={{
                marginBottom: 12,
                padding: 12,
                background: 'rgba(255, 200, 87, 0.06)',
                border: '1px solid rgba(255, 200, 87, 0.18)',
              }}
            >
              <div className="title" style={{ marginBottom: 4 }}>
                Update Mods
              </div>
              <p className="hint" style={{ marginBottom: 0 }}>
                {updatesAvailable.length > 0
                  ? `${updatesAvailable.length} mod${updatesAvailable.length === 1 ? '' : 's'} ${
                      updatesAvailable.length === 1 ? 'has' : 'have'
                    } a matching build for ${loaderLabel(instance.loader)} ${instance.gameVersion}.`
                  : `No replacement builds found.`}
                {incompatibleMods.length > 0
                  ? ` ${incompatibleMods.length} ${
                      incompatibleMods.length === 1 ? 'is' : 'are'
                    } incompatible with this loader/version and ${
                      incompatibleMods.length === 1 ? 'was' : 'were'
                    } listed so you can disable or remove ${
                      incompatibleMods.length === 1 ? 'it' : 'them'
                    }.`
                  : ''}
              </p>
            </div>
          )}

          {instance.mods.length > 0 && (
            <input
              className="input"
              style={{ marginBottom: 12 }}
              placeholder="Search installed content…"
              value={modFilter}
              onChange={(e) => setModFilter(e.target.value)}
            />
          )}

          {instance.mods.length === 0 ? (
            <div className="empty" style={{ padding: 28 }}>
              <h3>No content installed</h3>
              <p>Browse the catalog and add content that matches this loader and version.</p>
              <Link className="btn btn-primary" to={`/browse?instance=${instance.id}`}>
                Browse content
              </Link>
            </div>
          ) : filteredMods.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>
              <p>No mods match “{modFilter}”.</p>
            </div>
          ) : (
            <div className="list">
              {filteredMods.map((mod) => {
                const info = updateMap[mod.projectId]
                const hasUpdate = Boolean(info?.hasUpdate)
                const incompatible = Boolean(info?.incompatible)
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
                        {mod.isDependency ? (
                          <span className="badge" title="Required dependency — does not count toward offline mod limit">
                            Dependency
                          </span>
                        ) : null}
                        {incompatible ? (
                          <span
                            className="badge badge-red"
                            title={`No catalog build for ${loaderLabel(instance.loader)} ${instance.gameVersion}`}
                          >
                            Incompatible
                          </span>
                        ) : hasUpdate ? (
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
          <div className="page-header" style={{ marginBottom: 12 }}>
            <div>
              <h2>Details</h2>
              <p className="hint" style={{ marginBottom: 0 }}>Instance configuration</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isLive || busy === 'edit'}
              onClick={() => setEditOpen(true)}
              title={isLive ? 'Stop the game to edit' : 'Change Minecraft version or loader'}
            >
              Edit
            </button>
          </div>
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
            Use <strong>Edit</strong> to change Minecraft version or loader. After a change, matching
            mods show under <strong>Update Mods</strong>; incompatible ones are disabled. Run{' '}
            <strong>Install / Repair</strong> if you only need to redownload game files.
          </p>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Launch profiles</h2>
        <p className="hint">
          Same mods, different JVM args / RAM / resource packs. Active profile is used on Play.
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>Profile name</label>
            <input
              className="input"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Performance"
            />
          </div>
          <div className="form-row">
            <label>Extra JVM args</label>
            <input
              className="input"
              value={profileJvm}
              onChange={(e) => setProfileJvm(e.target.value)}
              placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
            />
          </div>
          <div className="form-row">
            <label>Max RAM MB (optional)</label>
            <input
              className="input"
              value={profileRam}
              onChange={(e) => setProfileRam(e.target.value)}
              placeholder="Leave empty for Settings default"
            />
          </div>
          <div className="form-row">
            <label>Resource packs (comma-separated file names)</label>
            <input
              className="input"
              value={profilePacks}
              onChange={(e) => setProfilePacks(e.target.value)}
              placeholder="MyPack.zip, VanillaTweaks.zip"
            />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 10 }}
          disabled={profileBusy || !instance || !profileName.trim()}
          onClick={() => void addProfile()}
        >
          {profileBusy ? '…' : 'Add profile'}
        </button>
        {(instance?.profiles || []).length > 0 && (
          <div className="list" style={{ marginTop: 14 }}>
            {(instance?.profiles || []).map((p) => {
              const active = instance?.activeProfileId === p.id
              return (
                <div key={p.id} className="list-item">
                  <div className="grow">
                    <div className="title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {p.name}
                      {active && <span className="badge badge-green">Active</span>}
                    </div>
                    <div className="sub mono">
                      {p.ramMaxMb ? `${p.ramMaxMb} MB · ` : ''}
                      {p.jvmArgs || 'default JVM'}
                      {p.resourcePacks?.length ? ` · packs: ${p.resourcePacks.join(', ')}` : ''}
                    </div>
                  </div>
                  {!active && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={profileBusy}
                      onClick={() => void setActiveProfile(p.id)}
                    >
                      Use
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={profileBusy}
                    onClick={() => void removeProfile(p.id)}
                  >
                    Delete
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

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
