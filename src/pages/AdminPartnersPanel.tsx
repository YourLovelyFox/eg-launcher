import { useCallback, useEffect, useState } from 'react'
import type { LoaderType, PartnerConfig, PartnerEvent } from '../../shared/types'
import { useAppStore } from '../store'

type FormState = {
  id?: string
  title: string
  menuLabel: string
  description: string
  gameVersion: string
  loader: LoaderType
  serverAddress: string
  serverName: string
  instanceName: string
  newsTag: string
  newsUsername: string
  newsPassword: string
  usePackProject: boolean
  packSlug: string
  defaultModsText: string
  iconUrl: string
  discordUrl: string
}

const emptyForm = (): FormState => ({
  title: '',
  menuLabel: '',
  description: '',
  gameVersion: '1.21.11',
  loader: 'fabric',
  serverAddress: '',
  serverName: '',
  instanceName: '',
  newsTag: '',
  newsUsername: '',
  newsPassword: '',
  usePackProject: false,
  packSlug: '',
  defaultModsText: '',
  iconUrl: '',
  discordUrl: '',
})

function fromConfig(p: PartnerConfig): FormState {
  return {
    id: p.id,
    title: p.title,
    menuLabel: p.menuLabel,
    description: p.description,
    gameVersion: p.gameVersion,
    loader: p.loader,
    serverAddress: p.serverAddress,
    serverName: p.serverName,
    instanceName: p.instanceName,
    newsTag: p.newsTag,
    newsUsername: p.newsUsername,
    newsPassword: '',
    usePackProject: Boolean(p.packSlug),
    packSlug: p.packSlug || '',
    defaultModsText: (p.defaultMods || []).join(', '),
    iconUrl: p.iconUrl || '',
    discordUrl: p.discordUrl || '',
  }
}

type Props = { session: string }

export function AdminPartnersPanel({ session }: Props) {
  const { showToast } = useAppStore()
  const [partners, setPartners] = useState<PartnerConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  const [events, setEvents] = useState<PartnerEvent[]>([])
  const [eventTitle, setEventTitle] = useState('')
  const [eventStarts, setEventStarts] = useState('')
  const [eventDesc, setEventDesc] = useState('')
  const [eventLoc, setEventLoc] = useState('')
  const [eventBusy, setEventBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.hive.admin.listPartners(session)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      setPartners(res.partners)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [session, showToast])

  useEffect(() => {
    void load()
  }, [load])

  function startCreate() {
    setForm(emptyForm())
    setMode('edit')
  }

  function startEdit(p: PartnerConfig) {
    setForm(fromConfig(p))
    setMode('edit')
    void loadEvents(p.id)
  }

  async function loadEvents(partnerId: string) {
    try {
      const res = await window.hive.admin.listPartnerEvents(session, partnerId)
      if (res.ok) setEvents(res.events)
      else setEvents([])
    } catch {
      setEvents([])
    }
  }

  async function saveEvent() {
    if (!form.id) {
      showToast('error', 'Save the partner once before adding events')
      return
    }
    if (!eventTitle.trim() || !eventStarts) {
      showToast('error', 'Event title and start time required')
      return
    }
    setEventBusy(true)
    try {
      const payload = {
        partnerId: form.id,
        title: eventTitle.trim(),
        description: eventDesc.trim(),
        startsAt: new Date(eventStarts).toISOString(),
        location: eventLoc.trim() || null,
      }
      const me = await window.hive.admin.staffMe()
      if (me?.mustQueue) {
        const sub = await window.hive.admin.submitApproval(session, {
          type: 'partner_event',
          summary: `Partner event “${payload.title}” for ${form.id}`,
          payload,
        })
        if (!sub.ok) {
          showToast('error', sub.error)
          return
        }
        showToast('success', sub.message || 'Event submitted for admin verification')
        setEventTitle('')
        setEventStarts('')
        setEventDesc('')
        setEventLoc('')
        return
      }
      const res = await window.hive.admin.upsertPartnerEvent(session, payload)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', res.message || 'Event saved')
      setEventTitle('')
      setEventStarts('')
      setEventDesc('')
      setEventLoc('')
      await loadEvents(form.id)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setEventBusy(false)
    }
  }

  async function deleteEvent(id: string) {
    if (!form.id) return
    setEventBusy(true)
    try {
      const res = await window.hive.admin.deletePartnerEvent(session, id)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', 'Event deleted')
      await loadEvents(form.id)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setEventBusy(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const mods = form.defaultModsText
        .split(/[,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const payload = {
        id: form.id,
        title: form.title,
        menuLabel: form.menuLabel || form.title,
        description: form.description,
        gameVersion: form.gameVersion,
        loader: form.loader,
        serverAddress: form.serverAddress,
        serverName: form.serverName || form.title,
        instanceName: form.instanceName || form.title,
        newsTag: form.newsTag || form.title.replace(/[^a-zA-Z0-9]+/g, ''),
        newsUsername: form.newsUsername,
        newsPassword: form.newsPassword || undefined,
        defaultMods: form.usePackProject ? mods : mods,
        packSlug: form.usePackProject ? form.packSlug.trim() || null : null,
        iconUrl: form.iconUrl.trim() || null,
        discordUrl: form.discordUrl.trim() || null,
        enabled: true,
      }
      const me = await window.hive.admin.staffMe()
      if (me?.mustQueue) {
        const sub = await window.hive.admin.submitApproval(session, {
          type: 'partner_upsert',
          summary: `Partner ${payload.title}`,
          payload,
        })
        if (!sub.ok) {
          showToast('error', sub.error)
          return
        }
        showToast('success', sub.message || 'Partner change submitted for admin verification')
        setForm((f) => ({ ...f, newsPassword: '' }))
        return
      }
      const res = await window.hive.admin.upsertPartner(session, payload)
      if (!res.ok) {
        showToast('error', res.error || 'Save failed')
        return
      }
      showToast('success', form.id ? 'Partner updated' : 'Partner created — it appears under Partners')
      // Stay on the edit form so Save does not kick back to the list.
      // After create, keep the new id so further saves update the same partner.
      if (res.partner) {
        setForm(fromConfig(res.partner))
      } else if (!form.id) {
        const inferredId = form.title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
        setForm((f) => ({ ...f, id: inferredId, newsPassword: '' }))
      } else {
        setForm((f) => ({ ...f, newsPassword: '' }))
      }
      await load()
    } catch (err) {
      const msg = (err as Error).message || String(err)
      showToast(
        'error',
        msg.includes('No handler')
          ? 'Admin IPC missing — restart the Dev launcher'
          : msg,
      )
    } finally {
      setSaving(false)
    }
  }

  async function remove(p: PartnerConfig) {
    if (!window.confirm(`Delete partner "${p.title}" from CMS and auth? This cannot be undone.`)) {
      return
    }
    setSaving(true)
    try {
      // Refresh session before destructive write (avoids stale idle clock)
      try {
        await window.hive.admin.touchSession(session)
      } catch {
        /* continue — delete will re-check auth */
      }
      const me = await window.hive.admin.staffMe()
      if (!me?.staff) {
        showToast('error', 'Session timed out. Sign in again under Settings → Staff.')
        return
      }
      if (me.mustQueue) {
        // Non-admin staff: partner stays until an Admin approves — do not claim deleted
        const sub = await window.hive.admin.submitApproval(session, {
          type: 'partner_delete',
          summary: `Delete partner ${p.title}`,
          payload: { id: p.id },
        })
        if (!sub.ok) {
          showToast('error', sub.error)
          return
        }
        showToast(
          'info',
          sub.message ||
            'Delete queued for Admin approval — partner stays until an Admin reviews Approvals.',
        )
        return
      }
      const res = await window.hive.admin.deletePartner(session, p.id)
      if (!res.ok) {
        showToast('error', res.error || 'Delete failed')
        return
      }
      // Optimistic remove so Horizons / EG Forge / any partner cannot “stick” in the list
      setPartners((prev) => prev.filter((x) => x.id !== p.id))
      if (mode === 'edit' && form.id === p.id) {
        setMode('list')
        setForm(emptyForm())
      }
      showToast('success', `Deleted “${p.title}”`)
      await load()
    } catch (err) {
      showToast('error', (err as Error).message || 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  async function uploadIconFile(file: File) {
    setUploadingIcon(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result || '')
          const comma = result.indexOf(',')
          resolve(comma >= 0 ? result.slice(comma + 1) : result)
        }
        reader.onerror = () => reject(new Error('Could not read image file'))
        reader.readAsDataURL(file)
      })
      const res = await window.hive.admin.uploadImage(session, {
        name: file.name,
        mime: file.type || undefined,
        base64,
      })
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      setForm((f) => ({ ...f, iconUrl: res.url }))
      showToast('success', 'Icon uploaded — save the partner to keep it')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setUploadingIcon(false)
    }
  }

  async function pickIconFile() {
    setUploadingIcon(true)
    try {
      const res = await window.hive.admin.uploadImage(session)
      if (!res.ok) {
        if (res.error !== 'No file selected') showToast('error', res.error)
        return
      }
      setForm((f) => ({ ...f, iconUrl: res.url }))
      showToast('success', 'Icon uploaded — save the partner to keep it')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setUploadingIcon(false)
    }
  }

  async function lookupPackProject() {
    const slug = form.packSlug.trim()
    if (!slug) {
      showToast('error', 'Enter a mod project slug or id')
      return
    }
    try {
      const project = await window.hive.mods.project(slug)
      if (project.project_type === 'modpack') {
        setForm((f) => ({
          ...f,
          usePackProject: true,
          packSlug: project.slug || slug,
          description: f.description || project.description || '',
        }))
        showToast('success', `Modpack: ${project.title}`)
      } else {
        setForm((f) => ({
          ...f,
          usePackProject: false,
          packSlug: '',
          defaultModsText: [project.slug || slug, ...f.defaultModsText.split(',').map((s) => s.trim()).filter(Boolean)]
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(', '),
        }))
        showToast('success', `Mod added to auto-install list: ${project.title}`)
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  if (mode === 'edit') {
    const isCreate = !form.id
    return (
      <div className="panel">
        <div className="page-header" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>{isCreate ? 'Create partner' : `Edit ${form.title}`}</h2>
          <button type="button" className="btn btn-ghost" onClick={() => setMode('list')}>
            Back to list
          </button>
        </div>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="form-row">
            <label>Partner name *</label>
            <input
              className="input"
              type="text"
              value={form.title}
              onChange={(e) => {
                const title = e.target.value
                setForm((f) => ({
                  ...f,
                  title,
                  menuLabel: f.menuLabel || title,
                  serverName: f.serverName || title,
                  instanceName: f.instanceName || title,
                  newsTag: f.newsTag || title.replace(/[^a-zA-Z0-9]+/g, ''),
                  newsUsername: f.newsUsername || title.replace(/[^a-zA-Z0-9]+/g, ''),
                }))
              }}
              required
            />
          </div>
          <div className="form-row">
            <label>Menu label</label>
            <input
              className="input"
              type="text"
              value={form.menuLabel}
              onChange={(e) => setForm((f) => ({ ...f, menuLabel: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Description</label>
            <textarea
              className="input admin-textarea"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>News username * (partner login)</label>
            <input
              className="input"
              type="text"
              value={form.newsUsername}
              onChange={(e) => setForm((f) => ({ ...f, newsUsername: e.target.value }))}
              required
            />
          </div>
          <div className="form-row">
            <label>
              News password {isCreate ? '*' : '(leave empty to keep current)'}
            </label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={form.newsPassword}
              onChange={(e) => setForm((f) => ({ ...f, newsPassword: e.target.value }))}
              required={isCreate}
            />
          </div>
          <div className="form-row">
            <label>News tag (e.g. HorizonsSMP)</label>
            <input
              className="input"
              type="text"
              value={form.newsTag}
              onChange={(e) => setForm((f) => ({ ...f, newsTag: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Server address / IP *</label>
            <input
              className="input"
              type="text"
              placeholder="play.example.com"
              value={form.serverAddress}
              onChange={(e) => setForm((f) => ({ ...f, serverAddress: e.target.value }))}
              required
            />
          </div>
          <div className="form-row">
            <label>Server name in multiplayer list</label>
            <input
              className="input"
              type="text"
              value={form.serverName}
              onChange={(e) => setForm((f) => ({ ...f, serverName: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Discord invite URL (optional)</label>
            <input
              className="input"
              type="url"
              placeholder="https://discord.gg/…"
              value={form.discordUrl}
              onChange={(e) => setForm((f) => ({ ...f, discordUrl: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Instance name</label>
            <input
              className="input"
              type="text"
              value={form.instanceName}
              onChange={(e) => setForm((f) => ({ ...f, instanceName: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <label>Minecraft version *</label>
            <input
              className="input"
              type="text"
              value={form.gameVersion}
              onChange={(e) => setForm((f) => ({ ...f, gameVersion: e.target.value }))}
              required
            />
          </div>
          <div className="form-row">
            <label>Loader *</label>
            <select
              className="input"
              value={form.loader}
              onChange={(e) => setForm((f) => ({ ...f, loader: e.target.value as LoaderType }))}
            >
              <option value="vanilla">Vanilla</option>
              <option value="fabric">Fabric</option>
              <option value="forge">Forge</option>
              <option value="neoforge">NeoForge</option>
            </select>
          </div>

          {form.loader !== 'vanilla' && (
            <>
              <div className="form-row">
                <label className="checkbox-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={form.usePackProject}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, usePackProject: e.target.checked }))
                    }
                  />
                  Use a mod project (pack or mod)
                </label>
              </div>
              {form.usePackProject && (
                <div className="form-row">
                  <label>mod project slug / id</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input"
                      type="text"
                      style={{ flex: 1 }}
                      value={form.packSlug}
                      onChange={(e) => setForm((f) => ({ ...f, packSlug: e.target.value }))}
                      placeholder="e.g. sodium or a modpack slug"
                    />
                    <button type="button" className="btn btn-secondary" onClick={() => void lookupPackProject()}>
                      Look up
                    </button>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Modpacks install as .mrpack; single mods are added to the auto-install list.
                  </span>
                </div>
              )}
              <div className="form-row">
                <label>Auto-install mods (comma-separated Project slugs)</label>
                <textarea
                  className="input admin-textarea"
                  rows={3}
                  value={form.defaultModsText}
                  onChange={(e) => setForm((f) => ({ ...f, defaultModsText: e.target.value }))}
                  placeholder="sodium, xaeros-minimap, fabric-api"
                />
              </div>
            </>
          )}

          <div className="form-row">
            <label>Partner icon (optional)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={uploadingIcon || saving}
                  onClick={() => void pickIconFile()}
                >
                  {uploadingIcon ? 'Uploading…' : 'Upload image…'}
                </button>
                <label className="btn btn-ghost" style={{ cursor: 'pointer', margin: 0 }}>
                  Choose file
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                    style={{ display: 'none' }}
                    disabled={uploadingIcon || saving}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void uploadIconFile(file)
                    }}
                  />
                </label>
                {form.iconUrl ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setForm((f) => ({ ...f, iconUrl: '' }))}
                  >
                    Clear icon
                  </button>
                ) : null}
              </div>
              <input
                className="input"
                type="url"
                placeholder="Or paste an image URL (https://…/icon.png)"
                value={form.iconUrl}
                onChange={(e) => setForm((f) => ({ ...f, iconUrl: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                PNG / JPEG / WebP / GIF · max 2 MB · stored on the CMS and used in the sidebar
              </span>
              {form.iconUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img
                    src={form.iconUrl}
                    alt="Partner icon preview"
                    width={48}
                    height={48}
                    style={{ borderRadius: 10, objectFit: 'cover', background: 'var(--bg-3)' }}
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.opacity = '0.3'
                    }}
                  />
                  <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    {form.iconUrl}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isCreate ? 'Create partner' : 'Save partner'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('list')}>
              Cancel
            </button>
          </div>
        </form>

        {!isCreate && form.id && (
          <div style={{ marginTop: 28, borderTop: '1px solid var(--border-soft)', paddingTop: 18 }}>
            <h3 style={{ fontSize: 15, marginBottom: 8 }}>Events calendar</h3>
            <p className="hint">Shown on the partner page. Stored in CMS MariaDB.</p>
            <div className="form-grid">
              <div className="form-row">
                <label>Title *</label>
                <input
                  className="input"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="Community build day"
                />
              </div>
              <div className="form-row">
                <label>Starts *</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={eventStarts}
                  onChange={(e) => setEventStarts(e.target.value)}
                />
              </div>
              <div className="form-row">
                <label>Location</label>
                <input
                  className="input"
                  value={eventLoc}
                  onChange={(e) => setEventLoc(e.target.value)}
                  placeholder="Spawn / Discord / coords"
                />
              </div>
              <div className="form-row">
                <label>Description</label>
                <textarea
                  className="input admin-textarea"
                  rows={2}
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 10 }}
              disabled={eventBusy}
              onClick={() => void saveEvent()}
            >
              {eventBusy ? '…' : 'Add event'}
            </button>
            {events.length > 0 && (
              <div className="list" style={{ marginTop: 14 }}>
                {events.map((ev) => (
                  <div key={ev.id} className="list-item">
                    <div className="grow">
                      <div className="title">{ev.title}</div>
                      <div className="sub">
                        {new Date(ev.startsAt).toLocaleString()}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </div>
                      {ev.description ? <div className="sub">{ev.description}</div> : null}
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={eventBusy}
                      onClick={() => void deleteEvent(ev.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>Partners</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            Create partners for the sidebar. Stored in private CMS + public mirror.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={startCreate}>
          Create partner
        </button>
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 120, borderRadius: 14 }} />
      ) : partners.length === 0 ? (
        <div className="empty" style={{ padding: 28 }}>
          <h3>No partners yet</h3>
          <p>Create one to add it under the Partners tab.</p>
        </div>
      ) : (
        <div className="admin-news-list">
          {partners.map((p) => (
            <div
              key={p.id}
              className="admin-news-list-item"
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {p.iconUrl ? (
                  <img src={p.iconUrl} alt="" width={28} height={28} style={{ borderRadius: 8 }} />
                ) : (
                  <div
                    className="nav-partner-icon"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'var(--bg-3)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {p.title.slice(0, 1)}
                  </div>
                )}
                <div>
                  <strong>{p.title}</strong>
                  <span style={{ display: 'block' }}>
                    {p.loader} {p.gameVersion} · {p.serverAddress} · tag {p.newsTag}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn-secondary" onClick={() => startEdit(p)}>
                  Edit
                </button>
                <button type="button" className="btn btn-danger" onClick={() => void remove(p)} disabled={saving}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
