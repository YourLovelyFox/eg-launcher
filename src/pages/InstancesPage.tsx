import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreateInstanceModal } from '../components/CreateInstanceModal'
import { IconPlay, IconPlus, IconStop, IconTrash } from '../components/Icons'
import { checkModsUpdates } from '../modUpdates'
import { loadQolPrefs, pushRecent, setLastInstanceId, togglePinnedInstance } from '../qolPrefs'
import { loaderLabel, useAppStore } from '../store'

export function InstancesPage() {
  const navigate = useNavigate()
  const {
    instances,
    accounts,
    activeAccountId,
    showToast,
    refreshAll,
    running,
    stopGame,
    refreshRunning,
    setSelectedInstanceId,
  } = useAppStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [updateCounts, setUpdateCounts] = useState<Record<string, number>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [prefsTick, setPrefsTick] = useState(0)
  const [importing, setImporting] = useState(false)
  const [packProgress, setPackProgress] = useState<{ message: string; progress: number } | null>(
    null,
  )
  const loggedIn = accounts.some((a) => a.id === activeAccountId)

  const sorted = useMemo(() => {
    const pinned = loadQolPrefs().pinnedInstanceIds
    const last = loadQolPrefs().lastInstanceId
    return [...instances].sort((a, b) => {
      const ap = pinned.includes(a.id) ? 0 : 1
      const bp = pinned.includes(b.id) ? 0 : 1
      if (ap !== bp) return ap - bp
      if (a.id === last) return -1
      if (b.id === last) return 1
      return a.name.localeCompare(b.name)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, prefsTick])

  useEffect(() => {
    let cancelled = false
    async function scan() {
      if (instances.length === 0) {
        setUpdateCounts({})
        return
      }
      setCheckingUpdates(true)
      const next: Record<string, number> = {}
      try {
        for (const inst of instances) {
          if (cancelled) return
          if (!inst.mods.length) {
            next[inst.id] = 0
            continue
          }
          try {
            const map = await checkModsUpdates(inst.mods, inst.gameVersion, inst.loader)
            next[inst.id] = Object.values(map).filter((u) => u.hasUpdate).length
          } catch {
            next[inst.id] = 0
          }
        }
        if (!cancelled) setUpdateCounts(next)
      } finally {
        if (!cancelled) setCheckingUpdates(false)
      }
    }
    void scan()
    return () => {
      cancelled = true
    }
  }, [instances])

  const totalUpdates = Object.values(updateCounts).reduce((a, b) => a + b, 0)

  async function launch(id: string, acknowledgeLowMemory = false) {
    if (!loggedIn) {
      showToast('error', 'Sign in to play')
      navigate('/account')
      return
    }
    setLaunchingId(id)
    setSelectedInstanceId(id)
    setLastInstanceId(id)
    try {
      const result = await window.hive.mc.launch(id, { acknowledgeLowMemory })
      await refreshRunning()
      if (result.success) {
        const name = instances.find((i) => i.id === id)?.name || 'instance'
        pushRecent({ kind: 'played', label: `Played ${name}`, href: `/instances/${id}` })
        showToast('success', result.message)
      } else if (result.requiresConfirmation) {
        if (window.confirm(result.message)) {
          await launch(id, true)
          return
        }
      } else {
        if (result.message.length > 120 || result.message.includes('\n')) {
          window.alert(result.message)
        }
        showToast('error', result.message.split('\n')[0])
      }
      await refreshAll()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setLaunchingId(null)
    }
  }

  async function remove(id: string, name: string) {
    if (running.running && running.instanceId === id) {
      showToast('error', 'Stop the game before deleting this instance')
      return
    }
    if (!confirm(`Delete instance “${name}”? This cannot be undone.`)) return
    try {
      await window.hive.instances.delete(id)
      await refreshAll()
      showToast('success', `Deleted “${name}”`)
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  async function importPack() {
    if (importing) return
    setImporting(true)
    setPackProgress({ message: 'Choose a pack…', progress: 0 })
    const off = window.hive.instances.onPackProgress((e) => {
      setPackProgress({ message: e.message, progress: e.progress })
    })
    try {
      const res = await window.hive.instances.importPack()
      if (!res.ok) {
        setPackProgress(null)
        return
      }
      await refreshAll()
      setSelectedInstanceId(res.instance.id)
      pushRecent({
        kind: 'played',
        label: `Imported ${res.instance.name}`,
        href: `/instances/${encodeURIComponent(res.instance.id)}`,
      })
      showToast(
        'success',
        `Imported “${res.instance.name}” from .${res.format === 'egpack' ? 'egpack' : 'mrpack'}`,
      )
      navigate(`/instances/${encodeURIComponent(res.instance.id)}`)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      off()
      setImporting(false)
      setPackProgress(null)
    }
  }

  function playLabel(id: string): string {
    if (running.running && running.instanceId === id) return 'Running'
    if (launchingId === id) return 'Launching…'
    return loggedIn ? 'Play' : 'Sign in'
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Instances</h1>
          <p>
            Double-click to play · Import .egpack/.mrpack (same format) · Export as .egpack
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {running.running && (
            <button className="btn btn-danger" onClick={() => stopGame()}>
              <IconStop />
              Stop
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => void importPack()} disabled={importing}>
            {importing ? 'Importing…' : 'Import pack'}
          </button>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <IconPlus />
            New instance
          </button>
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
          <p className="hint" style={{ marginBottom: 0, marginTop: 8 }}>
            Same format as Modrinth packs: import <strong>.egpack</strong> or <strong>.mrpack</strong>.
            Export uses <strong>.egpack</strong> only (identical structure to .mrpack).
          </p>
        </div>
      )}

      {running.running && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="list-item" style={{ border: 'none', background: 'transparent', padding: 0 }}>
            <span className="badge badge-running">Running</span>
            <div className="grow">
              <div className="title">{running.instanceName || 'Minecraft'}</div>
              <div className="sub">PID {running.pid ?? '—'}</div>
            </div>
            <button className="btn btn-danger" onClick={() => stopGame()}>
              <IconStop />
              Stop
            </button>
          </div>
        </div>
      )}

      {totalUpdates > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="list-item" style={{ border: 'none', background: 'transparent', padding: 0 }}>
            <span className="badge badge-orange">Updates</span>
            <div className="grow">
              <div className="title">
                {totalUpdates} mod update{totalUpdates === 1 ? '' : 's'} available
              </div>
              <div className="sub">Open an instance to update mods one-by-one or all at once.</div>
            </div>
          </div>
        </div>
      )}

      {instances.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet</h3>
          <p>Create an instance, install the game files, then add mods from Browse.</p>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <IconPlus />
            Create instance
          </button>
        </div>
      ) : (
        <div className="grid grid-instances">
          {sorted.map((inst) => {
            const isLive = running.running && running.instanceId === inst.id
            const updates = updateCounts[inst.id] ?? 0
            const pinned = loadQolPrefs().pinnedInstanceIds.includes(inst.id)
            const last = loadQolPrefs().lastInstanceId === inst.id
            return (
              <div
                key={inst.id}
                className="card card-clickable instance-card"
                onClick={() => {
                  setSelectedInstanceId(inst.id)
                  navigate(`/instances/${encodeURIComponent(inst.id)}`)
                }}
                onDoubleClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!isLive && launchingId !== inst.id && !running.running) {
                    void launch(inst.id)
                  }
                }}
                title="Double-click to play"
              >
                <div className="instance-top">
                  <div className="instance-icon" style={{ background: inst.iconColor || '#1bd96a' }}>
                    {inst.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="instance-title">
                      {pinned ? '★ ' : ''}
                      {inst.name}
                      {last ? (
                        <span className="badge" style={{ marginLeft: 6 }}>
                          Last
                        </span>
                      ) : null}
                    </div>
                    <div className="instance-sub">
                      {loaderLabel(inst.loader)} {inst.loaderVersion ? inst.loaderVersion : ''} ·{' '}
                      {inst.gameVersion}
                    </div>
                    <div className="badge-row" style={{ marginTop: 8 }}>
                      <span className="badge badge-green">{loaderLabel(inst.loader)}</span>
                      <span className="badge">{inst.mods.length} mods</span>
                      {updates > 0 && (
                        <span className="badge badge-orange">
                          {updates} update{updates === 1 ? '' : 's'}
                        </span>
                      )}
                      {checkingUpdates && inst.mods.length > 0 && updates === 0 && (
                        <span className="badge">Checking…</span>
                      )}
                      {isLive && <span className="badge badge-running">Running</span>}
                      {launchingId === inst.id && !isLive && (
                        <span className="badge badge-orange">Launching…</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-ghost"
                    title={pinned ? 'Unpin' : 'Pin'}
                    onClick={() => {
                      togglePinnedInstance(inst.id)
                      setPrefsTick((n) => n + 1)
                    }}
                  >
                    {pinned ? '★' : '☆'}
                  </button>
                  {isLive ? (
                    <button className="btn btn-danger" onClick={() => stopGame()}>
                      <IconStop />
                      Stop
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      disabled={launchingId === inst.id || running.running || !loggedIn}
                      onClick={() => void launch(inst.id)}
                      title={loggedIn ? 'Play' : 'Sign in first'}
                    >
                      <IconPlay />
                      {playLabel(inst.id)}
                    </button>
                  )}
                  <button className="btn btn-danger" onClick={() => remove(inst.id, inst.name)}>
                    <IconTrash />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <CreateInstanceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          pushRecent({ kind: 'created_instance', label: 'Created instance', href: `/instances/${id}` })
          setSelectedInstanceId(id)
          navigate(`/instances/${id}`)
        }}
      />
    </div>
  )
}
