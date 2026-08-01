import { app } from 'electron'
import { resolveCmsApiBase } from '../../shared/cmsApi'
import { listPartnerConfigsFromDb } from './db/partnersRepo'
import { fetchNewsFromDb } from './db/newsRepo'
import { queryMinecraftServer } from './serverStatus'
import { getAppVersionInfo } from './updater'
import { findJava } from './java'
import { cmsRequest } from './cms/httpClient'

export type HealthCheckResult = {
  ok: boolean
  name: string
  detail: string
  latencyMs?: number
}

export type AdminHealthSnapshot = {
  checkedAt: string
  cmsBase: string
  app: { version: string; isPackaged: boolean; platform: string; arch: string }
  java: { path: string | null; version: string | null }
  checks: HealthCheckResult[]
  partners: Array<{
    id: string
    title: string
    serverAddress: string
    online: boolean
    players?: string
    latencyMs?: number
    error?: string
  }>
  news: {
    launcherItems: number
    partnerItems: number
    launcherUpdated: string | null
    partnerUpdated: string | null
  }
}

async function timedCheck(
  name: string,
  fn: () => Promise<{ ok: boolean; detail: string }>,
): Promise<HealthCheckResult> {
  const t0 = Date.now()
  try {
    const r = await fn()
    return { ...r, name, latencyMs: Date.now() - t0 }
  } catch (err) {
    return {
      ok: false,
      name,
      detail: (err as Error).message,
      latencyMs: Date.now() - t0,
    }
  }
}

export async function getAdminHealthSnapshot(): Promise<AdminHealthSnapshot> {
  const cmsBase = resolveCmsApiBase()
  const version = getAppVersionInfo()

  let javaPath: string | null = null
  let javaVersion: string | null = null
  try {
    const j = await findJava()
    javaPath = j?.path || null
    javaVersion = j?.version != null ? String(j.version) : null
  } catch {
    /* ignore */
  }

  const checks: HealthCheckResult[] = []

  checks.push(
    await timedCheck('CMS health.php', async () => {
      const r = await cmsRequest<{ ok?: boolean; service?: string; db?: boolean; time?: string }>({
        path: 'health.php',
      })
      if (!r.ok) return { ok: false, detail: 'health not ok' }
      return {
        ok: true,
        detail: `db=${r.db ? 'up' : 'down'} · ${r.time || r.service || 'ok'}`,
      }
    }),
  )

  checks.push(
    await timedCheck('CMS news.php', async () => {
      const r = await cmsRequest<{ ok?: boolean; items?: unknown[]; error?: string }>({
        path: 'news.php?kind=launcher',
      })
      if (r.error) return { ok: false, detail: r.error }
      return { ok: true, detail: `${Array.isArray(r.items) ? r.items.length : 0} launcher news items` }
    }),
  )

  checks.push(
    await timedCheck('CMS partners.php', async () => {
      const r = await cmsRequest<{ ok?: boolean; partners?: unknown[]; error?: string }>({
        path: 'partners.php',
      })
      if (r.error) return { ok: false, detail: r.error }
      return {
        ok: true,
        detail: `${Array.isArray(r.partners) ? r.partners.length : 0} partners`,
      }
    }),
  )

  checks.push(
    await timedCheck('CMS offline_auth.php', async () => {
      const r = await cmsRequest<{
        ok?: boolean
        unlockConfigured?: boolean
        userCount?: number
        error?: string
      }>({ path: 'offline_auth.php?action=status' })
      if (r.error) return { ok: false, detail: r.error }
      if (r.ok === false) return { ok: false, detail: 'status not ok' }
      return {
        ok: true,
        detail: `users=${r.userCount ?? 0} · unlock=${r.unlockConfigured ? 'set' : 'none'} · public status OK`,
      }
    }),
  )

  checks.push(
    await timedCheck('CMS partner_events.php', async () => {
      const r = await cmsRequest<{ ok?: boolean; events?: unknown[]; error?: string }>({
        path: 'partner_events.php',
      })
      if (r.error) return { ok: false, detail: r.error }
      return {
        ok: true,
        detail: `${Array.isArray(r.events) ? r.events.length : 0} events total`,
      }
    }),
  )

  let launcherItems = 0
  let partnerItems = 0
  let launcherUpdated: string | null = null
  let partnerUpdated: string | null = null
  try {
    const ln = await fetchNewsFromDb('launcher')
    launcherItems = ln.items?.length || 0
    launcherUpdated = ln.updated || null
  } catch {
    /* ignore */
  }
  try {
    const pn = await fetchNewsFromDb('partners')
    partnerItems = pn.items?.length || 0
    partnerUpdated = pn.updated || null
  } catch {
    /* ignore */
  }

  const partnersOut: AdminHealthSnapshot['partners'] = []
  try {
    const partners = await listPartnerConfigsFromDb()
    for (const p of partners.slice(0, 12)) {
      try {
        const st = await queryMinecraftServer(p.serverAddress)
        partnersOut.push({
          id: p.id,
          title: p.title,
          serverAddress: p.serverAddress,
          online: st.online,
          players:
            st.playersOnline != null && st.playersMax != null
              ? `${st.playersOnline}/${st.playersMax}`
              : undefined,
          latencyMs: st.latencyMs,
          error: st.error,
        })
      } catch (err) {
        partnersOut.push({
          id: p.id,
          title: p.title,
          serverAddress: p.serverAddress,
          online: false,
          error: (err as Error).message,
        })
      }
    }
  } catch (err) {
    checks.push({
      ok: false,
      name: 'Partner list',
      detail: (err as Error).message,
    })
  }

  return {
    checkedAt: new Date().toISOString(),
    cmsBase,
    app: {
      version: version.version || app.getVersion(),
      isPackaged: version.isPackaged,
      platform: version.platform,
      arch: version.arch,
    },
    java: { path: javaPath, version: javaVersion },
    checks,
    partners: partnersOut,
    news: {
      launcherItems,
      partnerItems,
      launcherUpdated,
      partnerUpdated,
    },
  }
}
