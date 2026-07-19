import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { FEATURED_PACK } from '../../shared/branding'
import type { GameInstance, LoaderType, ProgressEvent } from '../../shared/types'
import {
  ensureDir,
  getDataRoot,
  getInstanceDir,
  getInstanceModsDir,
  readJsonFile,
  writeJsonFile,
} from '../paths'
import { createInstance, getInstance, listInstances, updateInstance } from './instances'
import { downloadFile, getProject, getProjectVersions, getVersion, pickPrimaryFile } from './modrinth'
import { installInstanceRuntime } from './minecraft'

export type FeaturedPackState = {
  slug: string
  installed: boolean
  instanceId: string | null
  versionId: string | null
  versionNumber: string | null
  installedAt: string | null
}

export type FeaturedPackNewsItem = {
  versionId: string
  versionNumber: string
  name: string
  datePublished: string
  changelog: string
  versionType: string
  isLatest: boolean
  /** True when this version is newer than the one currently installed (or all if not installed). */
  isNew: boolean
}

export type FeaturedPackStatus = {
  project: {
    id: string
    slug: string
    title: string
    description: string
    iconUrl: string | null
    loaders: string[]
    gameVersions: string[]
  }
  latest: {
    id: string
    versionNumber: string
    name: string
    gameVersions: string[]
    loaders: string[]
    datePublished: string
    downloads: number
    fileName: string
    fileSize: number
    downloadUrl: string
    changelog: string
  } | null
  local: FeaturedPackState
  updateAvailable: boolean
  instance: GameInstance | null
  /** Recent version changelogs from Modrinth (newest first). */
  news: FeaturedPackNewsItem[]
}

type PackStore = Record<string, FeaturedPackState>

function packStorePath(): string {
  return path.join(getDataRoot(), 'featured-packs.json')
}

function loadPackStore(): PackStore {
  return readJsonFile<PackStore>(packStorePath(), {})
}

function savePackStore(store: PackStore): void {
  writeJsonFile(packStorePath(), store)
}

function defaultLocal(slug: string): FeaturedPackState {
  return {
    slug,
    installed: false,
    instanceId: null,
    versionId: null,
    versionNumber: null,
    installedAt: null,
  }
}

export function getFeaturedPackLocal(slug: string = FEATURED_PACK.slug): FeaturedPackState {
  const store = loadPackStore()
  return store[slug] || defaultLocal(slug)
}

export async function getFeaturedPackStatus(
  slug: string = FEATURED_PACK.slug,
): Promise<FeaturedPackStatus> {
  const project = await getProject(slug)
  const versions = await getProjectVersions(slug)
  const latestVersion = versions[0] ?? null
  const file = latestVersion ? pickPrimaryFile(latestVersion) : null

  const local = getFeaturedPackLocal(slug)
  // Re-link instance if it still exists
  let instance: GameInstance | null = null
  if (local.instanceId) {
    instance = getInstance(local.instanceId)
    if (!instance) {
      local.installed = false
      local.instanceId = null
    }
  }

  const updateAvailable = Boolean(
    local.installed &&
      local.versionId &&
      latestVersion &&
      local.versionId !== latestVersion.id,
  )

  // Build news feed from recent versions (changelogs everyone can read)
  const installedIndex = local.versionId
    ? versions.findIndex((v) => v.id === local.versionId)
    : -1

  const news: FeaturedPackNewsItem[] = versions.slice(0, 12).map((v, i) => {
    // "New for you" = published after what you have installed
    const isNew =
      local.installed && local.versionId && installedIndex >= 0
        ? i < installedIndex
        : false

    return {
      versionId: v.id,
      versionNumber: v.version_number,
      name: v.name,
      datePublished: v.date_published,
      changelog: (v.changelog || '').trim(),
      versionType: v.version_type,
      isLatest: i === 0,
      isNew,
    }
  })

  return {
    project: {
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description,
      iconUrl: project.icon_url,
      loaders: project.loaders || [],
      gameVersions: project.game_versions || [],
    },
    latest: latestVersion && file
      ? {
          id: latestVersion.id,
          versionNumber: latestVersion.version_number,
          name: latestVersion.name,
          gameVersions: latestVersion.game_versions,
          loaders: latestVersion.loaders,
          datePublished: latestVersion.date_published,
          downloads: latestVersion.downloads,
          fileName: file.filename,
          fileSize: file.size,
          downloadUrl: file.url,
          changelog: (latestVersion.changelog || '').trim(),
        }
      : null,
    local,
    updateAvailable,
    instance,
    news,
  }
}

type MrpackIndex = {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: Array<{
    path: string
    hashes?: { sha1?: string; sha512?: string }
    env?: { client?: string; server?: string }
    downloads: string[]
    fileSize?: number
  }>
  dependencies: Record<string, string>
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  ensureDir(destDir)
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const ps = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        if (Test-Path '${destDir.replace(/'/g, "''")}') {
          Remove-Item -Recurse -Force '${destDir.replace(/'/g, "''")}'
        }
        [System.IO.Compression.ZipFile]::ExtractToDirectory(
          '${zipPath.replace(/'/g, "''")}',
          '${destDir.replace(/'/g, "''")}'
        )
      `
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', ps], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let err = ''
      child.stderr?.on('data', (d) => {
        err += d.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Extract failed: ${err.slice(-400)}`))
      })
    })
  } else {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'ignore' })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('unzip failed'))
      })
    })
  }
}

function copyDirRecursive(src: string, dest: string) {
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d)
    else {
      ensureDir(path.dirname(d))
      fs.copyFileSync(s, d)
    }
  }
}

/**
 * Download & install the featured pack .mrpack into a dedicated instance.
 * Does not run automatically — only when the user clicks Install / Update.
 */
export async function installFeaturedPack(
  options: {
    slug?: string
    versionId?: string
  } = {},
  onProgress?: (e: ProgressEvent) => void,
): Promise<{ instance: GameInstance; versionNumber: string }> {
  const slug = options.slug || FEATURED_PACK.slug
  const emit = (stage: string, progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
  }

  emit('meta', 0.02, 'Fetching pack metadata…')
  const project = await getProject(slug)
  const versions = await getProjectVersions(slug)
  let version = options.versionId
    ? versions.find((v) => v.id === options.versionId) || null
    : versions[0] || null
  if (options.versionId && !version) {
    version = await getVersion(options.versionId)
  }
  if (!version) throw new Error('No pack versions found on Modrinth')

  const file = pickPrimaryFile(version)
  if (!file) throw new Error('Pack has no downloadable .mrpack file')

  const cacheDir = path.join(getDataRoot(), 'pack-cache', slug)
  ensureDir(cacheDir)
  const mrpackPath = path.join(cacheDir, file.filename.replace(/[<>:"|?*]/g, '_'))

  emit('download-pack', 0.05, `Downloading ${file.filename} (${Math.round(file.size / 1e6)} MB)…`)
  await downloadFile(file.url, mrpackPath, (downloaded, total) => {
    const t = total || file.size || 1
    emit('download-pack', 0.05 + (downloaded / t) * 0.25, `Downloading pack… ${Math.round((downloaded / t) * 100)}%`)
  })

  const extractDir = path.join(cacheDir, `extract-${version.id}`)
  emit('extract', 0.32, 'Extracting .mrpack…')
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
  await extractZip(mrpackPath, extractDir)

  const indexPath = path.join(extractDir, 'modrinth.index.json')
  if (!fs.existsSync(indexPath)) {
    throw new Error('Invalid .mrpack — missing modrinth.index.json')
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as MrpackIndex

  const mcVersion = index.dependencies.minecraft
  if (!mcVersion) throw new Error('Pack does not specify a Minecraft version')

  let loader: LoaderType = 'vanilla'
  let loaderVersion: string | undefined
  if (index.dependencies.fabric) {
    loader = 'fabric'
    loaderVersion = index.dependencies.fabric
  } else if (index.dependencies.forge) {
    loader = 'forge'
    loaderVersion = index.dependencies.forge
  } else if (index.dependencies.neoforge) {
    loader = 'neoforge'
    loaderVersion = index.dependencies.neoforge
  } else if (index.dependencies.quilt) {
    // treat quilt as fabric-like for our limited support — skip, use forge if present
    throw new Error('Quilt packs are not supported yet')
  }

  // Prefer forge full id style for our installer
  if (loader === 'forge' && loaderVersion && !loaderVersion.includes(mcVersion)) {
    loaderVersion = `${mcVersion}-${loaderVersion}`
  }

  emit('instance', 0.36, 'Creating instance…')
  const store = loadPackStore()
  const prev = store[slug]
  let instance: GameInstance | null = prev?.instanceId ? getInstance(prev.instanceId) : null

  if (!instance) {
    // Reuse existing named instance if present
    instance =
      listInstances().find(
        (i) => i.name === project.title || i.name === FEATURED_PACK.title,
      ) || null
  }

  if (!instance) {
    instance = createInstance({
      name: project.title || FEATURED_PACK.title,
      gameVersion: mcVersion,
      loader,
      loaderVersion,
    })
  } else {
    instance = updateInstance(instance.id, {
      gameVersion: mcVersion,
      loader,
      loaderVersion,
      name: project.title || instance.name,
    })
  }

  // Clear old mods folder on reinstall/update
  const modsDir = getInstanceModsDir(instance.id)
  if (fs.existsSync(modsDir)) {
    for (const f of fs.readdirSync(modsDir)) {
      try {
        fs.rmSync(path.join(modsDir, f), { force: true, recursive: true })
      } catch {
        // ignore
      }
    }
  }
  ensureDir(modsDir)

  // Download pack files (mods, resourcepacks, etc.)
  const clientFiles = index.files.filter((f) => {
    const client = f.env?.client
    return client !== 'unsupported'
  })

  emit('files', 0.4, `Downloading ${clientFiles.length} pack files…`)
  let done = 0
  const concurrency = 6
  let cursor = 0
  const gameDir = getInstanceDir(instance.id)

  async function worker() {
    while (cursor < clientFiles.length) {
      const i = cursor++
      const entry = clientFiles[i]
      const dest = path.join(gameDir, entry.path.replace(/\//g, path.sep))
      const url = entry.downloads?.[0]
      if (!url) {
        done++
        continue
      }
      try {
        await downloadFile(url, dest)
      } catch (err) {
        throw new Error(`Failed ${entry.path}: ${(err as Error).message}`)
      }
      done++
      if (done % 5 === 0 || done === clientFiles.length) {
        emit(
          'files',
          0.4 + (done / Math.max(clientFiles.length, 1)) * 0.35,
          `Pack files ${done}/${clientFiles.length}`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  // Overrides
  const overridesDir = path.join(extractDir, 'overrides')
  if (fs.existsSync(overridesDir)) {
    emit('overrides', 0.78, 'Applying overrides…')
    copyDirRecursive(overridesDir, gameDir)
  }
  const clientOverrides = path.join(extractDir, 'client-overrides')
  if (fs.existsSync(clientOverrides)) {
    copyDirRecursive(clientOverrides, gameDir)
  }

  // Install loader / vanilla runtime
  emit('runtime', 0.82, `Installing ${loader} ${mcVersion}…`)
  const refreshed = getInstance(instance.id) || instance
  await installInstanceRuntime(refreshed, (p) => {
    emit('runtime', 0.82 + p.progress * 0.16, p.message)
  })

  // Record featured pack state
  store[slug] = {
    slug,
    installed: true,
    instanceId: instance.id,
    versionId: version.id,
    versionNumber: version.version_number,
    installedAt: new Date().toISOString(),
  }
  savePackStore(store)

  emit('done', 1, `${project.title} ${version.version_number} ready`)
  return {
    instance: getInstance(instance.id) || instance,
    versionNumber: version.version_number,
  }
}
