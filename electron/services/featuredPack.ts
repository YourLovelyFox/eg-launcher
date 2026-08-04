import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { FEATURED_PACK } from '../../shared/branding'
import type {
  FeaturedPackMemoryGate,
  GameInstance,
  LoaderType,
  ProgressEvent,
} from '../../shared/types'
import {
  ensureDir,
  getDataRoot,
  getInstanceDir,
  getInstanceModsDir,
  readJsonFile,
  writeJsonFile,
} from '../paths'
import { createInstance, getInstance, listInstances, updateInstance } from './instances'
import {
  downloadFile,
  enrichModsWithProjectMeta,
  getProject,
  getProjectVersions,
  getVersion,
  getVersionsByHashes,
  PACK_INDEX_FILENAME,
  pickPrimaryFile,
} from './catalog'
import type { InstalledMod } from '../../shared/types'
import { installInstanceRuntime } from './minecraft'
import { getActiveAccountSecret } from './auth'
import { isOfflineAccount } from './offlineAuth'
import { loadSettings } from './settings'
import { formatMbLabel, getSystemMemoryInfo } from './systemMemory'
import { scanModsFromDisk } from './egpack'
import { sanitizeInstanceMods } from './modSanitize'

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
  /** Recent version changelogs from the mod catalog (newest first). */
  news: FeaturedPackNewsItem[]
  /** System RAM requirements for this heavy pack */
  memory: FeaturedPackMemoryGate
  /** Offline accounts cannot install this pack (paid Minecraft required) */
  requiresPaidAccount: boolean
  paidAccountOk: boolean
}

/**
 * Evaluate whether this PC can install / play the featured pack safely.
 * - Below 12 GB system RAM → install blocked (BSoD risk)
 * - Recommended 8 GB allocated; if the PC can allocate 8 GB it must be set
 * - On 12 GB systems (50% cap ≈ 6 GB) play is allowed after a low-memory warning
 */
export function evaluateFeaturedPackMemory(
  allocatedMb?: number,
): FeaturedPackMemoryGate {
  const system = getSystemMemoryInfo()
  const settings = loadSettings()
  const allocated = allocatedMb ?? settings.ramMaxMb
  const minSystemRamGb = FEATURED_PACK.minSystemRamGb
  const recommendedAllocatedMb = FEATURED_PACK.recommendedAllocatedMb

  const canInstall = system.totalGbRounded >= minSystemRamGb
  const installBlockReason = canInstall
    ? null
    : `${FEATURED_PACK.title} needs at least ${minSystemRamGb} GB of system RAM. Your PC has about ${system.totalGbRounded} GB. This pack is too heavy to install safely — low memory can freeze or crash Windows (BSoD).`

  const canAllocateRecommended = system.maxAllowedMb >= recommendedAllocatedMb
  const playNeedsMoreAllocated = canInstall && canAllocateRecommended && allocated < recommendedAllocatedMb
  const playNeedsLowMemoryWarning =
    canInstall && !canAllocateRecommended

  return {
    system,
    allocatedMb: allocated,
    minSystemRamGb,
    recommendedAllocatedMb,
    canInstall,
    installBlockReason,
    playNeedsMoreAllocated,
    playNeedsLowMemoryWarning,
    maxAllowedLabel: formatMbLabel(system.maxAllowedMb),
    recommendedLabel: formatMbLabel(recommendedAllocatedMb),
  }
}

/** True when this instance is the featured Bee's SMP pack. */
export function isFeaturedPackInstance(instanceId: string | null | undefined): boolean {
  if (!instanceId) return false
  const local = getFeaturedPackLocal(FEATURED_PACK.slug)
  return Boolean(local.instanceId && local.instanceId === instanceId)
}

/**
 * Hard gate used before launch. Returns an error message, a soft warning, or null if OK.
 * Soft warnings are returned as `{ warning }` so the UI can confirm; hard blocks as `{ error }`.
 */
export function checkFeaturedPackPlay(
  instanceId: string,
): { error: string } | { warning: string } | null {
  if (!isFeaturedPackInstance(instanceId)) return null

  const active = getActiveAccountSecret()
  if (!active || isOfflineAccount(active)) {
    return {
      error: `${FEATURED_PACK.title} requires a paid Microsoft Minecraft account. Offline accounts cannot play this pack.`,
    }
  }

  const gate = evaluateFeaturedPackMemory()
  if (!gate.canInstall) {
    return {
      error:
        gate.installBlockReason ||
        `${FEATURED_PACK.title} cannot run on this PC (not enough system RAM).`,
    }
  }
  if (gate.playNeedsMoreAllocated) {
    return {
      error: `${FEATURED_PACK.title} needs at least ${gate.recommendedLabel} of Maximum RAM in Settings (currently ${formatMbLabel(gate.allocatedMb)}). Your PC can allocate up to ${gate.maxAllowedLabel}.`,
    }
  }
  if (gate.playNeedsLowMemoryWarning) {
    return {
      warning: `${FEATURED_PACK.title} is a heavy pack and ideally needs ${gate.recommendedLabel} of RAM.\n\nYour PC has about ${gate.system.totalGbRounded} GB total, so the launcher only allows ${gate.maxAllowedLabel} for Minecraft.\n\nPlaying on ${gate.maxAllowedLabel} will likely feel slow, laggy, or unstable. Continue anyway?`,
    }
  }
  return null
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
    memory: evaluateFeaturedPackMemory(),
    requiresPaidAccount: true,
    paidAccountOk: (() => {
      const active = getActiveAccountSecret()
      return Boolean(active && !isOfflineAccount(active))
    })(),
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

/**
 * Extract a zip without embedding paths in the PowerShell command string.
 * Paths with apostrophes (e.g. Bee's SMP) used to break -Command scripts and spam
 * huge red parse errors into the parent console.
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  ensureDir(path.dirname(destDir))
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      // Paths via env vars — no quote escaping, no console spam from parse failures
      const ps = [
        "$ErrorActionPreference = 'Stop'",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem",
        "$zipPath = $env:EG_ZIP_PATH",
        "$destDir = $env:EG_DEST_DIR",
        "if (-not (Test-Path -LiteralPath $zipPath)) { throw \"Zip not found: $zipPath\" }",
        "if (Test-Path -LiteralPath $destDir) { Remove-Item -LiteralPath $destDir -Recurse -Force }",
        "New-Item -ItemType Directory -Force -Path $destDir | Out-Null",
        "[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $destDir)",
      ].join('; ')
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        {
          windowsHide: true,
          env: { ...process.env, EG_ZIP_PATH: zipPath, EG_DEST_DIR: destDir },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let err = ''
      let out = ''
      child.stdout?.on('data', (d) => {
        out += d.toString()
      })
      child.stderr?.on('data', (d) => {
        err += d.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else {
          const msg = (err || out || `exit ${code}`).trim().slice(-500)
          reject(new Error(`Extract failed: ${msg}`))
        }
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
      // Never drop archives into mods/ — not loadable as Forge mods (pack sometimes ships mods.zip)
      const destNorm = dest.replace(/\\/g, '/').toLowerCase()
      const name = entry.name.toLowerCase()
      if (
        destNorm.endsWith('/mods') &&
        (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z'))
      ) {
        continue
      }
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

  // Hard block: heavy pack must not install on low-RAM systems (BSoD risk)
  const memoryGate = evaluateFeaturedPackMemory()
  if (!memoryGate.canInstall) {
    throw new Error(memoryGate.installBlockReason || 'Not enough system RAM to install this pack.')
  }

  // Paid Minecraft only — offline / cracked accounts cannot install Bee's SMP
  const active = getActiveAccountSecret()
  if (!active || isOfflineAccount(active)) {
    throw new Error(
      `${FEATURED_PACK.title} requires a paid Microsoft Minecraft account. Offline (cracked) accounts cannot download or install this pack.`,
    )
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
  if (!version) throw new Error('No pack versions found in the mod catalog')

  const file = pickPrimaryFile(version)
  if (!file) throw new Error('Pack has no downloadable .mrpack file')

  const cacheDir = path.join(getDataRoot(), 'pack-cache', slug)
  ensureDir(cacheDir)
  // Avoid apostrophes/spaces breaking Windows extract shells
  const safeName = file.filename.replace(/[<>:"|?*']/g, '_').replace(/\s+/g, '_')
  const mrpackPath = path.join(cacheDir, safeName)

  emit('download-pack', 0.05, `Downloading ${file.filename} (${Math.round(file.size / 1e6)} MB)…`)
  try {
    await downloadFile(file.url, mrpackPath, (downloaded, total) => {
      const t = total || file.size || 1
      emit(
        'download-pack',
        0.05 + (downloaded / t) * 0.25,
        `Downloading pack… ${Math.round((downloaded / t) * 100)}%`,
      )
    })
  } catch (err) {
    throw new Error(`Failed to download pack: ${(err as Error).message}`)
  }

  const extractDir = path.join(cacheDir, `extract-${version.id}`)
  emit('extract', 0.32, 'Extracting .mrpack…')
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
  try {
    await extractZip(mrpackPath, extractDir)
  } catch (err) {
    throw new Error(`Failed to extract .mrpack: ${(err as Error).message}`)
  }

  const indexPath = path.join(extractDir, PACK_INDEX_FILENAME)
  if (!fs.existsSync(indexPath)) {
    throw new Error('Invalid .mrpack — missing pack index file')
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

  // Prefer branded title; folder id is sanitized (no apostrophes) by createInstance
  const displayName = FEATURED_PACK.title || project.title || slug

  if (!instance) {
    instance = createInstance({
      name: displayName,
      gameVersion: mcVersion,
      loader,
      loaderVersion,
    })
  } else {
    instance = updateInstance(instance.id, {
      gameVersion: mcVersion,
      loader,
      loaderVersion,
      name: displayName,
    })
  }

  // Clear old mods folder + metadata on reinstall/update (avoid stale "121 mods" with empty disk)
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
  instance = updateInstance(instance.id, { mods: [] })

  // Download pack files (mods, resourcepacks, etc.)
  // Match importPackFile / export: client !== 'unsupported' (missing env = include)
  const clientFiles = (index.files || []).filter((f) => f.env?.client !== 'unsupported')

  emit('files', 0.4, `Downloading ${clientFiles.length} pack files…`)
  let done = 0
  let skippedNoUrl = 0
  // Slightly lower concurrency reduces CDN resets that abort mid-pack
  const concurrency = 4
  let cursor = 0
  const gameDir = getInstanceDir(instance.id)
  let fatalError: Error | null = null

  async function worker() {
    while (cursor < clientFiles.length) {
      if (fatalError) return
      const i = cursor++
      const entry = clientFiles[i]!
      // Normalize paths: strip leading ./ or / so files land under gameDir (mods/, config/, …)
      const rel = entry.path
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .replace(/^\/+/, '')
      if (!rel || rel.includes('..')) {
        fatalError = new Error(`Invalid pack path: ${entry.path}`)
        return
      }
      const dest = path.join(gameDir, ...rel.split('/'))
      const url = entry.downloads?.find((u) => typeof u === 'string' && u.length > 0)
      if (!url) {
        // No CDN URL — file may live only under overrides/ (handled below)
        skippedNoUrl++
        done++
        continue
      }
      try {
        await downloadFile(url, dest)
      } catch (err) {
        fatalError = new Error(
          `Failed to download ${path.basename(entry.path)}: ${(err as Error).message}`,
        )
        return
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

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(clientFiles.length, 1)) }, () => worker()),
  )
  if (fatalError) throw fatalError

  // Overrides (bundled jars/configs that are not CDN index downloads)
  const overridesDir = path.join(extractDir, 'overrides')
  if (fs.existsSync(overridesDir)) {
    emit('overrides', 0.78, 'Applying overrides…')
    copyDirRecursive(overridesDir, gameDir)
  }
  const clientOverrides = path.join(extractDir, 'client-overrides')
  if (fs.existsSync(clientOverrides)) {
    copyDirRecursive(clientOverrides, gameDir)
  }

  // Register mods in instance metadata (UI lists instance.mods — not only files on disk).
  // Prefer real mod project/version ids from pack file hashes so update checks work
  // and we never query /project/local-… (404 spam).
  emit('mods', 0.8, 'Registering installed mods…')
  const hashToFile = new Map<string, { path: string; fileName: string }>()
  for (const f of clientFiles) {
    const rel = f.path.replace(/\\/g, '/').replace(/^\.?\//, '')
    if (!rel.startsWith('mods/') || !rel.toLowerCase().endsWith('.jar')) continue
    const sha1 = f.hashes?.sha1
    if (!sha1) continue
    const fileName = rel.split('/').pop() || rel
    hashToFile.set(sha1.toLowerCase(), { path: rel, fileName })
  }

  let byHash: Awaited<ReturnType<typeof getVersionsByHashes>> = {}
  const hashList = [...hashToFile.keys()]
  if (hashList.length > 0) {
    emit('mods', 0.81, `Resolving ${hashList.length} mods in the mod catalog…`)
    try {
      byHash = await getVersionsByHashes(hashList, 'sha1')
    } catch {
      byHash = {}
    }
  }

  const metaFromPack: InstalledMod[] = []
  for (const [sha1, meta] of hashToFile) {
    const ver = byHash[sha1] || byHash[sha1.toLowerCase()]
    const fileName = meta.fileName
    if (ver?.project_id && ver?.id) {
      // Prefer human version name from the mod catalog; title/icon filled in batch below
      metaFromPack.push({
        projectId: ver.project_id,
        versionId: ver.id,
        slug: ver.project_id,
        title: ver.name || fileName.replace(/\.jar$/i, ''),
        iconUrl: null,
        fileName,
        versionNumber: ver.version_number || 'unknown',
        loaders: (ver.loaders as string[])?.length ? (ver.loaders as string[]) : [loader],
        gameVersions: ver.game_versions?.length ? ver.game_versions : [mcVersion],
        enabled: true,
        downloadedAt: new Date().toISOString(),
      })
    }
  }

  const scanned = scanModsFromDisk(instance.id, metaFromPack)
  emit('mods', 0.84, 'Fetching mod names & icons…')
  let enriched = scanned.map((m) => ({
    ...m,
    loaders: m.loaders?.length ? m.loaders : [loader],
    gameVersions: m.gameVersions?.length ? m.gameVersions : [mcVersion],
  }))
  try {
    enriched = await enrichModsWithProjectMeta(enriched)
  } catch {
    // offline / rate limit — keep filename titles
  }
  instance = updateInstance(instance.id, { mods: enriched })

  // Bee's SMP (and some packs) ship Fabric API / loose zips that crash Forge
  emit('mods', 0.86, 'Checking mods for loader compatibility…')
  const cleaned = sanitizeInstanceMods(instance.id, loader)
  if (cleaned.quarantined.length > 0) {
    // Drop quarantined jars from instance metadata
    const qset = new Set(cleaned.quarantined.map((n) => n.toLowerCase()))
    const kept = (getInstance(instance.id)?.mods || []).filter(
      (m) => !qset.has(m.fileName.toLowerCase()),
    )
    instance = updateInstance(instance.id, { mods: kept })
  }

  const expectedModPaths = clientFiles.filter((f) => {
    const p = f.path.replace(/\\/g, '/').replace(/^\.?\//, '')
    return p.startsWith('mods/') && p.toLowerCase().endsWith('.jar')
  }).length
  const jarOnDisk = scanned.length

  if (jarOnDisk === 0 && (expectedModPaths > 0 || clientFiles.length > 0)) {
    throw new Error(
      `No mod jars found after install. Index listed ${clientFiles.length} client files (${expectedModPaths} under mods/), skipped without URL: ${skippedNoUrl}. Try Install again, or import the .mrpack from Instances.`,
    )
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

  emit(
    'done',
    1,
    `${project.title} ${version.version_number} ready (${jarOnDisk} mods)`,
  )
  return {
    instance: getInstance(instance.id) || instance,
    versionNumber: version.version_number,
  }
}
