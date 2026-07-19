import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreateInstanceModal } from '../components/CreateInstanceModal'
import { IconPlay, IconPlus, IconStop } from '../components/Icons'
import { PlayerHeadWithFallback } from '../components/PlayerHead'
import { loaderLabel, useAppStore } from '../store'

export function HomePage() {
  const navigate = useNavigate()
  const { instances, accounts, activeAccountId, showToast, refreshAll, running, stopGame, refreshRunning } =
    useAppStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const active = accounts.find((a) => a.id === activeAccountId)
  const recent = instances.slice(0, 6)

  const loggedIn = Boolean(active)

  async function launch(id: string) {
    if (!loggedIn) {
      showToast('error', 'Sign in with Microsoft to play')
      navigate('/account')
      return
    }
    setLaunchingId(id)
    try {
      const result = await window.hive.mc.launch(id)
      await refreshRunning()
      if (result.success) {
        showToast('success', result.message)
        await refreshAll()
      } else {
        if (result.message.length > 120 || result.message.includes('\n')) {
          window.alert(result.message)
        }
        showToast('error', result.message.split('\n')[0])
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setLaunchingId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="kicker">EG Launcher</div>
          <h1 className="welcome-heading">
            {loggedIn ? (
              <>
                Welcome,{' '}
                <span className="welcome-user">
                  <PlayerHeadWithFallback
                    uuid={active?.uuid}
                    username={active?.username}
                    size={28}
                  />
                  {active?.username}
                </span>
              </>
            ) : (
              'Welcome'
            )}
          </h1>
          <p>
            {loggedIn
              ? 'Browse Modrinth mods, build instances, and launch Minecraft.'
              : 'Sign in with Microsoft to play — offline mode is disabled.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {running.running && (
            <button className="btn btn-danger btn-lg" onClick={() => stopGame()}>
              <IconStop />
              Stop {running.instanceName || 'game'}
            </button>
          )}
          <button className="btn btn-primary btn-lg" onClick={() => setCreateOpen(true)}>
            <IconPlus />
            New instance
          </button>
        </div>
      </div>

      {running.running && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="page-header" style={{ marginBottom: 0, alignItems: 'center' }}>
            <div>
              <div className="badge-row" style={{ marginBottom: 6 }}>
                <span className="badge badge-running">Live</span>
              </div>
              <h2 style={{ fontSize: 16, marginBottom: 2 }}>
                Running: {running.instanceName || 'Minecraft'}
              </h2>
              <p className="hint" style={{ marginBottom: 0 }}>
                PID {running.pid ?? '—'}
                {running.startedAt
                  ? ` · started ${new Date(running.startedAt).toLocaleTimeString()}`
                  : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {running.instanceId && (
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate(`/instances/${running.instanceId}`)}
                >
                  Open instance
                </button>
              )}
              <button className="btn btn-danger" onClick={() => stopGame()}>
                <IconStop />
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 18 }}>Recent instances</h2>
          <button className="btn btn-ghost" onClick={() => navigate('/instances')}>
            View all
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="empty">
            <h3>No instances yet</h3>
            <p>Create a Fabric, Forge, NeoForge, or Vanilla instance to get started.</p>
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <IconPlus />
              Create instance
            </button>
          </div>
        ) : (
          <div className="grid grid-instances">
            {recent.map((inst) => {
              const isLive = running.running && running.instanceId === inst.id
              return (
                <div
                  key={inst.id}
                  className="card card-clickable instance-card"
                  onClick={() => navigate(`/instances/${inst.id}`)}
                >
                  <div className="instance-top">
                    <div
                      className="instance-icon"
                      style={{ background: inst.iconColor || '#1bd96a' }}
                    >
                      {inst.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="instance-title">{inst.name}</div>
                      <div className="instance-sub">
                        {loaderLabel(inst.loader)} · {inst.gameVersion}
                      </div>
                      <div className="badge-row" style={{ marginTop: 8 }}>
                        <span className="badge badge-green">{loaderLabel(inst.loader)}</span>
                        <span className="badge">{inst.mods.length} mods</span>
                        {isLive && <span className="badge badge-running">Running</span>}
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
                        {launchingId === inst.id
                          ? 'Launching…'
                          : loggedIn
                            ? 'Play'
                            : 'Sign in to play'}
                      </button>
                    )}
                    <button
                      className="btn btn-secondary"
                      onClick={() => navigate(`/browse?instance=${inst.id}`)}
                    >
                      Add mods
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <CreateInstanceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => navigate(`/instances/${id}`)}
      />
    </div>
  )
}
