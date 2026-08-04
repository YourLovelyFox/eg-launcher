import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store'

type StaffUser = {
  id: string
  username: string
  role: string
  offlineQuota: number
  offlineUsed: number
  enabled: boolean
  email?: string | null
  emailBound?: boolean
}

export function AdminStaffUsersPanel({ session }: { session: string }) {
  const { showToast } = useAppStore()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'staff'>('staff')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await window.hive.admin.listStaffUsers(session)
    if (!res.ok) {
      showToast('error', res.error)
      return
    }
    setUsers((res.users || []) as StaffUser[])
  }, [session, showToast])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    const em = email.trim()
    if (!em || !em.includes('@')) {
      showToast('error', 'A valid email is required for every staff account')
      return
    }
    setBusy(true)
    try {
      const res = await window.hive.admin.createStaffUser(session, {
        username: username.trim(),
        password,
        role,
        offlineQuota: role === 'staff' ? 3 : 999,
        email: em,
      })
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', res.message || 'Created')
      setUsername('')
      setPassword('')
      setEmail('')
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
        <h2>Create staff / admin user</h2>
        <p className="hint">
          Every Staff/Admin account needs a bound email for Forgot Password. Existing accounts without
          email must bind one on next login before using features.
        </p>
        <div className="form-grid">
          <div className="form-row">
            <label>Username</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>Email (required)</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@example.com"
            />
          </div>
          <div className="form-row">
            <label>Role</label>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'staff')}>
              <option value="staff">Staff (limited + verification)</option>
              <option value="admin">Admin (full)</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          disabled={busy || !username || password.length < 4 || !email.trim()}
          onClick={() => void create()}
        >
          Create user
        </button>
      </div>
      <div className="panel">
        <h2>Users ({users.length})</h2>
        <div className="list" style={{ marginTop: 10 }}>
          {users.map((u) => (
            <div key={u.id} className="list-item">
              <div className="grow">
                <div className="title">
                  {u.username}{' '}
                  <span className={`badge ${u.role === 'admin' ? 'badge-green' : 'badge-blue'}`}>
                    {u.role}
                  </span>
                  {u.emailBound ? (
                    <span className="badge badge-green" style={{ marginLeft: 6 }}>
                      email
                    </span>
                  ) : (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      no email
                    </span>
                  )}
                </div>
                <div className="sub">
                  Offline accounts: {u.offlineUsed}/{u.offlineQuota}
                  {u.email ? ` · ${u.email}` : ' · email not bound'}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Delete ${u.username}?`)) return
                  const res = await window.hive.admin.deleteStaffUser(session, u.id)
                  if (!res.ok) showToast('error', res.error)
                  else {
                    showToast('success', 'Deleted')
                    await load()
                  }
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
