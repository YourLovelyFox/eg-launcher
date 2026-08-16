import { useEffect, useState } from 'react'
import type { GameInstance, LoaderType, MinecraftVersionInfo } from '../../shared/types'
import { loaderLabel, useAppStore } from '../store'

type Props = {
  open: boolean
  instance: GameInstance
  busy?: boolean
  installProgress?: { message: string; progress: number } | null
  onClose: () => void
  onApply: (patch: {
    gameVersion: string
    loader: LoaderType
    loaderVersion?: string
  }) => Promise<void>
}

const LOADERS: LoaderType[] = ['vanilla', 'fabric', 'forge', 'neoforge']

export function EditInstanceModal({
  open,
  instance,
  busy,
  installProgress,
  onClose,
  onApply,
}: Props) {
  const showToast = useAppStore((s) => s.showToast)
  const [loader, setLoader] = useState<LoaderType>(instance.loader)
  const [versions, setVersions] = useState<MinecraftVersionInfo[]>([])
  const [gameVersion, setGameVersion] = useState(instance.gameVersion)
  const [loaderVersions, setLoaderVersions] = useState<{ id: string; stable: boolean }[]>([])
  const [loaderVersion, setLoaderVersion] = useState(instance.loaderVersion || '')
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [saving, setSaving] = useState(false)

  const platformChanged =
    loader !== instance.loader ||
    gameVersion !== instance.gameVersion ||
    (loader === 'vanilla' ? Boolean(instance.loaderVersion) : loaderVersion !== (instance.loaderVersion || ''))

  const loaderChanged = loader !== instance.loader
  const versionChanged = gameVersion !== instance.gameVersion

  useEffect(() => {
    if (!open) return
    setLoader(instance.loader)
    setGameVersion(instance.gameVersion)
    setLoaderVersion(instance.loaderVersion || '')
  }, [open, instance.id, instance.loader, instance.gameVersion, instance.loaderVersion])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        setLoadingMeta(true)
        const data = await window.hive.mc.listVersions()
        if (cancelled) return
        const releases = data.versions.filter((v) => v.type === 'release')
        if (instance.gameVersion && !releases.some((v) => v.id === instance.gameVersion)) {
          const current = data.versions.find((v) => v.id === instance.gameVersion)
          if (current) releases.unshift(current)
          else {
            releases.unshift({
              id: instance.gameVersion,
              type: 'release',
              url: '',
              time: '',
              releaseTime: '',
            })
          }
        }
        setVersions(releases)
      } catch (err) {
        showToast('error', (err as Error).message)
      } finally {
        if (!cancelled) setLoadingMeta(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, instance.gameVersion, showToast])

  useEffect(() => {
    if (!open || !gameVersion) return
    if (loader === 'vanilla') {
      setLoaderVersions([])
      setLoaderVersion('')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        setLoadingMeta(true)
        const list = await window.hive.mc.listLoaders(loader, gameVersion)
        if (cancelled) return
        setLoaderVersions(list)
        const keep =
          loader === instance.loader &&
          gameVersion === instance.gameVersion &&
          instance.loaderVersion &&
          list.some((v) => v.id === instance.loaderVersion)
            ? instance.loaderVersion
            : list[0]?.id || ''
        setLoaderVersion(keep)
      } catch (err) {
        if (!cancelled) {
          setLoaderVersions([])
          setLoaderVersion('')
          showToast('error', (err as Error).message)
        }
      } finally {
        if (!cancelled) setLoadingMeta(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, loader, gameVersion, instance.loader, instance.gameVersion, instance.loaderVersion, showToast])

  if (!open) return null

  const locked = Boolean(busy) || saving

  async function handleApply() {
    if (!gameVersion || locked) return
    if (loader !== 'vanilla' && !loaderVersion) {
      showToast('error', `No ${loaderLabel(loader)} builds found for ${gameVersion}`)
      return
    }
    if (!platformChanged) {
      onClose()
      return
    }

    const touchesMods = instance.mods.length > 0 && (loaderChanged || versionChanged)
    if (touchesMods) {
      const ok = window.confirm(
        `Change this instance to ${loaderLabel(loader)} ${gameVersion}?\n\n` +
          `Game files will be reinstalled. Mods that have a matching build will show under Update Mods. ` +
          `Mods with no matching ${loaderLabel(loader)} / ${gameVersion} version will be marked incompatible and disabled.`,
      )
      if (!ok) return
    }

    setSaving(true)
    try {
      await onApply({
        gameVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion,
      })
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!locked) onClose()
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit instance</h2>
        <p className="hint">
          Change Minecraft version or mod loader. Existing worlds stay in this folder. After a
          loader or version change, mods are checked the same way as <strong>Update Mods</strong>.
        </p>

        <div className="form-grid">
          <div className="form-row">
            <label>Loader</label>
            <div className="badge-row" style={{ gap: 8 }}>
              {LOADERS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`btn ${loader === l ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={locked}
                  onClick={() => setLoader(l)}
                >
                  {loaderLabel(l)}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-row">
              <label>Minecraft version</label>
              <select
                className="select"
                value={gameVersion}
                onChange={(e) => setGameVersion(e.target.value)}
                disabled={locked || (loadingMeta && versions.length === 0)}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                  </option>
                ))}
              </select>
            </div>

            {loader !== 'vanilla' && (
              <div className="form-row">
                <label>{loaderLabel(loader)} version</label>
                <select
                  className="select"
                  value={loaderVersion}
                  onChange={(e) => setLoaderVersion(e.target.value)}
                  disabled={locked || loadingMeta || loaderVersions.length === 0}
                >
                  {loaderVersions.length === 0 && <option value="">None found</option>}
                  {loaderVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                      {v.stable ? ' (stable)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {instance.mods.length > 0 && (loaderChanged || versionChanged) && (
          <p className="hint" style={{ color: 'var(--amber)', marginTop: 12, marginBottom: 0 }}>
            {instance.mods.length} installed mod{instance.mods.length === 1 ? '' : 's'} will be
            rechecked for {loaderLabel(loader)} {gameVersion}. Incompatible ones are disabled and
            listed under Update Mods.
          </p>
        )}

        {(busy || installProgress) && (
          <div style={{ marginTop: 14 }}>
            <div className="progress-meta">
              <span>{installProgress?.message || 'Applying…'}</span>
              <span>{Math.round((installProgress?.progress ?? 0) * 100)}%</span>
            </div>
            <div className="progress-bar">
              <div style={{ width: `${Math.round((installProgress?.progress ?? 0) * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={locked}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void handleApply()}
            disabled={
              locked ||
              !gameVersion ||
              !platformChanged ||
              (loader !== 'vanilla' && !loaderVersion)
            }
          >
            {locked ? 'Applying…' : 'Save & reinstall'}
          </button>
        </div>
      </div>
    </div>
  )
}
