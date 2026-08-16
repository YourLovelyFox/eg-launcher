import { useCallback, useEffect, useState } from 'react'
import { OFFLINE_MAX_INSTANCES, OFFLINE_MAX_PRIMARY_MODS } from '../../shared/offlineLimits'
import { useAppStore } from '../store'

type OfflineUserRow = {
  id: string
  username: string
  uuid: string
  displayName: string
  createdAt: string
  instanceQuota?: number
  modQuota?: number
}

type CmsBanner =
  | { kind: 'ok'; label: string }
  | { kind: 'warn'; label: string }
  | { kind: 'err'; label: string }

type EditDraft = {
  id: string
  username: string
  displayName: string
  password: string
  instanceQuota: number
  modQuota: number
}

export function AdminOfflinePanel({
  session,
  isAdmin,
}: {
  session: string
  isAdmin: boolean
}) {
  const { showToast } = useAppStore()
  const [users, setUsers] = useState<OfflineUserRow[]>([])
  const [banner, setBanner] = useState<CmsBanner>({ kind: 'warn', label: 'Checking CMS…' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [newUser, setNewUser] = useState('')
  const [newPass, setNewPass] = useState('')
  const [edit, setEdit] = useState<EditDraft | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.hive.admin.listOfflineUsers(session)
      if (!res.ok) {
        setUsers([])
        setBanner({
          kind: 'err',
          label: res.cmsOnline === false ? res.error : `CMS list failed: ${res.error}`,
        })
        showToast('error', res.error)
        return
      }
      setUsers(res.users)
      if (!res.cmsOnline) {
        setBanner({ kind: 'err', label: res.error || 'CMS offline or unreachable' })
      } else if (res.remoteSynced) {
        setBanner({
          kind: 'ok',
          label: `CMS connected · ${res.userCount ?? res.users.length} offline user(s)`,
        })
      } else {
        setBanner({
          kind: 'warn',
          label:
            res.error ||
            `CMS online (${res.userCount ?? 0} accounts on server) but staff list failed — re-sign in under Staff`,
        })
        if (res.error) showToast('error', res.error)
      }
    } catch (err) {
      setUsers([])
      setBanner({ kind: 'err', label: (err as Error).message })
      showToast('error', (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [session, showToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function createUser() {
    setBusy(true)
    try {
      const res = await window.hive.admin.createOfflineUser(session, newUser, newPass)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', res.message)
      setNewUser('')
      setNewPass('')
      await refresh()
      try {
        const me = await window.hive.admin.staffMe()
        if (me?.staff) {
          const used = me.staff.offlineUsed ?? 0
          const quota = me.staff.offlineQuota ?? 3
          if (me.staff.role === 'staff' && used + 1 >= quota) {
            showToast(
              'success',
              res.message + ` · offline quota ${Math.min(used + 1, quota)}/${quota}`,
            )
          }
        }
      } catch {
        /* ignore */
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeUser(id: string, name: string) {
    if (!window.confirm(`Delete offline user “${name}” from the CMS?`)) return
    setBusy(true)
    try {
      const res = await window.hive.admin.deleteOfflineUser(session, id)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', res.message)
      if (edit?.id === id) setEdit(null)
      await refresh()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(u: OfflineUserRow) {
    setEdit({
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      password: '',
      instanceQuota: u.instanceQuota ?? OFFLINE_MAX_INSTANCES,
      modQuota: u.modQuota ?? OFFLINE_MAX_PRIMARY_MODS,
    })
  }

  async function saveEdit() {
    if (!edit) return
    setBusy(true)
    try {
      const res = await window.hive.admin.updateOfflineUser(session, {
        id: edit.id,
        username: edit.username,
        displayName: edit.displayName,
        password: edit.password.trim() || undefined,
        instanceQuota: isAdmin ? edit.instanceQuota : undefined,
        modQuota: isAdmin ? edit.modQuota : undefined,
      })
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', res.message)
      setEdit(null)
      await refresh()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const bannerColor =
    banner.kind === 'ok'
      ? 'var(--green)'
      : banner.kind === 'warn'
        ? 'var(--amber)'
        : 'var(--red)'

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Create offline user</h2>
        <p className="hint">
          Username + password for offline (non-premium) play. Users log in under{' '}
          <strong>Account → Offline login</strong>. Staff accounts can create up to{' '}
          <strong>3 offline users</strong> each (live, no approval). Admins have no limit.
        </p>
        <p className="muted" style={{ marginBottom: 12, color: bannerColor }}>
          {banner.label}
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>Username</label>
            <input
              className="input"
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
              placeholder="3–16 chars, A–Z 0–9 _"
              maxLength={16}
            />
          </div>
          <div className="form-row">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          disabled={busy || !newUser || !newPass}
          onClick={createUser}
        >
          Create user
        </button>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Offline users ({users.length})</h2>
          <button className="btn btn-ghost" disabled={loading || busy} onClick={() => refresh()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {users.length === 0 ? (
          <div className="empty" style={{ padding: 24, marginTop: 12 }}>
            <h3>No offline users loaded</h3>
            <p>
              If CMS is connected and the list is empty, create a user above. If you see a staff
              session warning, sign out and sign back in under Staff.
            </p>
          </div>
        ) : (
          <div className="list" style={{ marginTop: 12 }}>
            {users.map((u) => {
              const inst = u.instanceQuota ?? OFFLINE_MAX_INSTANCES
              const mods = u.modQuota ?? OFFLINE_MAX_PRIMARY_MODS
              const open = edit?.id === u.id
              return (
                <div key={u.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                  <div className="grow">
                    <div className="title">{u.displayName || u.username}</div>
                    <div className="sub mono">
                      {u.username} · {inst} instances · {mods} mods · {u.uuid}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => (open ? setEdit(null) : startEdit(u))}
                  >
                    {open ? 'Close' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => removeUser(u.id, u.username)}
                  >
                    Delete
                  </button>
                  {open && edit && (
                    <div style={{ width: '100%', marginTop: 12 }}>
                      <div className="form-grid">
                        <div className="form-row">
                          <label>Username</label>
                          <input
                            className="input"
                            value={edit.username}
                            maxLength={16}
                            onChange={(e) => setEdit({ ...edit, username: e.target.value })}
                          />
                        </div>
                        <div className="form-row">
                          <label>Display name</label>
                          <input
                            className="input"
                            value={edit.displayName}
                            maxLength={64}
                            onChange={(e) => setEdit({ ...edit, displayName: e.target.value })}
                          />
                        </div>
                        <div className="form-row">
                          <label>New password</label>
                          <input
                            className="input"
                            type="password"
                            value={edit.password}
                            placeholder="Leave blank to keep"
                            autoComplete="new-password"
                            onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="form-grid" style={{ marginTop: 10 }}>
                        <div className="form-row">
                          <label>Instance quota</label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={!isAdmin || busy || edit.instanceQuota <= 0}
                              onClick={() =>
                                setEdit({ ...edit, instanceQuota: edit.instanceQuota - 1 })
                              }
                            >
                              −
                            </button>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              max={999}
                              disabled={!isAdmin}
                              value={edit.instanceQuota}
                              onChange={(e) =>
                                setEdit({
                                  ...edit,
                                  instanceQuota: Math.max(
                                    0,
                                    Math.min(999, Number(e.target.value) || 0),
                                  ),
                                })
                              }
                              style={{ width: 88, textAlign: 'center' }}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={!isAdmin || busy || edit.instanceQuota >= 999}
                              onClick={() =>
                                setEdit({ ...edit, instanceQuota: edit.instanceQuota + 1 })
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <div className="form-row">
                          <label>Mod quota (per instance)</label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={!isAdmin || busy || edit.modQuota <= 0}
                              onClick={() => setEdit({ ...edit, modQuota: edit.modQuota - 1 })}
                            >
                              −
                            </button>
                            <input
                              className="input"
                              type="number"
                              min={0}
                              max={999}
                              disabled={!isAdmin}
                              value={edit.modQuota}
                              onChange={(e) =>
                                setEdit({
                                  ...edit,
                                  modQuota: Math.max(
                                    0,
                                    Math.min(999, Number(e.target.value) || 0),
                                  ),
                                })
                              }
                              style={{ width: 88, textAlign: 'center' }}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={!isAdmin || busy || edit.modQuota >= 999}
                              onClick={() => setEdit({ ...edit, modQuota: edit.modQuota + 1 })}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                      {!isAdmin && (
                        <p className="hint" style={{ marginTop: 8 }}>
                          Only admins can change instance and mod quotas. You can still edit
                          username, display name, and password.
                        </p>
                      )}
                      <button
                        className="btn btn-primary"
                        style={{ marginTop: 12 }}
                        disabled={busy || !edit.username}
                        onClick={saveEdit}
                      >
                        Save changes
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
