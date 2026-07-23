import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { MinecraftServerStatus } from '../../shared/types'
import horizonsIcon from '../assets/horizons-smp.png'
import { PartnerNews } from '../components/PartnerNews'
import { IconDownload, IconExternal, IconPlay, IconStop } from '../components/Icons'
import { loaderLabel, useAppStore } from '../store'

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
    newsTag: string
    modrinthPackSlug?: string | null
    iconUrl?: string | null
    discordUrl?: string | null
  }
  local: {
    id: string
    installed: boolean
    instanceId: string | null
    installedAt: string | null
  }
  instance: { id: string; name: string; gameVersion: string; loader: string } | null
}

function partnerIconSrc(partner: PartnerStatus['partner']): string | null {
  if (partner.iconUrl) return partner.iconUrl
  if (partner.id === 'horizons-smp') return horizonsIcon
  return null
}

export function PartnerPage() {
  const { id = '' } = useParams<{ id: string }>()
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
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState<'install' | 'launch' | 'join' | null>(null)
  const [serverStatus, setServerStatus] = useState<MinecraftServerStatus | null>(null)
  const [serverChecking, setServerChecking] = useState(false)
  const loggedIn = accounts.some((a) => a.id === activeAccountId)
  const isLive = !!(
    status?.local.instanceId &&
    running.running &&
    running.instanceId === status.local.instanceId
  )

  const refresh = useCallback(async () => {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setLoading(true)
    setNotFound(false)
    try {
      const data = (await window.hive.partners.getStatus(id)) as PartnerStatus
      setStatus(data)
    } catch (err) {
      setStatus(null)
      setNotFound(true)
      showToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id, showToast])

  const pingServer = useCallback(
    async (address?: string) => {
      const addr = (address || status?.partner.serverAddress || '').trim()
      if (!addr) {
        setServerStatus(null)
        return
      }
      setServerChecking(true)
      try {
        const result = await window.hive.server.status(addr)
        setServerStatus(result)
      } catch (err) {
        setServerStatus({
          online: false,
          address: addr,
          host: addr,
          port: 25565,
          error: (err as Error).message,
        })
      } finally {
        setServerChecking(false)
      }
    },
    [status?.partner.serverAddress],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!status?.partner.serverAddress) return
    void pingServer(status.partner.serverAddress)
    const t = window.setInterval(() => {
      void pingServer(status.partner.serverAddress)
    }, 60_000)
    return () => window.clearInterval(t)
  }, [status?.partner.serverAddress, pingServer])

  useEffect(() => {
    const off = window.hive.partners.onInstallProgress((p) => setDownloadProgress(p))
    return off
  }, [setDownloadProgress])

  async function setup() {
    if (!status) return
    setBusy('install')
    setDownloadProgress({
      stage: 'start',
      progress: 0,
      message: `Setting up ${status.partner.title}…`,
    })
    try {
      const result = (await window.hive.partners.install(status.partner.id)) as PartnerStatus
      setStatus(result)
      await refreshAll()
      showToast(
        'success',
        `${status.partner.title} is ready · server ${status.partner.serverAddress}`,
      )
      void pingServer(status.partner.serverAddress)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
      setTimeout(() => setDownloadProgress(null), 1500)
    }
  }

  async function play(acknowledgeLowMemory = false) {
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
      const result = await window.hive.mc.launch(instanceId, { acknowledgeLowMemory })
      await refreshRunning()
      if (result.success) {
        showToast('success', result.message)
        await refreshAll()
      } else if (result.requiresConfirmation) {
        if (window.confirm(result.message)) {
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

  async function joinServer(acknowledgeLowMemory = false) {
    if (!status?.local.installed) {
      showToast('error', 'Install first')
      return
    }
    if (!loggedIn) {
      showToast('error', 'Sign in with Microsoft to play')
      navigate('/account')
      return
    }

    setBusy('join')
    try {
      const join = await window.hive.partners.prepareJoin(status.partner.id)
      const result = await window.hive.mc.launch(join.instanceId, {
        acknowledgeLowMemory,
        quickPlayServer: join.serverAddress,
      })
      await refreshRunning()
      if (result.success) {
        showToast('success', `Joining ${join.serverName} (${join.serverAddress})…`)
        await refreshAll()
      } else if (result.requiresConfirmation) {
        if (window.confirm(result.message)) {
          await joinServer(true)
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

  async function openDiscord() {
    const url = status?.partner.discordUrl?.trim()
    if (!url) return
    try {
      await window.hive.shell.openExternal(url)
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  if (loading && !status) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 240, borderRadius: 20 }} />
      </div>
    )
  }

  if (notFound || !status) {
    return (
      <div className="page">
        <div className="empty" style={{ padding: 40 }}>
          <h2>Partner not found</h2>
          <p>This partner is missing from the CMS list.</p>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>
            Go home
          </button>
        </div>
      </div>
    )
  }

  const partner = status.partner
  const local = status.local
  const installed = !!local?.installed
  const mods = partner.defaultMods || []
  const iconSrc = partnerIconSrc(partner)
  const loaderBadge =
    partner.loader === 'fabric'
      ? 'Fabric'
      : partner.loader === 'forge'
        ? 'Forge'
        : partner.loader === 'neoforge'
          ? 'NeoForge'
          : 'Vanilla'

  const serverOnline = serverStatus?.online === true
  const serverLabel = serverChecking
    ? 'Checking…'
    : serverOnline
      ? `Online${
          serverStatus?.playersOnline != null && serverStatus?.playersMax != null
            ? ` · ${serverStatus.playersOnline}/${serverStatus.playersMax}`
            : ''
        }`
      : serverStatus
        ? 'Offline'
        : 'Unknown'

  return (
    <div className="page pack-page">
      <div className="featured-hero partner-hero">
        <div className="featured-hero-glow partner-glow" />
        <div className="featured-hero-inner">
          <div className="featured-badge-row">
            <span className="badge badge-blue">Partner</span>
            <span className="badge badge-green">{loaderBadge}</span>
            <span className="badge">{partner.gameVersion}</span>
            {installed ? (
              <span className="badge badge-green">Ready</span>
            ) : (
              <span className="badge">Not installed</span>
            )}
            <span
              className={`badge ${serverOnline ? 'badge-green' : serverChecking ? '' : 'badge-orange'}`}
              title={serverStatus?.motd || serverStatus?.error || partner.serverAddress}
            >
              Server · {serverLabel}
            </span>
          </div>

          <div className="partner-title-row">
            {iconSrc ? (
              <img
                src={iconSrc}
                alt=""
                className="partner-hero-icon"
                width={72}
                height={72}
                draggable={false}
              />
            ) : (
              <div
                className="partner-hero-icon"
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 16,
                  background: 'var(--bg-3)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 28,
                  fontWeight: 800,
                }}
              >
                {partner.title.slice(0, 1)}
              </div>
            )}
            <div>
              <h1>{partner.title}</h1>
              <p className="featured-desc">{partner.description}</p>
            </div>
          </div>

          <div className="featured-meta grid-meta">
            <div>
              <span className="meta-label">Instance</span>
              <strong>{partner.instanceName}</strong>
            </div>
            <div>
              <span className="meta-label">Minecraft</span>
              <strong>{partner.gameVersion}</strong>
            </div>
            <div>
              <span className="meta-label">Loader</span>
              <strong>{loaderLabel(partner.loader)}</strong>
            </div>
            <div>
              <span className="meta-label">Server</span>
              <strong className="mono">{partner.serverAddress}</strong>
            </div>
            <div>
              <span className="meta-label">Live status</span>
              <strong>
                {serverLabel}
                {serverOnline && serverStatus?.latencyMs != null
                  ? ` · ${serverStatus.latencyMs} ms`
                  : ''}
              </strong>
            </div>
            <div>
              <span className="meta-label">Mods</span>
              <strong>
                {mods.length}
                {partner.modrinthPackSlug ? ` + pack ${partner.modrinthPackSlug}` : ''}
              </strong>
            </div>
          </div>

          {serverOnline && serverStatus?.motd ? (
            <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
              MOTD: {serverStatus.motd}
            </p>
          ) : null}

          <div className="featured-actions">
            {!installed ? (
              <button
                className="btn btn-primary btn-lg"
                disabled={busy !== null}
                onClick={() => void setup()}
              >
                <IconDownload />
                {busy === 'install' ? 'Installing…' : 'Install'}
              </button>
            ) : (
              <button
                className="btn btn-secondary btn-lg"
                disabled={busy === 'install'}
                onClick={() => void setup()}
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
              <>
                <button
                  className="btn btn-primary btn-lg"
                  disabled={!installed || busy !== null || running.running || !loggedIn}
                  onClick={() => void joinServer()}
                  title={
                    !installed
                      ? 'Install first'
                      : !loggedIn
                        ? 'Sign in required'
                        : `Join ${partner.serverAddress}`
                  }
                >
                  <IconPlay />
                  {busy === 'join'
                    ? 'Joining…'
                    : !loggedIn && installed
                      ? 'Sign in to join'
                      : 'Join server'}
                </button>
                <button
                  className="btn btn-secondary btn-lg"
                  disabled={!installed || busy !== null || running.running || !loggedIn}
                  onClick={() => void play()}
                  title="Launch without auto-connecting"
                >
                  <IconPlay />
                  {busy === 'launch' ? 'Launching…' : 'Play'}
                </button>
              </>
            )}

            <button
              className="btn btn-ghost"
              disabled={serverChecking}
              onClick={() => void pingServer()}
              title="Refresh server status"
            >
              {serverChecking ? 'Pinging…' : 'Refresh status'}
            </button>

            {partner.discordUrl ? (
              <button className="btn btn-secondary" onClick={() => void openDiscord()}>
                <IconExternal />
                Discord
              </button>
            ) : null}

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
              Latest {loaderLabel(partner.loader)} builds for Minecraft {partner.gameVersion}.
              Required dependencies install automatically.
              {partner.modrinthPackSlug
                ? ` Modrinth pack: ${partner.modrinthPackSlug}.`
                : ''}
            </p>
          </div>
        </div>

        {mods.length === 0 && !partner.modrinthPackSlug ? (
          <div className="empty" style={{ padding: 20 }}>
            <p>No auto-install mods configured for this partner.</p>
          </div>
        ) : (
          <div className="list partner-mods-list">
            {partner.modrinthPackSlug && (
              <div className="list-item partner-mod-row">
                <div className="grow">
                  <div className="title">{partner.modrinthPackSlug}</div>
                  <div className="sub">Modrinth modpack</div>
                </div>
                <span className="badge badge-blue">Pack</span>
              </div>
            )}
            {mods.map((slug) => (
              <div key={slug} className="list-item partner-mod-row">
                <div className="grow">
                  <div className="title">{slug}</div>
                  <div className="sub">Modrinth project</div>
                </div>
                <span className="badge badge-green">Mod</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <PartnerNews newsTag={partner.newsTag} partnerTitle={partner.title} />
    </div>
  )
}
