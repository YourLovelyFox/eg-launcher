import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreateInstanceModal } from '../components/CreateInstanceModal'

import { HomeNews } from '../components/HomeNews'
import { IconPlay, IconPlus, IconStop } from '../components/Icons'
import { PlayerHeadWithFallback } from '../components/PlayerHead'
import { loadQolPrefs, pushRecent, type RecentActivityItem } from '../qolPrefs'
import { loaderLabel, useAppStore } from '../store'

export function HomePage() {
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
  const [recent, setRecent] = useState<RecentActivityItem[]>(() => loadQolPrefs().recent)
  const active = accounts.find((a) => a.id === activeAccountId)
  const pinnedIds = loadQolPrefs().pinnedInstanceIds
  const lastId = loadQolPrefs().lastInstanceId
  const sorted = [...instances].sort((a, b) => {
    const ap = pinnedIds.includes(a.id) ? 0 : 1
    const bp = pinnedIds.includes(b.id) ? 0 : 1
    if (ap !== bp) return ap - bp
    if (a.id === lastId) return -1
    if (b.id === lastId) return 1
    return 0
  })
  const recentInstances = sorted.slice(0, 6)

  const loggedIn = Boolean(active)

  useEffect(() => {
    setRecent(loadQolPrefs().recent)
  }, [instances, running.running])

  async function launch(id: string, acknowledgeLowMemory = false) {
    if (!loggedIn) {
      showToast('error', 'Sign in to play (Microsoft or offline account)')
      navigate('/account')
      return
    }
    setLaunchingId(id)
    setSelectedInstanceId(id)
    try {
      const result = await window.hive.mc.launch(id, { acknowledgeLowMemory })
      await refreshRunning()
      if (result.success) {
        const name = instances.find((i) => i.id === id)?.name || 'instance'
        pushRecent({ kind: 'played', label: `Played ${name}`, href: `/instances/${id}` })
        setRecent(loadQolPrefs().recent)
        showToast('success', result.message)
        await refreshAll()
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
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setLaunchingId(null)
    }
  }

  function playLabel(id: string): string {
    if (running.running && running.instanceId === id) return 'Running'
    if (launchingId === id) return 'Launching…'
    return 'Play'
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
              : 'Sign in with Microsoft or an Admin-created offline account to play.'}
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
                {running.instanceName || 'Minecraft'}
              </h2>
              <p className="hint" style={{ marginBottom: 0 }}>
                Game is running
                {running.pid ? ` · PID ${running.pid}` : ''}
              </p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => running.instanceId && navigate(`/instances/${running.instanceId}`)}
            >
              Open instance
            </button>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <section className="panel" style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 16 }}>Recent activity</h2>
          <div className="list" style={{ marginTop: 10 }}>
            {recent.slice(0, 8).map((r) => (
              <button
                key={r.id}
                type="button"
                className="list-item"
                style={{ width: '100%', textAlign: 'left', cursor: r.href ? 'pointer' : 'default' }}
                onClick={() => r.href && navigate(r.href)}
              >
                <div className="grow">
                  <div className="title">{r.label}</div>
                  <div className="sub">{new Date(r.at).toLocaleString()}</div>
                </div>
                <span className="badge">{r.kind.replace('_', ' ')}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="home-grid">
        <section className="panel">
          <div className="page-header" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 16 }}>Recent instances</h2>
              <p className="hint" style={{ marginBottom: 0 }}>
                Pinned and last-used first. Double-click an instance on the Instances page to play.
              </p>
            </div>
            <button className="btn btn-ghost" onClick={() => navigate('/instances')}>
              View all
            </button>
          </div>
          {recentInstances.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>
              <h3>No instances yet</h3>
              <p>Create one to install mods and play.</p>
              <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                Create instance
              </button>
            </div>
          ) : (
            <div className="list">
              {recentInstances.map((inst) => {
                const isLive = running.running && running.instanceId === inst.id
                const isLaunching = launchingId === inst.id
                const pinned = pinnedIds.includes(inst.id)
                return (
                  <div key={inst.id} className="list-item">
                    <div
                      className="instance-swatch"
                      style={{ background: inst.iconColor || 'var(--bg-3)' }}
                    />
                    <div className="grow">
                      <div className="title">
                        {pinned ? '★ ' : ''}
                        {inst.name}
                        {inst.id === lastId ? (
                          <span className="badge" style={{ marginLeft: 8 }}>
                            Last
                          </span>
                        ) : null}
                      </div>
                      <div className="sub">
                        {loaderLabel(inst.loader)} · {inst.gameVersion} · {inst.mods.length} mods
                      </div>
                    </div>
                    {isLive ? (
                      <button className="btn btn-danger" onClick={() => stopGame()} disabled={false}>
                        <IconStop />
                        Stop
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        disabled={isLaunching || (running.running && !isLive)}
                        onClick={() => void launch(inst.id)}
                      >
                        <IconPlay />
                        {playLabel(inst.id)}
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setSelectedInstanceId(inst.id)
                        navigate(`/instances/${encodeURIComponent(inst.id)}`)
                      }}
                    >
                      Open
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <HomeNews />
      </div>

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
