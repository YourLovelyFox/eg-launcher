import { useCallback, useEffect, useState } from 'react'
import type { FeaturedPackConfig } from '../../shared/types'
import { useAppStore } from '../store'

const emptyForm = () => ({
  id: '' as string | undefined,
  slug: '',
  projectId: '',
  title: '',
  menuLabel: '',
  description: '',
  minRam: '8',
  recRam: '4096',
  iconUrl: '',
  enabled: true,
  sortOrder: '0',
})

export function AdminFeaturedPanel({ session }: { session: string }) {
  const { showToast } = useAppStore()
  const [packs, setPacks] = useState<FeaturedPackConfig[]>([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const editing = Boolean(form.id)

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

  function startCreate() {
    setForm(emptyForm())
  }

  function startEdit(p: FeaturedPackConfig) {
    setForm({
      id: p.id,
      slug: p.slug || '',
      projectId: p.projectId || '',
      title: p.title || '',
      menuLabel: p.menuLabel || p.title || '',
      description: p.description || '',
      minRam: String(p.minSystemRamGb ?? 8),
      recRam: String(p.recommendedAllocatedMb ?? 4096),
      iconUrl: p.iconUrl || '',
      enabled: p.enabled !== false,
      sortOrder: String(p.sortOrder ?? 0),
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save() {
    setBusy(true)
    try {
      const res = await window.hive.admin.saveFeaturedPack(session, {
        id: form.id || undefined,
        slug: form.slug.trim(),
        projectId: form.projectId.trim(),
        title: form.title.trim(),
        menuLabel: form.menuLabel.trim() || form.title.trim(),
        description: form.description.trim(),
        minSystemRamGb: Number(form.minRam) || 8,
        recommendedAllocatedMb: Number(form.recRam) || 4096,
        iconUrl: form.iconUrl.trim() || null,
        enabled: form.enabled,
        sortOrder: Number(form.sortOrder) || 0,
      })
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast(
        'success',
        (res as { message?: string }).message ||
          (editing ? 'Featured pack updated' : 'Featured pack saved'),
      )
      setForm(emptyForm())
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
      if (form.id === id) setForm(emptyForm())
      await load()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function setField<K extends keyof ReturnType<typeof emptyForm>>(key: K, value: ReturnType<typeof emptyForm>[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{editing ? 'Edit featured pack' : 'Add featured modpack'}</h2>
          {editing && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={startCreate}>
              Cancel edit / New
            </button>
          )}
        </div>
        <p className="hint">
          Featured packs appear under <strong>Featured</strong> in the sidebar (e.g. Bee&apos;s SMP). Edit any
          existing pack below, or add a new one. Staff submissions go to Approvals first; Admins publish live.
        </p>
        {editing && (
          <p className="hint" style={{ color: 'var(--green)' }}>
            Editing <span className="mono">{form.id}</span> — save to update CMS.
          </p>
        )}
        <div className="form-grid">
          <div className="form-row">
            <label>Modrinth slug *</label>
            <input
              className="input"
              value={form.slug}
              onChange={(e) => setField('slug', e.target.value)}
              placeholder="beessmp"
            />
          </div>
          <div className="form-row">
            <label>Modrinth project id *</label>
            <input
              className="input"
              value={form.projectId}
              onChange={(e) => setField('projectId', e.target.value)}
              placeholder="kPorHsl4"
            />
          </div>
          <div className="form-row">
            <label>Title *</label>
            <input className="input" value={form.title} onChange={(e) => setField('title', e.target.value)} />
          </div>
          <div className="form-row">
            <label>Menu label</label>
            <input
              className="input"
              value={form.menuLabel}
              onChange={(e) => setField('menuLabel', e.target.value)}
              placeholder="Sidebar label"
            />
          </div>
          <div className="form-row">
            <label>Description</label>
            <textarea
              className="input admin-textarea"
              rows={3}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>Icon URL (optional https)</label>
            <input
              className="input"
              value={form.iconUrl}
              onChange={(e) => setField('iconUrl', e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="form-row">
            <label>Min system RAM (GB)</label>
            <input className="input" value={form.minRam} onChange={(e) => setField('minRam', e.target.value)} />
          </div>
          <div className="form-row">
            <label>Recommended allocated RAM (MB)</label>
            <input className="input" value={form.recRam} onChange={(e) => setField('recRam', e.target.value)} />
          </div>
          <div className="form-row">
            <label>Sort order</label>
            <input
              className="input"
              value={form.sortOrder}
              onChange={(e) => setField('sortOrder', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="form-row">
            <label>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setField('enabled', e.target.checked)}
              />{' '}
              Enabled (show in sidebar)
            </label>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          disabled={busy || !form.slug || !form.projectId || !form.title}
          onClick={() => void save()}
        >
          {busy ? '…' : editing ? 'Save changes' : 'Save featured pack (Admin live · Staff → review)'}
        </button>
      </div>
      <div className="panel">
        <h2>Featured packs ({packs.length})</h2>
        <p className="hint">Click <strong>Edit</strong> to change a pack, or Delete to remove it from CMS.</p>
        <div className="list" style={{ marginTop: 10 }}>
          {packs.length === 0 && <p className="hint">No featured packs yet.</p>}
          {packs.map((p) => (
            <div key={p.id} className="list-item">
              <div className="grow">
                <div className="title">
                  {p.title}
                  {p.enabled === false ? (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      disabled
                    </span>
                  ) : null}
                  {form.id === p.id ? (
                    <span className="badge badge-green" style={{ marginLeft: 8 }}>
                      editing
                    </span>
                  ) : null}
                </div>
                <div className="sub mono">
                  {p.slug} · {p.projectId} · min {p.minSystemRamGb} GB · rec {p.recommendedAllocatedMb} MB · sort{' '}
                  {p.sortOrder ?? 0}
                </div>
                {p.description ? <div className="sub" style={{ marginTop: 4 }}>{p.description}</div> : null}
              </div>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => startEdit(p)}>
                Edit
              </button>
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
