import { useEffect, useRef, useState } from 'react'
import type { DeviceCodeResponse } from '../../shared/types'
import { PlayerHeadWithFallback } from '../components/PlayerHead'
import { useAppStore } from '../store'

type AccountTab = 'microsoft' | 'offline'

export function AccountPage() {
  const { accounts, activeAccountId, setAccounts, showToast } = useAppStore()
  const [tab, setTab] = useState<AccountTab>('microsoft')

  const [device, setDevice] = useState<DeviceCodeResponse | null>(null)
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  const attemptsRef = useRef(0)

  const [offlineUser, setOfflineUser] = useState('')
  const [offlinePass, setOfflinePass] = useState('')
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [offlineWarning, setOfflineWarning] = useState('')

  const active = accounts.find((a) => a.id === activeAccountId)
  const activeIsOffline = Boolean(
    active && (active.type === 'offline' || active.id.startsWith('offline-')),
  )

  useEffect(() => {
    window.hive.offline
      .warning()
      .then(setOfflineWarning)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      if (pollRef.current) window.clearTimeout(pollRef.current)
    }
  }, [])

  function stopPolling() {
    if (pollRef.current) {
      window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }

  async function startLogin() {
    stopPolling()
    cancelledRef.current = false
    attemptsRef.current = 0
    setBusy(true)
    setStatus('Starting Microsoft login…')
    try {
      const code = await window.hive.auth.startDeviceCode()
      if (cancelledRef.current) return
      setDevice(code)
      setStatus('Waiting for you to approve the login in your browser…')
      await window.hive.shell.openExternal(code.verificationUri)
      poll(code.deviceCode, Math.max(code.interval || 5, 3))
    } catch (err) {
      showToast('error', (err as Error).message)
      setStatus('')
      setBusy(false)
      setDevice(null)
    }
  }

  function cancelLogin() {
    cancelledRef.current = true
    stopPolling()
    setBusy(false)
    setDevice(null)
    setStatus('')
  }

  function poll(deviceCode: string, intervalSec: number) {
    stopPolling()
    pollRef.current = window.setTimeout(async () => {
      if (cancelledRef.current) return

      try {
        attemptsRef.current += 1
        const result = await window.hive.auth.pollDeviceCode(deviceCode)

        if (cancelledRef.current) return

        if (result.status === 'pending') {
          setStatus('Waiting for approval… keep this window open.')
          poll(deviceCode, intervalSec)
          return
        }
        if (result.status === 'slow_down') {
          setStatus('Microsoft asked us to slow down — still waiting…')
          poll(deviceCode, intervalSec + 5)
          return
        }
        if (result.status === 'expired') {
          setStatus('Code expired. Click Sign in to try again.')
          setDevice(null)
          setBusy(false)
          return
        }
        if (result.status === 'declined') {
          setStatus('Login was declined.')
          setDevice(null)
          setBusy(false)
          return
        }
        if (result.status === 'completed') {
          const auth = await window.hive.auth.getAccounts()
          setAccounts(auth.accounts, auth.activeAccountId)
          setDevice(null)
          setBusy(false)
          setStatus('')
          showToast('success', `Signed in as ${result.account.username}`)
          return
        }
      } catch (err) {
        if (cancelledRef.current) return
        if (attemptsRef.current < 3) {
          setStatus('Network hiccup — retrying…')
          poll(deviceCode, intervalSec)
          return
        }
        showToast('error', (err as Error).message)
        setStatus('Login failed. Try again.')
        setBusy(false)
        setDevice(null)
      }
    }, intervalSec * 1000)
  }

  async function setActive(id: string) {
    const auth = await window.hive.auth.setActive(id)
    setAccounts(auth.accounts, auth.activeAccountId)
    const acc = auth.accounts.find((a) => a.id === auth.activeAccountId)
    if (acc && (acc.type === 'offline' || acc.id.startsWith('offline-'))) {
      window.alert(
        offlineWarning ||
          'Offline account active. You cannot join official Minecraft servers or install Bee’s SMP.',
      )
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove account ${name}?`)) return
    const auth = await window.hive.auth.remove(id)
    setAccounts(auth.accounts, auth.activeAccountId)
    showToast('success', `Removed ${name}`)
  }

  async function submitOfflineLogin() {
    setOfflineBusy(true)
    try {
      const res = await window.hive.offline.login(offlineUser, offlinePass)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      const auth = await window.hive.auth.getAccounts()
      setAccounts(auth.accounts, auth.activeAccountId)
      showToast('success', `Offline login: ${res.account.username}`)
      window.alert(
        offlineWarning ||
          'Offline account active. You cannot join official servers or download Bee’s SMP.',
      )
      setOfflinePass('')
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setOfflineBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Accounts</h1>
          <p>
            Sign in with Microsoft, or use an offline account created by an Admin (Account → Offline
            login).
          </p>
        </div>
      </div>

      {activeIsOffline && (
        <div
          className="panel"
          style={{
            marginBottom: 16,
            borderColor: 'rgba(245, 158, 11, 0.5)',
            background: 'rgba(245, 158, 11, 0.08)',
          }}
        >
          <strong>Offline account active</strong>
          <p className="hint" style={{ marginBottom: 0, marginTop: 6 }}>
            {offlineWarning ||
              'You cannot join official Minecraft servers, Realms, or servers that require a paid login. Bee’s SMP cannot be installed.'}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn ${tab === 'microsoft' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('microsoft')}
        >
          Microsoft login
        </button>
        <button
          type="button"
          className={`btn ${tab === 'offline' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('offline')}
        >
          Offline login
        </button>
      </div>

      {tab === 'microsoft' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>Microsoft</h2>
              <p className="hint" style={{ marginBottom: 0, marginTop: 6 }}>
                Paid Minecraft account. Required for official servers, Realms, and Bee&apos;s SMP.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {busy && (
                <button className="btn btn-secondary" type="button" onClick={cancelLogin}>
                  Cancel
                </button>
              )}
              <button
                className="btn btn-primary"
                type="button"
                onClick={startLogin}
                disabled={busy}
              >
                {busy ? 'Waiting…' : 'Sign in with Microsoft'}
              </button>
            </div>
          </div>

          {device && (
            <>
              <h3 style={{ fontSize: 14, marginTop: 8 }}>Approve login</h3>
              <p className="hint">
                1. Open{' '}
                <button
                  className="btn btn-ghost"
                  type="button"
                  style={{ display: 'inline', padding: 0, color: 'var(--green)' }}
                  onClick={() => window.hive.shell.openExternal(device.verificationUri)}
                >
                  {device.verificationUri}
                </button>
                <br />
                2. Enter this code and approve access:
              </p>
              <div className="device-code">{device.userCode}</div>
              <p className="muted">{status || device.message}</p>
            </>
          )}
        </div>
      )}

      {tab === 'offline' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>Offline login</h2>
          <p className="hint">
            Log in with a username and password created by an Admin. You cannot register accounts
            here. Offline (non-premium) play only — no official servers, no Bee&apos;s SMP.
          </p>
          <div className="form-grid">
            <div className="form-row">
              <label>Username</label>
              <input
                className="input"
                value={offlineUser}
                onChange={(e) => setOfflineUser(e.target.value)}
                placeholder="Admin-created username"
                maxLength={16}
                autoComplete="username"
              />
            </div>
            <div className="form-row">
              <label>Password</label>
              <input
                className="input"
                type="password"
                value={offlinePass}
                onChange={(e) => setOfflinePass(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitOfflineLogin()
                }}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={offlineBusy || !offlineUser || !offlinePass}
            onClick={() => void submitOfflineLogin()}
          >
            {offlineBusy ? '…' : 'Log in offline'}
          </button>
        </div>
      )}

      <div className="panel">
        <h2>Saved accounts</h2>
        <p className="hint">
          Microsoft accounts are required for official servers and Bee&apos;s SMP. Offline accounts
          can play singleplayer and offline-friendly multiplayer only.
        </p>

        {accounts.length === 0 ? (
          <div className="empty" style={{ padding: 28 }}>
            <h3>No accounts</h3>
            <p>Sign in with Microsoft, or open Offline login for an Admin-created account.</p>
          </div>
        ) : (
          <div className="list">
            {accounts.map((acc) => {
              const offline = acc.type === 'offline' || acc.id.startsWith('offline-')
              return (
                <div key={acc.id} className="list-item">
                  <PlayerHeadWithFallback uuid={acc.uuid} username={acc.username} size={40} />
                  <div className="grow">
                    <div className="title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {acc.username}
                      {offline ? (
                        <span className="badge badge-orange">Offline</span>
                      ) : (
                        <span className="badge badge-blue">Microsoft</span>
                      )}
                    </div>
                    <div className="sub mono">{acc.uuid}</div>
                  </div>
                  {activeAccountId === acc.id ? (
                    <span className="badge badge-green">Active</span>
                  ) : (
                    <button className="btn btn-secondary" onClick={() => setActive(acc.id)}>
                      Use
                    </button>
                  )}
                  <button className="btn btn-danger" onClick={() => remove(acc.id, acc.username)}>
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
