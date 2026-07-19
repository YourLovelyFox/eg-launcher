import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PARTNERS } from '../../shared/branding'
import horizonsIcon from '../assets/horizons-smp.png'
import { IconDownload, IconPlay, IconStop } from '../components/Icons'
import { loaderLabel, useAppStore } from '../store'

const PARTNER = PARTNERS.horizonsSmp

/** Display list for the partner pack page (primary mods + known required deps). */
const PACK_MOD_LIST: Array<{ name: string; role: 'mod' | 'dependency'; note?: string }> = [
  { name: 'Sodium', role: 'mod', note: 'Performance' },
  { name: "Xaero's Minimap", role: 'mod', note: 'Minimap' },
  { name: "Xaero's World Map", role: 'mod', note: 'World map' },
  { name: 'AppleSkin', role: 'mod', note: 'Food / hunger HUD' },
  { name: '3D Skin Layers', role: 'mod', note: '3D player skins' },
  { name: 'Zoomify', role: 'mod', note: 'Zoom' },
  { name: 'Fabric API', role: 'dependency', note: 'Required by several mods' },
  { name: 'Fabric Language Kotlin', role: 'dependency', note: 'Required by Zoomify' },
  { name: 'YetAnotherConfigLib (YACL)', role: 'dependency', note: 'Required by Zoomify' },
]

type PartnerStatus = {
  partner: {
    id: string
    title: string
    description: string
    gameVersion: string
    loader: string
    serverAddress: string
    serverName: string
    instanceName: string
    defaultMods: readonly string[]
  }
  local: {
    id: string
    installed: boolean
    instanceId: string | null
    installedAt: string | null
  }
  instance: { id: string; name: string; gameVersion: string; loader: string } | null
}

export function HorizonsSmpPage() {
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

  const [status, setStatus] = useState<PartnerStatus | null>(null)
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
      const data = (await window.hive.partners.getStatus(PARTNER.id)) as PartnerStatus
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
    const off = window.hive.partners.onInstallProgress((p) => setDownloadProgress(p))
    return off
  }, [setDownloadProgress])

  async function setup() {
    setBusy('install')
    setDownloadProgress({ stage: 'start', progress: 0, message: 'Setting up Horizons SMP…' })
    try {
      const result = (await window.hive.partners.install(PARTNER.id)) as PartnerStatus
      setStatus(result)
      await refreshAll()
      showToast('success', `${PARTNER.title} is ready · server ${PARTNER.serverAddress}`)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
      setTimeout(() => setDownloadProgress(null), 1500)
    }
  }

  async function play() {
    if (!status?.local.installed) {
      showToast('error', 'Install first')
      return
    }
    if (!loggedIn) {
      showToast('error', 'Sign in with Microsoft to play')
      navigate('/account')
      return
    }
    const instanceId = status.local.instanceId
    if (!instanceId) {
      showToast('error', 'Instance missing — try Set up again')
      return
    }

    setBusy('launch')
    try {
      const result = await window.hive.mc.launch(instanceId)
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
      setBusy(null)
    }
  }

  if (loading && !status) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 240, borderRadius: 20 }} />
      </div>
    )
  }

  const local = status?.local
  const installed = !!local?.installed

  return (
    <div className="page pack-page">
      <div className="featured-hero partner-hero">
        <div className="featured-hero-glow partner-glow" />
        <div className="featured-hero-inner">
          <div className="featured-badge-row">
            <span className="badge badge-blue">Partner</span>
            <span className="badge badge-green">Fabric</span>
            <span className="badge">{PARTNER.gameVersion}</span>
            {installed ? (
              <span className="badge badge-green">Ready</span>
            ) : (
              <span className="badge">Not installed</span>
            )}
          </div>

          <div className="partner-title-row">
            <img
              src={horizonsIcon}
              alt=""
              className="partner-hero-icon"
              width={72}
              height={72}
              draggable={false}
            />
            <div>
              <h1>{PARTNER.title}</h1>
              <p className="featured-desc">{PARTNER.description}</p>
            </div>
          </div>

          <div className="featured-meta grid-meta">
            <div>
              <span className="meta-label">Instance</span>
              <strong>{PARTNER.instanceName}</strong>
            </div>
            <div>
              <span className="meta-label">Minecraft</span>
              <strong>{PARTNER.gameVersion}</strong>
            </div>
            <div>
              <span className="meta-label">Loader</span>
              <strong>{loaderLabel(PARTNER.loader)}</strong>
            </div>
            <div>
              <span className="meta-label">Server</span>
              <strong className="mono">{PARTNER.serverAddress}</strong>
            </div>
            <div>
              <span className="meta-label">Status</span>
              <strong>{installed ? 'Installed' : 'Not installed'}</strong>
            </div>
            <div>
              <span className="meta-label">Mods</span>
              <strong>
                {PACK_MOD_LIST.filter((m) => m.role === 'mod').length} +{' '}
                {PACK_MOD_LIST.filter((m) => m.role === 'dependency').length} deps
              </strong>
            </div>
          </div>

          <div className="featured-actions">
            {!installed ? (
              <button
                className="btn btn-primary btn-lg"
                disabled={busy !== null}
                onClick={setup}
              >
                <IconDownload />
                {busy === 'install' ? 'Installing…' : 'Install'}
              </button>
            ) : (
              <button
                className="btn btn-secondary btn-lg"
                disabled={busy === 'install'}
                onClick={setup}
              >
                <IconDownload />
                {busy === 'install' ? 'Reinstalling…' : 'Reinstall / repair'}
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
                disabled={!installed || busy !== null || running.running || !loggedIn}
                onClick={play}
                title={
                  !installed
                    ? 'Install first'
                    : !loggedIn
                      ? 'Sign in required'
                      : `Play ${PARTNER.title}`
                }
              >
                <IconPlay />
                {!loggedIn && installed ? 'Sign in to play' : 'Play'}
              </button>
            )}

            {local?.instanceId && (
              <button
                className="btn btn-ghost"
                onClick={() => navigate(`/instances/${local.instanceId}`)}
              >
                Open instance
              </button>
            )}
          </div>

          {(busy === 'install' ||
            (downloadProgress &&
              downloadProgress.stage !== 'done' &&
              busy !== null)) && (
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
            </div>
          )}
        </div>
      </div>

      <section className="panel partner-mods-panel">
        <div className="partner-mods-header">
          <div>
            <h2>Mods installed with this pack</h2>
            <p className="hint" style={{ marginBottom: 0 }}>
              Latest Fabric builds for Minecraft {PARTNER.gameVersion}. Required dependencies are
              installed automatically.
            </p>
          </div>
        </div>

        <div className="list partner-mods-list">
          {PACK_MOD_LIST.map((mod) => (
            <div key={mod.name} className="list-item partner-mod-row">
              <div className="grow">
                <div className="title">{mod.name}</div>
                {mod.note && <div className="sub">{mod.note}</div>}
              </div>
              <span
                className={`badge${mod.role === 'dependency' ? '' : ' badge-green'}`}
              >
                {mod.role === 'dependency' ? 'Dependency' : 'Mod'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
