import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store'

type OfflineUserRow = {
  id: string
  username: string
  uuid: string
  displayName: string
  createdAt: string
}

export function AdminOfflinePanel({ session }: { session: string }) {
  const { showToast } = useAppStore()
  const [users, setUsers] = useState<OfflineUserRow[]>([])
  const [unlockConfigured, setUnlockConfigured] = useState(false)
  const [remoteSynced, setRemoteSynced] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [newUser, setNewUser] = useState('')
  const [newPass, setNewPass] = useState('')
  const [unlockPass, setUnlockPass] = useState('')
  const [unlockPass2, setUnlockPass2] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.hive.admin.listOfflineUsers(session)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      setUsers(res.users)
      setUnlockConfigured(res.unlockPasswordConfigured)
      setRemoteSynced(res.remoteSynced)
    } catch (err) {
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
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeUser(id: string, name: string) {
    if (!window.confirm(`Delete offline user “${name}” from local + GitHub auth files?`)) return
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

  async function saveUnlockPassword() {
    if (unlockPass !== unlockPass2) {
      showToast('error', 'Passwords do not match')
      return
    }
    setBusy(true)
    try {
      const res = await window.hive.admin.setOfflineUnlockPassword(session, unlockPass)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', res.message)
      setUnlockPass('')
      setUnlockPass2('')
      await refresh()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    setBusy(true)
    try {
      const res = await window.hive.admin.publishOfflineAuth(session)
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

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Offline mode unlock password</h2>
        <p className="hint">
          Users must enter this password in Settings (hidden) before they can register or log in
          with offline accounts. Stored as a hash in{' '}
          <code className="mono">auth/offline-users.json</code> (private) and{' '}
          <code className="mono">news/offline-auth.json</code> (public).
        </p>
        <p className="muted" style={{ marginBottom: 12 }}>
          Status:{' '}
          {unlockConfigured ? (
            <span className="badge badge-green">Configured</span>
          ) : (
            <span className="badge badge-orange">Not set</span>
          )}{' '}
          · GitHub token: {remoteSynced ? 'available' : 'missing (local only)'}
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>New unlock password</label>
            <input
              className="input"
              type="password"
              value={unlockPass}
              onChange={(e) => setUnlockPass(e.target.value)}
              placeholder="Min 4 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="form-row">
            <label>Confirm</label>
            <input
              className="input"
              type="password"
              value={unlockPass2}
              onChange={(e) => setUnlockPass2(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy || !unlockPass} onClick={saveUnlockPassword}>
            Set unlock password
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={publish}>
            Publish auth files to GitHub
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Create offline user</h2>
        <p className="hint">
          Username + password accounts for cracked / non-premium play. Only Admins can create
          accounts — users can only log in after offline mode is unlocked in Settings.
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
            <h3>No offline users yet</h3>
            <p>Create offline users here. Users can only log in with accounts you create.</p>
          </div>
        ) : (
          <div className="list" style={{ marginTop: 12 }}>
            {users.map((u) => (
              <div key={u.id} className="list-item">
                <div className="grow">
                  <div className="title">{u.username}</div>
                  <div className="sub mono">{u.uuid}</div>
                  <div className="sub">
                    Created {new Date(u.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  className="btn btn-danger"
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
