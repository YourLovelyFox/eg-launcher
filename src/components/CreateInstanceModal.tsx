import { useEffect, useState } from 'react'
import type { LoaderType, MinecraftVersionInfo } from '../../shared/types'
import { loaderLabel, useAppStore } from '../store'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}

const LOADERS: LoaderType[] = ['vanilla', 'fabric', 'forge', 'neoforge']

export function CreateInstanceModal({ open, onClose, onCreated }: Props) {
  const showToast = useAppStore((s) => s.showToast)
  const refreshAll = useAppStore((s) => s.refreshAll)

  const [name, setName] = useState('')
  const [loader, setLoader] = useState<LoaderType>('fabric')
  const [versions, setVersions] = useState<MinecraftVersionInfo[]>([])
  const [gameVersion, setGameVersion] = useState('')
  const [loaderVersions, setLoaderVersions] = useState<{ id: string; stable: boolean }[]>([])
  const [loaderVersion, setLoaderVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingMeta, setLoadingMeta] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        setLoadingMeta(true)
        const data = await window.hive.mc.listVersions()
        if (cancelled) return
        const releases = data.versions.filter((v) => v.type === 'release')
        setVersions(releases)
        setGameVersion(data.latest.release)
      } catch (err) {
        showToast('error', (err as Error).message)
      } finally {
        if (!cancelled) setLoadingMeta(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, showToast])

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
        setLoaderVersion(list[0]?.id || '')
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
  }, [open, loader, gameVersion, showToast])

  if (!open) return null

  async function handleCreate() {
    if (!gameVersion) return
    if (loader !== 'vanilla' && !loaderVersion) {
      showToast('error', `No ${loaderLabel(loader)} builds found for ${gameVersion}`)
      return
    }

    setBusy(true)
    try {
      const instance = await window.hive.instances.create({
        name: name.trim() || `${loaderLabel(loader)} ${gameVersion}`,
        gameVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion,
      })
      await refreshAll()
      showToast('success', `Created instance “${instance.name}”`)
      onCreated(instance.id)
      onClose()
      setName('')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create instance</h2>
        <p className="hint">
          Install Vanilla, Fabric, Forge, or NeoForge — then add mods from Modrinth.
        </p>

        <div className="form-grid">
          <div className="form-row">
            <label>Name</label>
            <input
              className="input"
              placeholder={`${loaderLabel(loader)} ${gameVersion || ''}`.trim()}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-row">
            <label>Loader</label>
            <div className="badge-row" style={{ gap: 8 }}>
              {LOADERS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`btn ${loader === l ? 'btn-primary' : 'btn-secondary'}`}
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
                disabled={loadingMeta && versions.length === 0}
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
                  disabled={loadingMeta || loaderVersions.length === 0}
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

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={busy || !gameVersion}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
