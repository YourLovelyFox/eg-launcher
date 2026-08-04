import { cmsRequest } from './cms/httpClient'
import { getStaffInfo, getStaffSessionToken, isStaffAdmin } from './staffSession'

export type ApprovalItem = {
  id: string
  type: string
  summary: string
  payload: unknown
  submittedBy: string
  submittedByName: string
  status: string
  createdAt: string
  reviewedAt?: string | null
  reviewNote?: string | null
}

/** Staff (non-admin) must queue changes; admins publish live. */
export function staffMustQueue(): boolean {
  const s = getStaffInfo()
  return Boolean(s && s.role === 'staff')
}

export async function submitApproval(input: {
  type: string
  summary: string
  payload: unknown
}): Promise<{ ok: true; id: string; message?: string } | { ok: false; error: string }> {
  try {
    const staffTok = getStaffSessionToken()
    const r = await cmsRequest<{ id?: string; message?: string; error?: string }>({
      path: 'approvals.php?action=submit',
      method: 'POST',
      admin: true,
      sessionToken: staffTok,
      body: { ...input, sessionToken: staffTok || undefined },
    })
    if (!r.id) return { ok: false, error: r.error || 'Submit failed' }
    return { ok: true, id: r.id, message: r.message }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function listApprovals(
  status = 'pending',
): Promise<{ ok: true; items: ApprovalItem[] } | { ok: false; error: string }> {
  try {
    const r = await cmsRequest<{ items?: ApprovalItem[] }>({
      path: `approvals.php?action=list&status=${encodeURIComponent(status)}`,
      admin: true,
      sessionToken: getStaffSessionToken(),
    })
    return { ok: true, items: r.items || [] }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function reviewApproval(
  id: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<{ ok: true; message?: string } | { ok: false; error: string }> {
  try {
    const r = await cmsRequest<{ message?: string; error?: string }>({
      path: 'approvals.php?action=review',
      method: 'POST',
      admin: true,
      sessionToken: getStaffSessionToken(),
      body: { id, decision, note },
    })
    return { ok: true, message: r.message }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export { isStaffAdmin }
