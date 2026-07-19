import fs from 'fs'
import path from 'path'
import type { GameInstance, InstalledMod, LoaderType, ModrinthVersion } from '../../shared/types'
import { getInstanceModsDir } from '../paths'
import { addModToInstance, getInstance } from './instances'
import {
  downloadFile,
  getProject,
  getProjectVersions,
  getVersion,
  pickPrimaryFile,
} from './modrinth'

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
  version: ModrinthVersion,
  fileName: string,
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
  }
}

async function resolveVersionForProject(
  projectId: string,
  preferredVersionId: string | null | undefined,
  gameVersion: string,
  loader: LoaderType,
): Promise<ModrinthVersion | null> {
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
 * Install a mod and recursively install all *required* Modrinth dependencies.
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
        toInstalledMod(project, version, file.filename),
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
