import fs from 'fs'
import path from 'path'
import type { GameInstance, InstalledMod, LoaderType, CatalogVersion } from '../../shared/types'
import { getInstanceModsDir } from '../paths'
import { addModToInstance, getInstance, updateInstance } from './instances'
import { assertOfflineCanAddPrimaryMods } from './offlineAuth'
import {
  downloadFile,
  getProject,
  getProjectVersions,
  getVersion,
  pickPrimaryFile,
} from './catalog'

export type InstallModResult = {
  instance: GameInstance
  installed: Array<{ projectId: string; title: string; versionNumber: string; isDependency: boolean }>
  skipped: Array<{ projectId: string; title: string; reason: string }>
  failed: Array<{ projectId: string; title?: string; error: string }>
}

type ProgressFn = (event: {
  stage: string
  progress: number
  message: string
}) => void

function toInstalledMod(
  project: { id: string; slug: string; title: string; icon_url: string | null },
  version: CatalogVersion,
  fileName: string,
  isDependency = false,
): InstalledMod {
  return {
    projectId: project.id,
    versionId: version.id,
    slug: project.slug,
    title: project.title,
    iconUrl: project.icon_url,
    fileName,
    versionNumber: version.version_number,
    loaders: version.loaders,
    gameVersions: version.game_versions,
    enabled: true,
    downloadedAt: new Date().toISOString(),
    isDependency: isDependency ? true : false,
  }
}

async function resolveVersionForProject(
  projectId: string,
  preferredVersionId: string | null | undefined,
  gameVersion: string,
  loader: LoaderType,
): Promise<CatalogVersion | null> {
  if (preferredVersionId) {
    try {
      return await getVersion(preferredVersionId)
    } catch {
      // fall through to latest compatible
    }
  }
  const versions = await getProjectVersions(
    projectId,
    gameVersion,
    loader === 'vanilla' ? undefined : loader,
  )
  return versions[0] ?? null
}

/**
 * Install a mod and recursively install all *required* mod catalog dependencies.
 */
export async function installModWithDependencies(options: {
  instanceId: string
  projectId: string
  versionId: string
  resolveDependencies?: boolean
  onProgress?: ProgressFn
}): Promise<InstallModResult> {
  const resolveDeps = options.resolveDependencies !== false
  const instance = getInstance(options.instanceId)
  if (!instance) throw new Error('Instance not found')

  const modsDir = getInstanceModsDir(instance.id)
  const visited = new Set<string>()
  const installed: InstallModResult['installed'] = []
  const skipped: InstallModResult['skipped'] = []
  const failed: InstallModResult['failed'] = []

  async function installOne(
    projectId: string,
    preferredVersionId: string | null | undefined,
    isDependency: boolean,
    depth: number,
  ): Promise<void> {
    if (visited.has(projectId)) return
    visited.add(projectId)

    // Refresh instance each step (mods list changes as we install)
    let current = getInstance(options.instanceId)
    if (!current) throw new Error('Instance not found')

    let projectTitle = projectId
    try {
      const project = await getProject(projectId)
      projectTitle = project.title

      const existing = current.mods.find((m) => m.projectId === projectId)
      const version = await resolveVersionForProject(
        projectId,
        preferredVersionId,
        current.gameVersion,
        current.loader,
      )

      if (!version) {
        failed.push({
          projectId,
          title: projectTitle,
          error: `No compatible version for ${current.gameVersion} / ${current.loader}`,
        })
        return
      }

      // Already have exact version → skip download, still walk its deps if requested
      if (existing && existing.versionId === version.id) {
        skipped.push({
          projectId,
          title: project.title,
          reason: 'already installed',
        })
        options.onProgress?.({
          stage: 'deps',
          progress: 0.5,
          message: `${project.title} already installed`,
        })

        if (resolveDeps && depth < 12) {
          const required = (version.dependencies || []).filter(
            (d) => d.dependency_type === 'required' && d.project_id,
          )
          for (const dep of required) {
            await installOne(dep.project_id!, dep.version_id, true, depth + 1)
          }
        }
        return
      }

      const file = pickPrimaryFile(version)
      if (!file) {
        failed.push({ projectId, title: projectTitle, error: 'No downloadable file' })
        return
      }

      // Offline tier: only brand-new primary (user-chosen) mods consume a slot
      if (!isDependency && !existing) {
        const latest = getInstance(options.instanceId)
        if (latest) assertOfflineCanAddPrimaryMods(latest, 1)
      }

      // Remove previous jar if filename changed (update)
      if (existing && existing.fileName && existing.fileName !== file.filename) {
        const oldPath = path.join(modsDir, existing.fileName)
        const oldDisabled = `${oldPath}.disabled`
        try {
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
          if (fs.existsSync(oldDisabled)) fs.unlinkSync(oldDisabled)
        } catch {
          // ignore
        }
      }

      const dest = path.join(modsDir, file.filename)
      options.onProgress?.({
        stage: isDependency ? 'dependency' : 'download',
        progress: 0.1,
        message: isDependency
          ? `Installing dependency: ${project.title}…`
          : `Downloading ${project.title}…`,
      })

      await downloadFile(file.url, dest, (downloaded, total) => {
        options.onProgress?.({
          stage: isDependency ? 'dependency' : 'download',
          progress: total ? Math.min(0.95, downloaded / total) : 0.5,
          message: isDependency
            ? `Dependency ${project.title}…`
            : `Downloading ${file.filename}…`,
        })
      })

      addModToInstance(
        options.instanceId,
        toInstalledMod(project, version, file.filename, isDependency),
      )

      installed.push({
        projectId: project.id,
        title: project.title,
        versionNumber: version.version_number,
        isDependency,
      })

      // Required dependencies first (so parents load after deps exist)
      if (resolveDeps && depth < 12) {
        const required = (version.dependencies || []).filter(
          (d) => d.dependency_type === 'required' && d.project_id,
        )
        for (const dep of required) {
          await installOne(dep.project_id!, dep.version_id, true, depth + 1)
        }
      }
    } catch (err) {
      failed.push({
        projectId,
        title: projectTitle,
        error: (err as Error).message || 'Install failed',
      })
    }
  }

  // Install required dependencies of the target version BEFORE the main mod when possible.
  // Strategy: fetch target version first, install its required deps, then the mod itself.
  // installOne already walks deps after install; for better order we pre-walk target deps.
  if (resolveDeps) {
    try {
      const rootVersion = await getVersion(options.versionId)
      const required = (rootVersion.dependencies || []).filter(
        (d) => d.dependency_type === 'required' && d.project_id,
      )
      for (const dep of required) {
        await installOne(dep.project_id!, dep.version_id, true, 0)
      }
    } catch {
      // continue; main install will retry deps
    }
  }

  await installOne(options.projectId, options.versionId, false, 0)

  const finalInstance = getInstance(options.instanceId)
  if (!finalInstance) throw new Error('Instance not found after install')

  const depCount = installed.filter((i) => i.isDependency).length
  const main = installed.find((i) => !i.isDependency)
  options.onProgress?.({
    stage: 'done',
    progress: 1,
    message:
      depCount > 0
        ? `Installed ${main?.title || 'mod'} + ${depCount} dependenc${depCount === 1 ? 'y' : 'ies'}`
        : `Installed ${main?.title || 'mod'}`,
  })

  return {
    instance: finalInstance,
    installed,
    skipped,
    failed,
  }
}

type BatchTarget = {
  projectId: string
  versionId: string
  isDependency: boolean
  title: string
  version: CatalogVersion
  project: { id: string; slug: string; title: string; icon_url: string | null }
  fileName: string
  url: string
  previousFileName?: string
}

/**
 * Update / install many mods as one job: resolve deps once, download in parallel,
 * write instance metadata once. Used by "Update all".
 */
export async function installModsBatch(options: {
  instanceId: string
  mods: Array<{ projectId: string; versionId: string }>
  resolveDependencies?: boolean
  concurrency?: number
  onProgress?: ProgressFn
}): Promise<InstallModResult> {
  const resolveDeps = options.resolveDependencies !== false
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, 12))
  const instance = getInstance(options.instanceId)
  if (!instance) throw new Error('Instance not found')
  if (!options.mods.length) {
    return { instance, installed: [], skipped: [], failed: [] }
  }

  const modsDir = getInstanceModsDir(instance.id)
  const installed: InstallModResult['installed'] = []
  const skipped: InstallModResult['skipped'] = []
  const failed: InstallModResult['failed'] = []

  // projectId → preferred version (roots win over dep suggestions if both present)
  const wanted = new Map<string, { versionId: string; isRoot: boolean }>()
  for (const m of options.mods) {
    if (!m.projectId || !m.versionId) continue
    wanted.set(m.projectId, { versionId: m.versionId, isRoot: true })
  }

  options.onProgress?.({
    stage: 'resolve',
    progress: 0.02,
    message: `Preparing ${wanted.size} update${wanted.size === 1 ? '' : 's'}…`,
  })

  // Expand required dependencies (use pinned version ids when present — fewer API calls)
  const versionCache = new Map<string, CatalogVersion>()
  if (resolveDeps) {
    const queue = [...wanted.entries()].map(([projectId, v]) => ({
      projectId,
      versionId: v.versionId,
      depth: 0,
    }))
    const seen = new Set<string>()
    while (queue.length) {
      const item = queue.shift()!
      if (seen.has(item.projectId) || item.depth > 12) continue
      seen.add(item.projectId)
      try {
        let ver = versionCache.get(item.versionId)
        if (!ver) {
          ver = await getVersion(item.versionId)
          versionCache.set(item.versionId, ver)
        }
        for (const dep of ver.dependencies || []) {
          if (dep.dependency_type !== 'required' || !dep.project_id) continue
          if (wanted.has(dep.project_id)) continue
          // Prefer exact dep version from parent — avoids search + cuts rate limit load
          if (!dep.version_id) continue
          wanted.set(dep.project_id, { versionId: dep.version_id, isRoot: false })
          queue.push({
            projectId: dep.project_id,
            versionId: dep.version_id,
            depth: item.depth + 1,
          })
        }
      } catch {
        // handled in prepare pass
      }
    }
  }

  // Prepare download targets — batch project metadata, reuse version cache
  const targets: BatchTarget[] = []
  const entries = [...wanted.entries()]
  options.onProgress?.({
    stage: 'resolve',
    progress: 0.05,
    message: `Fetching version info (${entries.length})…`,
  })

  // Load every version id once (rate-limited inside catalog client)
  for (let i = 0; i < entries.length; i++) {
    const [projectId, pref] = entries[i]!
    if (versionCache.has(pref.versionId)) continue
    try {
      const ver = await getVersion(pref.versionId)
      versionCache.set(pref.versionId, ver)
    } catch (err) {
      failed.push({
        projectId,
        title: projectId,
        error: (err as Error).message || 'Version lookup failed',
      })
    }
    if (i % 5 === 0 || i === entries.length - 1) {
      options.onProgress?.({
        stage: 'resolve',
        progress: 0.05 + ((i + 1) / Math.max(entries.length, 1)) * 0.08,
        message: `Fetching versions… ${i + 1}/${entries.length}`,
      })
    }
  }

  // One (chunked) projects call instead of N× getProject
  options.onProgress?.({
    stage: 'resolve',
    progress: 0.14,
    message: 'Fetching mod names…',
  })
  const projectIds = entries.map(([id]) => id)
  let projectById = new Map<string, Awaited<ReturnType<typeof getProject>>>()
  try {
    const { getProjects } = await import('./catalog')
    const list = await getProjects(projectIds)
    projectById = new Map(list.map((p) => [p.id, p]))
    for (const p of list) {
      if (p.slug) projectById.set(p.slug, p)
    }
  } catch {
    // fall through — per-mod title fallback below
  }

  for (const [projectId, pref] of entries) {
    if (failed.some((f) => f.projectId === projectId)) continue
    try {
      const version = versionCache.get(pref.versionId)
      if (!version) {
        // try one more resolve (may use latest compatible)
        const v2 = await resolveVersionForProject(
          projectId,
          pref.versionId,
          instance.gameVersion,
          instance.loader,
        )
        if (!v2) {
          failed.push({
            projectId,
            title: projectById.get(projectId)?.title || projectId,
            error: `No compatible version for ${instance.gameVersion} / ${instance.loader}`,
          })
          continue
        }
        versionCache.set(pref.versionId, v2)
      }
      const ver = versionCache.get(pref.versionId)!
      let project = projectById.get(projectId) || projectById.get(ver.project_id)
      if (!project) {
        try {
          project = await getProject(projectId)
          projectById.set(project.id, project)
        } catch {
          project = {
            id: ver.project_id || projectId,
            slug: projectId,
            title: ver.name || projectId,
            icon_url: null,
          } as Awaited<ReturnType<typeof getProject>>
        }
      }

      const existing = instance.mods.find(
        (m) => m.projectId === projectId || m.projectId === project!.id,
      )
      if (existing && existing.versionId === ver.id) {
        skipped.push({ projectId: project.id, title: project.title, reason: 'already installed' })
        continue
      }
      const file = pickPrimaryFile(ver)
      if (!file?.url) {
        failed.push({ projectId: project.id, title: project.title, error: 'No downloadable file' })
        continue
      }
      targets.push({
        projectId: project.id,
        versionId: ver.id,
        isDependency: !pref.isRoot,
        title: project.title,
        version: ver,
        project: {
          id: project.id,
          slug: project.slug,
          title: project.title,
          icon_url: project.icon_url,
        },
        fileName: file.filename,
        url: file.url,
        previousFileName: existing?.fileName,
      })
    } catch (err) {
      failed.push({
        projectId,
        title: projectById.get(projectId)?.title || projectId,
        error: (err as Error).message || 'Resolve failed',
      })
    }
  }

  if (targets.length === 0) {
    options.onProgress?.({
      stage: 'done',
      progress: 1,
      message: skipped.length ? 'Everything already up to date' : 'Nothing to update',
    })
    return {
      instance: getInstance(options.instanceId) || instance,
      installed,
      skipped,
      failed,
    }
  }

  // Offline: only new primary (root) mods need free slots — updates & deps free
  const newPrimaryRoots = targets.filter(
    (t) =>
      !t.isDependency &&
      !instance.mods.some((m) => m.projectId === t.projectId || m.projectId === t.project.id),
  ).length
  assertOfflineCanAddPrimaryMods(instance, newPrimaryRoots)

  // Parallel downloads with stable, monotonic overall progress
  const totalN = targets.length
  const fileFrac = new Array<number>(totalN).fill(0) // 0..1 per file
  let finishedCount = 0
  let activeCount = 0
  let cursor = 0
  const ready: BatchTarget[] = []
  let lastEmitAt = 0
  let lastProgress = 0.2
  let lastShownPct = -1

  const emitDownloadProgress = (force = false) => {
    const sum = fileFrac.reduce((a, b) => a + b, 0)
    // Map file completion into 20% → 90% of the overall bar
    const raw = 0.2 + (sum / Math.max(totalN, 1)) * 0.7
    // Never go backwards (parallel workers used to fight each other)
    const progress = Math.max(lastProgress, Math.min(0.9, raw))
    const pct = Math.round(progress * 100)
    const now = Date.now()
    if (!force && pct === lastShownPct && now - lastEmitAt < 120) return
    lastEmitAt = now
    lastProgress = progress
    lastShownPct = pct
    options.onProgress?.({
      stage: 'download',
      progress,
      // Stable label — no flipping between mod names mid-download
      message:
        finishedCount >= totalN
          ? `Downloaded ${totalN} mods`
          : activeCount > 1
            ? `Downloading mods… ${finishedCount}/${totalN} done (${activeCount} active)`
            : `Downloading mods… ${finishedCount}/${totalN} done`,
    })
  }

  async function worker() {
    while (cursor < targets.length) {
      const i = cursor++
      const t = targets[i]!
      activeCount++
      emitDownloadProgress(true)
      try {
        // Drop old jar if filename changed
        if (t.previousFileName && t.previousFileName !== t.fileName) {
          const oldPath = path.join(modsDir, t.previousFileName)
          const oldDisabled = `${oldPath}.disabled`
          try {
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
            if (fs.existsSync(oldDisabled)) fs.unlinkSync(oldDisabled)
          } catch {
            // ignore
          }
        }
        const dest = path.join(modsDir, t.fileName)
        await downloadFile(t.url, dest, (downloaded, total) => {
          if (total > 0) {
            fileFrac[i] = Math.min(0.99, downloaded / total)
          } else {
            // Unknown size: nudge slowly so the bar still moves
            fileFrac[i] = Math.min(0.5, (fileFrac[i] || 0) + 0.02)
          }
          emitDownloadProgress(false)
        })
        fileFrac[i] = 1
        ready.push(t)
      } catch (err) {
        fileFrac[i] = 1 // count as finished slot so bar still reaches 90%
        failed.push({
          projectId: t.projectId,
          title: t.title,
          error: (err as Error).message || 'Download failed',
        })
      } finally {
        finishedCount++
        activeCount = Math.max(0, activeCount - 1)
        emitDownloadProgress(true)
      }
    }
  }

  options.onProgress?.({
    stage: 'download',
    progress: 0.2,
    message: `Downloading ${totalN} mods…`,
  })
  await Promise.all(Array.from({ length: Math.min(concurrency, totalN) }, () => worker()))
  emitDownloadProgress(true)

  // Single metadata write for all successful downloads
  options.onProgress?.({ stage: 'apply', progress: 0.92, message: 'Applying updates…' })
  let current = getInstance(options.instanceId)
  if (!current) throw new Error('Instance not found after downloads')

  let mods = [...current.mods]
  for (const t of ready) {
    const rec = toInstalledMod(t.project, t.version, t.fileName, t.isDependency)
    const prev = mods.find((m) => m.projectId === rec.projectId)
    // Keep primary status if it was already a user-chosen mod
    if (prev?.isDependency === false) rec.isDependency = false
    mods = mods.filter((m) => m.projectId !== rec.projectId)
    mods.push(rec)
    installed.push({
      projectId: rec.projectId,
      title: rec.title,
      versionNumber: rec.versionNumber,
      isDependency: rec.isDependency === true,
    })
  }
  current = updateInstance(options.instanceId, { mods })

  const mainCount = installed.filter((i) => !i.isDependency).length
  const depCount = installed.filter((i) => i.isDependency).length
  options.onProgress?.({
    stage: 'done',
    progress: 1,
    message:
      depCount > 0
        ? `Updated ${mainCount} mod${mainCount === 1 ? '' : 's'} + ${depCount} dependenc${depCount === 1 ? 'y' : 'ies'}`
        : `Updated ${mainCount} mod${mainCount === 1 ? '' : 's'}`,
  })

  return {
    instance: current,
    installed,
    skipped,
    failed,
  }
}
