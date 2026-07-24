import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store'

type Item = {
  id: string
  type: string
  summary: string
  submittedByName: string
  status: string
  createdAt: string
  payload?: unknown
}

export function AdminApprovalsPanel({ session }: { session: string }) {
  const { showToast } = useAppStore()
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await window.hive.admin.listApprovals(session, 'pending')
    if (!res.ok) {
      showToast('error', res.error)
      return
    }
    setItems((res.items || []) as Item[])
  }, [session, showToast])

  useEffect(() => {
    void load()
  }, [load])

  async function review(id: string, decision: 'approved' | 'rejected') {
    setBusy(true)
    try {
      const res = await window.hive.admin.reviewApproval(session, id, decision)
      if (!res.ok) {
        showToast('error', res.error)
        return
      }
      showToast('success', res.message || decision)
      await load()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Pending verification</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            Staff changes wait here until an Admin approves (then they go public).
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </div>
      {items.length === 0 ? (
        <div className="empty" style={{ padding: 24 }}>
          <h3>No pending items</h3>
        </div>
      ) : (
        <div className="list">
          {items.map((it) => (
            <div key={it.id} className="list-item" style={{ flexWrap: 'wrap' }}>
              <div className="grow">
                <div className="title">{it.summary}</div>
                <div className="sub">
                  {it.type} · by {it.submittedByName} · {new Date(it.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void review(it.id, 'approved')}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void review(it.id, 'rejected')}
              >
                Reject
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
