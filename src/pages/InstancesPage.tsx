import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreateInstanceModal } from '../components/CreateInstanceModal'
import { IconPlay, IconPlus, IconStop, IconTrash } from '../components/Icons'
import { checkModsUpdates } from '../modUpdates'
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
  } = useAppStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [updateCounts, setUpdateCounts] = useState<Record<string, number>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const loggedIn = accounts.some((a) => a.id === activeAccountId)

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
        // Sequential per instance to avoid hammering Modrinth
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
      showToast('error', 'Sign in with Microsoft to play')
      navigate('/account')
      return
    }
    setLaunchingId(id)
    try {
      const result = await window.hive.mc.launch(id, { acknowledgeLowMemory })
      await refreshRunning()
      if (result.success) showToast('success', result.message)
      else if (result.requiresConfirmation) {
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Instances</h1>
          <p>Your Minecraft installs — Vanilla, Fabric, Forge, and NeoForge.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {running.running && (
            <button className="btn btn-danger" onClick={() => stopGame()}>
              <IconStop />
              Stop
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <IconPlus />
            New instance
          </button>
        </div>
      </div>

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
          {instances.map((inst) => {
            const isLive = running.running && running.instanceId === inst.id
            const updates = updateCounts[inst.id] ?? 0
            return (
              <div
                key={inst.id}
                className="card card-clickable instance-card"
                onClick={() => navigate(`/instances/${inst.id}`)}
              >
                <div className="instance-top">
                  <div className="instance-icon" style={{ background: inst.iconColor || '#1bd96a' }}>
                    {inst.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="instance-title">{inst.name}</div>
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
                      {inst.lastPlayed && !isLive && (
                        <span className="badge">
                          Played {new Date(inst.lastPlayed).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  {isLive ? (
                    <button className="btn btn-danger" onClick={() => stopGame()}>
                      <IconStop />
                      Stop
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      disabled={launchingId === inst.id || running.running || !loggedIn}
                      onClick={() => launch(inst.id)}
                      title={loggedIn ? 'Play' : 'Sign in with Microsoft first'}
                    >
                      <IconPlay />
                      {launchingId === inst.id ? '…' : loggedIn ? 'Play' : 'Sign in'}
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
        onCreated={(id) => navigate(`/instances/${id}`)}
      />
    </div>
  )
}
