import { useCallback, useEffect, useState } from 'react'
import type { FeaturedPackConfig } from '../../shared/types'
import { useAppStore } from '../store'

export function AdminFeaturedPanel({ session }: { session: string }) {
  const { showToast } = useAppStore()
  const [packs, setPacks] = useState<FeaturedPackConfig[]>([])
  const [busy, setBusy] = useState(false)
  const [slug, setSlug] = useState('')
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [menuLabel, setMenuLabel] = useState('')
  const [description, setDescription] = useState('')
  const [minRam, setMinRam] = useState('8')
  const [recRam, setRecRam] = useState('4096')

  const load = useCallback(async () => {
    try {
      const list = (await window.hive.admin.listFeaturedPacks(true)) as FeaturedPackConfig[]
      setPacks(Array.isArray(list) ? list : [])
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }, [showToast])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy(true)
    try {
      const res = await window.hive.admin.saveFeaturedPack(session, {
        slug: slug.trim(),
        projectId: projectId.trim(),
        title: title.trim(),
        menuLabel: menuLabel.trim() || title.trim(),
        description: description.trim(),
        minSystemRamGb: Number(minRam) || 8,
        recommendedAllocatedMb: Number(recRam) || 4096,
        enabled: true,
      })
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', (res as { message?: string }).message || 'Featured pack saved')
      setSlug('')
      setProjectId('')
      setTitle('')
      setMenuLabel('')
      setDescription('')
      await load()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this featured pack?')) return
    setBusy(true)
    try {
      const res = await window.hive.admin.deleteFeaturedPack(session, id)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', 'Deleted')
      await load()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Add featured modpack</h2>
        <p className="hint">
          Appears under Featured in the sidebar. Staff submissions go to Approvals first.
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>Modrinth slug *</label>
            <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="beessmp" />
          </div>
          <div className="form-row">
            <label>Modrinth project id *</label>
            <input
              className="input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="kPorHsl4"
            />
          </div>
          <div className="form-row">
            <label>Title *</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Menu label</label>
            <input className="input" value={menuLabel} onChange={(e) => setMenuLabel(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Description</label>
            <textarea className="input admin-textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Min system RAM (GB)</label>
            <input className="input" value={minRam} onChange={(e) => setMinRam(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Recommended allocated RAM (MB)</label>
            <input className="input" value={recRam} onChange={(e) => setRecRam(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          disabled={busy || !slug || !projectId || !title}
          onClick={() => void save()}
        >
          {busy ? '…' : 'Save featured pack (Admin live · Staff → review)'}
        </button>
      </div>
      <div className="panel">
        <h2>Featured packs ({packs.length})</h2>
        <div className="list" style={{ marginTop: 10 }}>
          {packs.map((p) => (
            <div key={p.id} className="list-item">
              <div className="grow">
                <div className="title">{p.title}</div>
                <div className="sub mono">
                  {p.slug} · {p.projectId} · min {p.minSystemRamGb} GB
                </div>
              </div>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove(p.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
