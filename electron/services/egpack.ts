/**
 * EG Launcher pack export/import.
 *
 * .egpack uses standard .mrpack layout (ZIP + pack index JSON + overrides/).
 * Only the file extension differs on export (.egpack only).
 * Import accepts both .egpack and .mrpack with identical install logic.
 *
 * Spec (same as mrpack):
 *   pack index JSON      — standard .mrpack layout (formatVersion, game, files[])
 *   overrides/           — config + any files not downloaded from the index
 *   client-overrides/    — optional (import only)
 *
 * Optional eg.manifest.json may be included for EG mod metadata; not required for import.
 */
import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { APP_VERSION } from '../../shared/branding'
import type {
  EgpackExportEntry,
  EgpackExportOptions,
  GameInstance,
  InstalledMod,
  LoaderType,
  ProgressEvent,
} from '../../shared/types'
import { ensureDir, getDataRoot, getInstanceDir, getInstanceModsDir } from '../paths'
import { createInstance, getInstance, updateInstance } from './instances'
import { installInstanceRuntime } from './minecraft'
import {
  downloadFile,
  enrichModsWithProjectMeta,
  getVersion,
  PACK_INDEX_FILENAME,
  pickPrimaryFile,
} from './catalog'

export const EGPACK_EXT = '.egpack'
export const MRPACK_EXT = '.mrpack'

const PACK_EXTS = [EGPACK_EXT, MRPACK_EXT] as const

/** Content folders listed like export export picker. */
const CONTENT_FOLDERS: {
  dir: string
  group: EgpackExportEntry['group']
  recommended: boolean
  label?: string
}[] = [
  { dir: 'config', group: 'content', recommended: true },
  { dir: 'resourcepacks', group: 'content', recommended: true },
  { dir: 'shaderpacks', group: 'content', recommended: true },
  { dir: 'kubejs', group: 'content', recommended: true },
  { dir: 'defaultconfigs', group: 'content', recommended: true },
  { dir: 'datapacks', group: 'content', recommended: true },
  { dir: 'scripts', group: 'content', recommended: true },
  { dir: 'patchouli_books', group: 'content', recommended: true },
  { dir: 'saves', group: 'worlds', recommended: false, label: 'Worlds (saves)' },
]

const OPTION_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt'] as const

const SKIP_DIR_NAMES = new Set([
  'logs',
  'crash-reports',
  'screenshots',
  '.cache',
  'natives',
  'libraries',
  'versions',
  'downloads',
  'backups',
])

function dirSizeAndCount(dir: string): { size: number; count: number } {
  let size = 0
  let count = 0
  if (!fs.existsSync(dir)) return { size: 0, count: 0 }
  const walk = (p: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) {
        count++
        try {
          size += fs.statSync(full).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(dir)
  return { size, count }
}

/**
 * List everything exportable for the export-style picker.
 */
export function listExportableContents(instanceId: string): EgpackExportEntry[] {
  const instance = getInstance(instanceId)
  if (!instance) throw new Error('Instance not found')

  const gameDir = getInstanceDir(instanceId)
  const modsDir = getInstanceModsDir(instanceId)
  const entries: EgpackExportEntry[] = []
  const modMeta = new Map(
    instance.mods.map((m) => [m.fileName.toLowerCase(), m] as const),
  )

  if (fs.existsSync(modsDir)) {
    for (const name of fs.readdirSync(modsDir)) {
      const lower = name.toLowerCase()
      if (!lower.endsWith('.jar') && !lower.endsWith('.jar.disabled')) continue
      const full = path.join(modsDir, name)
      if (!fs.statSync(full).isFile()) continue
      const disabled = lower.endsWith('.disabled')
      const baseName = disabled ? name.replace(/\.disabled$/i, '') : name
      const meta = modMeta.get(baseName.toLowerCase())
      let size = 0
      try {
        size = fs.statSync(full).size
      } catch {
        size = 0
      }
      entries.push({
        path: `mods/${name}`.replace(/\\/g, '/'),
        name,
        kind: 'mod',
        group: 'mods',
        sizeBytes: size,
        recommended: !disabled,
        disabled,
        title: meta?.title || baseName.replace(/\.jar$/i, ''),
      })
    }
  }

  for (const folder of CONTENT_FOLDERS) {
    const full = path.join(gameDir, folder.dir)
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue
    const { size, count } = dirSizeAndCount(full)
    if (count === 0 && size === 0) continue
    entries.push({
      path: folder.dir,
      name: folder.label || folder.dir,
      kind: 'folder',
      group: folder.group,
      sizeBytes: size,
      itemCount: count,
      recommended: folder.recommended,
    })
  }

  for (const optFile of OPTION_FILES) {
    const full = path.join(gameDir, optFile)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue
    let size = 0
    try {
      size = fs.statSync(full).size
    } catch {
      size = 0
    }
    entries.push({
      path: optFile,
      name: optFile,
      kind: 'file',
      group: 'settings',
      sizeBytes: size,
      recommended: false,
    })
  }

  // Sort: mods A-Z, then content, worlds, settings
  const groupOrder = { mods: 0, content: 1, worlds: 2, settings: 3 }
  entries.sort((a, b) => {
    const g = groupOrder[a.group] - groupOrder[b.group]
    if (g !== 0) return g
    return (a.title || a.name).localeCompare(b.title || b.name, undefined, {
      sensitivity: 'base',
    })
  })

  return entries
}

export function defaultEgpackExportOptions(
  instanceName: string,
  entries?: EgpackExportEntry[],
): EgpackExportOptions {
  const selectedPaths = (entries || [])
    .filter((e) => e.recommended)
    .map((e) => e.path)
  return {
    packName: instanceName || 'My Pack',
    summary: '',
    preferCdnDownloads: true,
    selectedPaths,
  }
}

function normalizeExportOptions(
  instanceName: string,
  partial?: Partial<EgpackExportOptions> | null,
  entries?: EgpackExportEntry[],
): EgpackExportOptions {
  const base = defaultEgpackExportOptions(instanceName, entries)
  if (!partial) return base
  const paths = Array.isArray(partial.selectedPaths)
    ? partial.selectedPaths.map((p) => String(p).replace(/\\/g, '/'))
    : base.selectedPaths
  return {
    packName: (partial.packName ?? base.packName).trim() || base.packName,
    summary: partial.summary ?? base.summary,
    preferCdnDownloads: partial.preferCdnDownloads ?? base.preferCdnDownloads,
    selectedPaths: paths,
  }
}

export type EgManifest = {
  format: 'egpack'
  formatVersion: 1
  name: string
  summary?: string
  gameVersion: string
  loader: LoaderType
  loaderVersion?: string
  exportedAt: string
  exporter: string
  exporterVersion: string
  mods: InstalledMod[]
}

type MrpackFile = {
  path: string
  hashes: { sha1: string; sha512: string }
  env?: { client?: string; server?: string }
  downloads: string[]
  fileSize: number
}

type MrpackIndex = {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: MrpackFile[]
  dependencies: Record<string, string>
}

function emit(
  onProgress: ((e: ProgressEvent) => void) | undefined,
  stage: string,
  progress: number,
  message: string,
) {
  onProgress?.({ stage, progress, message })
}

function safeName(name: string): string {
  return (
    (name || 'pack')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'pack'
  )
}

function tempDir(prefix: string): string {
  const dir = path.join(getDataRoot(), 'pack-work', `${prefix}-${Date.now().toString(36)}`)
  ensureDir(dir)
  return dir
}

function rmrf(p: string) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function copyDirRecursive(src: string, dest: string, allowSaves = false) {
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const lower = entry.name.toLowerCase()
    if (!allowSaves && lower === 'saves') continue
    if (SKIP_DIR_NAMES.has(lower)) continue
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d, allowSaves)
    else {
      ensureDir(path.dirname(d))
      fs.copyFileSync(s, d)
    }
  }
}

function copyDirRecursiveAllowSaves(src: string, dest: string) {
  copyDirRecursive(src, dest, true)
}

function hashFile(filePath: string): { sha1: string; sha512: string; size: number } {
  const data = fs.readFileSync(filePath)
  return {
    sha1: crypto.createHash('sha1').update(data).digest('hex'),
    sha512: crypto.createHash('sha512').update(data).digest('hex'),
    size: data.length,
  }
}

function isCatalogTracked(mod: InstalledMod): boolean {
  const id = mod.projectId || ''
  const ver = mod.versionId || ''
  if (!id || !ver) return false
  if (id.startsWith('local-') || ver.startsWith('local-') || ver.startsWith('import-')) return false
  return true
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  ensureDir(destDir)
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const ps = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        if (Test-Path -LiteralPath '${destDir.replace(/'/g, "''")}') {
          Remove-Item -LiteralPath '${destDir.replace(/'/g, "''")}' -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path '${destDir.replace(/'/g, "''")}' | Out-Null
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
        else reject(new Error(`Extract failed: ${err.slice(-400) || `code ${code}`}`))
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

async function createZipFromDirectory(sourceDir: string, zipPath: string): Promise<void> {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
  ensureDir(path.dirname(zipPath))

  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const ps = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        if (Test-Path -LiteralPath '${zipPath.replace(/'/g, "''")}') {
          Remove-Item -LiteralPath '${zipPath.replace(/'/g, "''")}' -Force
        }
        [System.IO.Compression.ZipFile]::CreateFromDirectory(
          '${sourceDir.replace(/'/g, "''")}',
          '${zipPath.replace(/'/g, "''")}',
          [System.IO.Compression.CompressionLevel]::Optimal,
          $false
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
        else reject(new Error(`Zip failed: ${err.slice(-400) || `code ${code}`}`))
      })
    })
  } else {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('zip', ['-r', '-q', zipPath, '.'], {
        cwd: sourceDir,
        stdio: 'ignore',
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('zip failed'))
      })
    })
  }
}

function buildDependencies(instance: GameInstance): Record<string, string> {
  const deps: Record<string, string> = { minecraft: instance.gameVersion }
  if (instance.loader === 'fabric' && instance.loaderVersion) {
    deps['fabric-loader'] = instance.loaderVersion
  } else if (instance.loader === 'forge' && instance.loaderVersion) {
    const lv = instance.loaderVersion.includes('-')
      ? instance.loaderVersion.split('-').slice(1).join('-') || instance.loaderVersion
      : instance.loaderVersion
    deps.forge = lv
  } else if (instance.loader === 'neoforge' && instance.loaderVersion) {
    deps.neoforge = instance.loaderVersion
  }
  return deps
}

function loaderFromDependencies(deps: Record<string, string>): {
  loader: LoaderType
  loaderVersion?: string
  gameVersion: string
} {
  const gameVersion = deps.minecraft || '1.21.1'
  if (deps['fabric-loader'] || deps.fabric) {
    return {
      loader: 'fabric',
      loaderVersion: deps['fabric-loader'] || deps.fabric,
      gameVersion,
    }
  }
  if (deps.neoforge) {
    return { loader: 'neoforge', loaderVersion: deps.neoforge, gameVersion }
  }
  if (deps.forge) {
    let lv = deps.forge
    if (!lv.includes(gameVersion)) lv = `${gameVersion}-${lv}`
    return { loader: 'forge', loaderVersion: lv, gameVersion }
  }
  if (deps.quilt) {
    throw new Error('Quilt packs are not supported yet')
  }
  return { loader: 'vanilla', gameVersion }
}

/**
 * Export instance as .egpack — same structure as a mod catalog .mrpack.
 * `selectedPaths` controls exactly what is packed (export-style list).
 */
export async function exportInstanceAsEgpack(
  instanceId: string,
  destPath: string,
  onProgress?: (e: ProgressEvent) => void,
  exportOptions?: Partial<EgpackExportOptions> | null,
): Promise<{ path: string; size: number }> {
  const instance = getInstance(instanceId)
  if (!instance) throw new Error('Instance not found')

  const catalog = listExportableContents(instanceId)
  const opts = normalizeExportOptions(instance.name, exportOptions, catalog)
  const selected = new Set(opts.selectedPaths.map((p) => p.replace(/\\/g, '/')))
  if (selected.size === 0) {
    throw new Error('Select at least one item to export')
  }

  const packName = safeName(opts.packName) || instance.name

  let out = path.resolve(destPath)
  if (!out.toLowerCase().endsWith(EGPACK_EXT)) {
    out = `${out}${EGPACK_EXT}`
  }

  emit(onProgress, 'prepare', 0.04, 'Preparing pack (mrpack-compatible)…')
  const staging = tempDir('export')
  const overrides = path.join(staging, 'overrides')
  ensureDir(overrides)
  const gameDir = getInstanceDir(instanceId)
  const files: MrpackFile[] = []
  const indexedModFiles = new Set<string>()

  const selectedModPaths = catalog
    .filter((e) => e.kind === 'mod' && selected.has(e.path))
    .map((e) => e.path)

  try {
    // 1) Mods — CDN for tracked enabled jars when preferred
    if (selectedModPaths.length) {
      const useCdn = opts.preferCdnDownloads
      const selectedBaseNames = new Set(
        selectedModPaths.map((p) => path.basename(p).replace(/\.disabled$/i, '').toLowerCase()),
      )

      const tracked = useCdn
        ? instance.mods.filter(
            (m) =>
              m.enabled !== false &&
              isCatalogTracked(m) &&
              selectedBaseNames.has(m.fileName.toLowerCase()),
          )
        : []

      let resolved = 0
      for (const mod of tracked) {
        emit(
          onProgress,
          'resolve',
          0.05 + (resolved / Math.max(tracked.length, 1)) * 0.35,
          `Resolving ${mod.title || mod.fileName}…`,
        )
        try {
          const version = await getVersion(mod.versionId)
          const primary = pickPrimaryFile(version)
          if (!primary?.url) throw new Error('No download URL')
          const relPath = `mods/${primary.filename || mod.fileName}`.replace(/\\/g, '/')
          files.push({
            path: relPath,
            hashes: {
              sha1: primary.hashes?.sha1 || '',
              sha512: primary.hashes?.sha512 || '',
            },
            env: { client: 'required', server: 'unsupported' },
            downloads: [primary.url],
            fileSize: primary.size || 0,
          })
          indexedModFiles.add((primary.filename || mod.fileName).toLowerCase())
          indexedModFiles.add(mod.fileName.toLowerCase())
        } catch {
          // Embed below
        }
        resolved++
      }

      emit(onProgress, 'overrides', 0.42, 'Packing selected mods…')
      const overridesMods = path.join(overrides, 'mods')
      ensureDir(overridesMods)
      for (const rel of selectedModPaths) {
        const name = path.basename(rel)
        const baseJar = name.replace(/\.disabled$/i, '')
        const isDisabled = name.toLowerCase().endsWith('.disabled')
        if (!isDisabled && indexedModFiles.has(baseJar.toLowerCase())) continue
        const src = path.join(gameDir, rel.replace(/\//g, path.sep))
        if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue
        fs.copyFileSync(src, path.join(overridesMods, name))
      }
      if (fs.existsSync(overridesMods) && fs.readdirSync(overridesMods).length === 0) {
        fs.rmSync(overridesMods, { recursive: true, force: true })
      }
    } else {
      emit(onProgress, 'mods', 0.4, 'No mods selected…')
    }

    // 2) Selected folders / settings files
    emit(onProgress, 'overrides', 0.55, 'Packing selected content…')
    for (const entry of catalog) {
      if (entry.kind === 'mod' || !selected.has(entry.path)) continue
      const src = path.join(gameDir, entry.path.replace(/\//g, path.sep))
      if (!fs.existsSync(src)) continue
      if (entry.kind === 'folder') {
        if (entry.path === 'saves') {
          copyDirRecursiveAllowSaves(src, path.join(overrides, entry.path))
        } else {
          copyDirRecursive(src, path.join(overrides, entry.path))
        }
      } else if (entry.kind === 'file') {
        fs.copyFileSync(src, path.join(overrides, path.basename(entry.path)))
      }
    }

    const summary =
      (opts.summary || '').trim() ||
      `EG Launcher pack · ${instance.loader} ${instance.gameVersion}`
    const index: MrpackIndex = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: `eg-${Date.now().toString(36)}`,
      name: packName,
      summary,
      files,
      dependencies: buildDependencies(instance),
    }

    const selectedModBasenames = new Set(
      selectedModPaths.map((p) => path.basename(p).replace(/\.disabled$/i, '').toLowerCase()),
    )
    const exportedMods = instance.mods.filter((m) =>
      selectedModBasenames.has(m.fileName.toLowerCase()),
    )

    // Optional EG metadata (import does not require this — works like pure mrpack)
    const manifest: EgManifest = {
      format: 'egpack',
      formatVersion: 1,
      name: packName,
      summary,
      gameVersion: instance.gameVersion,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion,
      exportedAt: new Date().toISOString(),
      exporter: 'EG Launcher',
      exporterVersion: APP_VERSION,
      mods: exportedMods,
    }

    fs.writeFileSync(
      path.join(staging, PACK_INDEX_FILENAME),
      JSON.stringify(index, null, 2),
      'utf8',
    )
    fs.writeFileSync(path.join(staging, 'eg.manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

    // Ensure overrides exists even if empty (some tools expect the folder)
    if (!fs.existsSync(overrides)) ensureDir(overrides)

    emit(onProgress, 'zip', 0.85, 'Creating .egpack archive…')
    await createZipFromDirectory(staging, out)

    const size = fs.statSync(out).size
    emit(onProgress, 'done', 1, `Exported ${path.basename(out)}`)
    return { path: out, size }
  } finally {
    rmrf(staging)
  }
}

function readJsonSafe<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Scan instance mods/ folder into InstalledMod records (UI + launch metadata). */
export function scanModsFromDisk(
  instanceId: string,
  metaMods: InstalledMod[] | undefined,
): InstalledMod[] {
  const modsDir = getInstanceModsDir(instanceId)
  if (!fs.existsSync(modsDir)) return metaMods || []

  const byFile = new Map((metaMods || []).map((m) => [m.fileName.toLowerCase(), m]))
  const result: InstalledMod[] = []
  const seen = new Set<string>()

  for (const name of fs.readdirSync(modsDir)) {
    const lower = name.toLowerCase()
    if (!lower.endsWith('.jar') && !lower.endsWith('.jar.disabled')) continue
    const enabled = !lower.endsWith('.disabled')
    const fileName = enabled ? name : name.replace(/\.disabled$/i, '')
    const key = fileName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const known = byFile.get(key)
    if (known) {
      result.push({ ...known, fileName, enabled })
      continue
    }

    const slug = fileName
      .replace(/\.jar$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
    result.push({
      projectId: `local-${slug}`,
      versionId: `import-${crypto.randomBytes(4).toString('hex')}`,
      slug,
      title: fileName.replace(/\.jar$/i, ''),
      iconUrl: null,
      fileName,
      versionNumber: 'imported',
      loaders: [],
      gameVersions: [],
      enabled,
      downloadedAt: new Date().toISOString(),
    })
  }

  for (const m of metaMods || []) {
    if (!seen.has(m.fileName.toLowerCase())) result.push(m)
  }

  return result
}

/**
 * Import .egpack or .mrpack — identical mod pack install path.
 * Requires pack index JSON (standard .mrpack layout).
 */
export async function importPackFile(
  filePath: string,
  options?: { name?: string; installRuntime?: boolean },
  onProgress?: (e: ProgressEvent) => void,
): Promise<{ instance: GameInstance; format: 'egpack' | 'mrpack' }> {
  const src = path.resolve(filePath)
  if (!fs.existsSync(src)) throw new Error('Pack file not found')

  const ext = path.extname(src).toLowerCase()
  if (!PACK_EXTS.includes(ext as (typeof PACK_EXTS)[number])) {
    throw new Error(`Unsupported pack type “${ext || 'unknown'}”. Use .egpack or .mrpack.`)
  }

  const format: 'egpack' | 'mrpack' = ext === EGPACK_EXT ? 'egpack' : 'mrpack'

  emit(onProgress, 'extract', 0.05, `Extracting ${path.basename(src)}…`)
  const extractDir = tempDir('import')

  try {
    await extractZip(src, extractDir)

    const indexPath = path.join(extractDir, PACK_INDEX_FILENAME)
    if (!fs.existsSync(indexPath)) {
      throw new Error(
        'Invalid pack — missing pack index file',
      )
    }

    const index = readJsonSafe<MrpackIndex>(indexPath)
    if (!index || !index.dependencies) {
      throw new Error('Invalid pack index file')
    }

    const manifestPath = path.join(extractDir, 'eg.manifest.json')
    const manifest = fs.existsSync(manifestPath)
      ? readJsonSafe<EgManifest>(manifestPath)
      : null

    const name =
      options?.name?.trim() ||
      manifest?.name ||
      index.name ||
      path.basename(src, ext)

    const parsed = loaderFromDependencies(index.dependencies || {})
    const gameVersion = manifest?.gameVersion || parsed.gameVersion
    const loader = manifest?.loader || parsed.loader
    const loaderVersion = manifest?.loaderVersion || parsed.loaderVersion
    const metaMods = manifest?.mods

    if (!gameVersion) throw new Error('Pack does not specify a Minecraft version')

    emit(onProgress, 'instance', 0.15, 'Creating instance…')
    let instance = createInstance({
      name: safeName(name),
      gameVersion,
      loader,
      loaderVersion,
    })

    const gameDir = getInstanceDir(instance.id)

    // Same as mrpack: download index files, then apply overrides
    const clientFiles = (index.files || []).filter((f) => f.env?.client !== 'unsupported')
    if (clientFiles.length) {
      emit(onProgress, 'files', 0.22, `Downloading ${clientFiles.length} pack files…`)
      let done = 0
      const concurrency = 6
      let cursor = 0

      async function worker() {
        while (cursor < clientFiles.length) {
          const i = cursor++
          const entry = clientFiles[i]!
          const dest = path.join(gameDir, entry.path.replace(/\//g, path.sep))
          const url = entry.downloads?.[0]
          if (!url) {
            // No CDN URL — file may live only under overrides/
            done++
            continue
          }
          try {
            await downloadFile(url, dest)
            // Optional integrity check when hashes present
            if (entry.hashes?.sha1 && fs.existsSync(dest)) {
              const got = hashFile(dest).sha1
              if (got !== entry.hashes.sha1) {
                throw new Error(`SHA-1 mismatch for ${entry.path}`)
              }
            }
          } catch (err) {
            throw new Error(`Failed ${entry.path}: ${(err as Error).message}`)
          }
          done++
          if (done % 5 === 0 || done === clientFiles.length) {
            emit(
              onProgress,
              'files',
              0.22 + (done / Math.max(clientFiles.length, 1)) * 0.4,
              `Pack files ${done}/${clientFiles.length}`,
            )
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()))
    }

    const overridesDir = path.join(extractDir, 'overrides')
    if (fs.existsSync(overridesDir)) {
      emit(onProgress, 'overrides', 0.68, 'Applying overrides…')
      copyDirRecursive(overridesDir, gameDir)
    }
    const clientOverrides = path.join(extractDir, 'client-overrides')
    if (fs.existsSync(clientOverrides)) {
      copyDirRecursive(clientOverrides, gameDir)
    }

    let mods = scanModsFromDisk(instance.id, metaMods).map((m) => ({
      ...m,
      loaders: m.loaders?.length ? m.loaders : [loader],
      gameVersions: m.gameVersions?.length ? m.gameVersions : [gameVersion],
    }))
    try {
      emit(onProgress, 'mods', 0.74, 'Fetching mod names & icons…')
      mods = await enrichModsWithProjectMeta(mods)
    } catch {
      // keep filename titles if mod catalog is unreachable
    }
    instance = updateInstance(instance.id, { mods })

    if (options?.installRuntime !== false) {
      emit(onProgress, 'runtime', 0.78, `Installing ${loader} ${gameVersion}…`)
      const refreshed = getInstance(instance.id) || instance
      await installInstanceRuntime(refreshed, (p) => {
        emit(onProgress, 'runtime', 0.78 + p.progress * 0.2, p.message)
      })
      instance = getInstance(instance.id) || instance
    }

    emit(onProgress, 'done', 1, `Imported ${instance.name}`)
    return { instance, format }
  } finally {
    rmrf(extractDir)
  }
}

export function defaultExportFileName(instanceName: string): string {
  return `${safeName(instanceName).replace(/\s+/g, '-')}${EGPACK_EXT}`
}

export function isPackFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith(EGPACK_EXT) || lower.endsWith(MRPACK_EXT)
}

export function suggestedDownloadsDir(): string {
  try {
    return path.join(os.homedir(), 'Downloads')
  } catch {
    return os.homedir()
  }
}
