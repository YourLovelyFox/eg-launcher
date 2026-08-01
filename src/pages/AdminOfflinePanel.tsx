import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store'

type OfflineUserRow = {
  id: string
  username: string
  uuid: string
  displayName: string
  createdAt: string
}

type CmsBanner =
  | { kind: 'ok'; label: string }
  | { kind: 'warn'; label: string }
  | { kind: 'err'; label: string }

export function AdminOfflinePanel({ session }: { session: string }) {
  const { showToast } = useAppStore()
  const [users, setUsers] = useState<OfflineUserRow[]>([])
  const [banner, setBanner] = useState<CmsBanner>({ kind: 'warn', label: 'Checking CMS…' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [newUser, setNewUser] = useState('')
  const [newPass, setNewPass] = useState('')

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
            {users.map((u) => (
              <div key={u.id} className="list-item">
                <div className="grow">
                  <div className="title">{u.displayName || u.username}</div>
                  <div className="sub mono">
                    {u.username} · {u.uuid}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => removeUser(u.id, u.username)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
