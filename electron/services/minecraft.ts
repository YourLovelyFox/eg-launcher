import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import https from 'https'
import path from 'path'
import { createWriteStream } from 'fs'
import type {
  GameInstance,
  LaunchResult,
  LoaderType,
  LoaderVersionInfo,
  MinecraftAccount,
  MinecraftVersionInfo,
  ProgressEvent,
  RunningGameInfo,
} from '../../shared/types'
import {
  ensureDir,
  getAssetsDir,
  getInstanceDir,
  getLibrariesDir,
  getNativesDir,
  getVersionsDir,
} from '../paths'
import {
  filterJvmArgsForJava,
  findJava,
  parseJavaMajor,
  resolveJavaForGame,
} from './java'
import { loadSettings } from './settings'

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const FABRIC_META = 'https://meta.fabricmc.net/v2'
const FORGE_MAVEN = 'https://maven.minecraftforge.net'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'
const USER_AGENT = 'EGLauncher/1.0.0'

type MojangManifest = {
  latest: { release: string; snapshot: string }
  versions: MinecraftVersionInfo[]
}

type VersionJson = {
  id: string
  mainClass: string
  arguments?: {
    game?: Array<string | { rules?: Rule[]; value: string | string[] }>
    jvm?: Array<string | { rules?: Rule[]; value: string | string[] }>
  }
  minecraftArguments?: string
  assets: string
  assetIndex?: { id: string; url: string; sha1: string; size: number; totalSize: number }
  downloads?: {
    client: { url: string; sha1: string; size: number }
  }
  libraries: LibraryEntry[]
  javaVersion?: { component?: string; majorVersion: number }
  inheritsFrom?: string
}

function requiredJavaMajor(versionJson: VersionJson, gameVersion: string): number {
  if (versionJson.javaVersion?.majorVersion) {
    return versionJson.javaVersion.majorVersion
  }
  // Heuristics when metadata is missing
  const id = gameVersion || versionJson.id || ''
  // New year-based versions: 25.x / 26.x → Java 25
  if (/^\d{2}\.\d+/.test(id) && !id.startsWith('1.')) {
    const year = Number(id.split('.')[0])
    if (year >= 25) return 25
  }
  // Classic 1.x versions
  const m = id.match(/^1\.(\d+)/)
  if (m) {
    const minor = Number(m[1])
    if (minor >= 20) return 21 // 1.20.5+ ideally 21; safe default
    if (minor >= 17) return 17
  }
  return 17
}

type Rule = {
  action: string
  os?: { name?: string; arch?: string }
  features?: Record<string, boolean>
}

type LibraryEntry = {
  name: string
  downloads?: {
    artifact?: { path: string; url: string; sha1: string; size: number }
    classifiers?: Record<string, { path: string; url: string; sha1: string; size: number }>
  }
  url?: string
  natives?: Record<string, string>
  rules?: Rule[]
}

let runningGame: ChildProcess | null = null
let runningPid: number | null = null
let runningInstanceId: string | null = null
let runningInstanceName: string | null = null
let runningStartedAt: string | null = null

function clearRunningState() {
  runningGame = null
  runningPid = null
  runningInstanceId = null
  runningInstanceName = null
  runningStartedAt = null
}

function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGetJson<T>(res.headers.location).then(resolve).catch(reject)
        return
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`))
        res.resume()
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
  })
}

function downloadToFile(
  url: string,
  dest: string,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest))
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      onProgress?.(1)
      resolve()
      return
    }

    const temp = `${dest}.part`
    const doRequest = (requestUrl: string, redirectsLeft = 8) => {
      https
        .get(requestUrl, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirectsLeft > 0
          ) {
            const next = new URL(res.headers.location, requestUrl).toString()
            doRequest(next, redirectsLeft - 1)
            return
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Download failed ${res.statusCode}: ${requestUrl}`))
            res.resume()
            return
          }

          const total = Number(res.headers['content-length'] || 0)
          let downloaded = 0
          const file = createWriteStream(temp)

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            if (total > 0) onProgress?.(downloaded / total)
          })

          res.pipe(file)
          file.on('finish', () => {
            file.close(() => {
              try {
                fs.renameSync(temp, dest)
              } catch {
                fs.copyFileSync(temp, dest)
                try {
                  fs.unlinkSync(temp)
                } catch {
                  // ignore
                }
              }
              onProgress?.(1)
              resolve()
            })
          })
          file.on('error', (err) => {
            try {
              fs.unlinkSync(temp)
            } catch {
              // ignore
            }
            reject(err)
          })
        })
        .on('error', reject)
    }

    doRequest(url)
  })
}

function currentOsName(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

function currentArch(): string {
  // Mojang uses x86 for 32-bit, and sometimes arm
  if (process.arch === 'ia32') return 'x86'
  if (process.arch === 'arm64') return 'arm64'
  return 'x86_64'
}

/** Evaluate Mojang-style rules (libraries + args). */
function rulesAllow(rules?: Rule[]): boolean {
  if (!rules || rules.length === 0) return true

  // Default is disallow when rules exist until an allow matches (Mojang model varies;
  // practical approach: start false, apply each matching rule in order)
  let allowed = false

  const features: Record<string, boolean> = {
    is_demo_user: false,
    has_custom_resolution: false,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  }

  for (const rule of rules) {
    let matches = true

    if (rule.os) {
      if (rule.os.name && rule.os.name !== currentOsName()) matches = false
      if (rule.os.arch && rule.os.arch !== currentArch() && rule.os.arch !== process.arch) {
        matches = false
      }
    }

    if (rule.features) {
      for (const [key, value] of Object.entries(rule.features)) {
        if (features[key] !== value) {
          matches = false
          break
        }
      }
    }

    if (matches) {
      allowed = rule.action === 'allow'
    }
  }

  return allowed
}

function libraryAllowed(lib: LibraryEntry): boolean {
  return rulesAllow(lib.rules)
}

function mavenToPath(name: string): string {
  const parts = name.split(':')
  const group = parts[0]
  const artifact = parts[1]
  const version = parts[2]
  const classifier = parts[3]
  const groupPath = group.replace(/\./g, '/')
  const fileName = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`
  return `${groupPath}/${artifact}/${version}/${fileName}`
}

/** Encode each path segment so versions like 0.17.3+mixin work over HTTP. */
function encodePathSegments(relPath: string): string {
  return relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function libraryUrl(lib: LibraryEntry): string | null {
  if (lib.downloads?.artifact?.url) {
    // Still encode + in full URLs if present unencoded
    return lib.downloads.artifact.url.replace(/\+/g, '%2B')
  }
  if (lib.downloads?.artifact?.path) {
    return `https://libraries.minecraft.net/${encodePathSegments(lib.downloads.artifact.path)}`
  }
  if (lib.name) {
    const p = mavenToPath(lib.name)
    const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/$/, '')
    return `${base}/${encodePathSegments(p)}`
  }
  return null
}

function libraryLocalPath(lib: LibraryEntry): string {
  if (lib.downloads?.artifact?.path) {
    return path.join(getLibrariesDir(), lib.downloads.artifact.path)
  }
  return path.join(getLibrariesDir(), mavenToPath(lib.name))
}

async function mergeVersionJson(versionId: string, url?: string): Promise<VersionJson> {
  const versionsDir = getVersionsDir()
  const versionDir = path.join(versionsDir, versionId)
  ensureDir(versionDir)
  const jsonPath = path.join(versionDir, `${versionId}.json`)

  let raw: VersionJson
  if (fs.existsSync(jsonPath)) {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as VersionJson
  } else {
    if (!url) throw new Error(`Missing version metadata for ${versionId}`)
    raw = await httpGetJson<VersionJson>(url)
    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2))
  }

  if (raw.inheritsFrom) {
    const parent = await resolveVanillaVersion(raw.inheritsFrom)
    return mergeVersions(parent, raw)
  }
  return raw
}

function mergeVersions(parent: VersionJson, child: VersionJson): VersionJson {
  return {
    ...parent,
    ...child,
    id: child.id || parent.id,
    libraries: [...(child.libraries || []), ...(parent.libraries || [])],
    arguments: {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    },
    mainClass: child.mainClass || parent.mainClass,
    downloads: child.downloads || parent.downloads,
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
  }
}

async function resolveVanillaVersion(gameVersion: string): Promise<VersionJson> {
  const manifest = await httpGetJson<MojangManifest>(MOJANG_MANIFEST)
  const entry = manifest.versions.find((v) => v.id === gameVersion)
  if (!entry) throw new Error(`Minecraft version ${gameVersion} not found`)
  return mergeVersionJson(gameVersion, entry.url)
}

export async function listMinecraftVersions(): Promise<{
  latest: { release: string; snapshot: string }
  versions: MinecraftVersionInfo[]
}> {
  const manifest = await httpGetJson<MojangManifest>(MOJANG_MANIFEST)
  return {
    latest: manifest.latest,
    versions: manifest.versions.filter((v) => v.type === 'release' || v.type === 'snapshot'),
  }
}

export async function listLoaderVersions(
  loader: LoaderType,
  gameVersion: string,
): Promise<LoaderVersionInfo[]> {
  if (loader === 'vanilla') {
    return [{ id: 'vanilla', loader, gameVersion, stable: true }]
  }

  if (loader === 'fabric') {
    const loaders = await httpGetJson<Array<{ loader: { version: string; stable: boolean } }>>(
      `${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}`,
    )
    return loaders.slice(0, 30).map((l) => ({
      id: l.loader.version,
      loader: 'fabric' as const,
      gameVersion,
      stable: l.loader.stable,
    }))
  }

  if (loader === 'forge') {
    try {
      const meta = await httpGetJson<{
        promos?: Record<string, string>
      }>(`${FORGE_MAVEN}/net/minecraftforge/forge/promotions_slim.json`)

      const recommended = meta.promos?.[`${gameVersion}-recommended`]
      const latest = meta.promos?.[`${gameVersion}-latest`]
      const versions: LoaderVersionInfo[] = []
      if (recommended) {
        versions.push({
          id: `${gameVersion}-${recommended}`,
          loader: 'forge',
          gameVersion,
          stable: true,
        })
      }
      if (latest && latest !== recommended) {
        versions.push({
          id: `${gameVersion}-${latest}`,
          loader: 'forge',
          gameVersion,
          stable: false,
        })
      }

      try {
        const xml = await httpGetText(
          `${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`,
        )
        const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
        const related = matches
          .filter((v) => v.startsWith(`${gameVersion}-`))
          .slice(-15)
          .reverse()
        for (const id of related) {
          if (!versions.some((v) => v.id === id)) {
            versions.push({ id, loader: 'forge', gameVersion, stable: false })
          }
        }
      } catch {
        // optional
      }

      return versions
    } catch {
      return []
    }
  }

  if (loader === 'neoforge') {
    try {
      const xml = await httpGetText(
        `${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`,
      )
      const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
      const mcParts = gameVersion.replace(/^1\./, '')
      const filtered = matches
        .filter((v) => {
          const major = gameVersion.split('.').slice(1).join('.')
          return v.startsWith(major) || v.includes(mcParts)
        })
        .slice(-20)
        .reverse()

      return filtered.map((id, i) => ({
        id,
        loader: 'neoforge' as const,
        gameVersion,
        stable: i === 0,
      }))
    } catch {
      return []
    }
  }

  return []
}

function httpGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpGetText(res.headers.location).then(resolve).catch(reject)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`))
          res.resume()
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      })
      .on('error', reject)
  })
}

async function ensureLibraries(
  versionJson: VersionJson,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ ok: string[]; failed: string[] }> {
  const libs = (versionJson.libraries || []).filter(libraryAllowed)
  const ok: string[] = []
  const failed: string[] = []
  let done = 0

  for (const lib of libs) {
    const dest = libraryLocalPath(lib)
    const url = libraryUrl(lib)
    const label = lib.name || dest

    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      ok.push(label)
      done++
      onProgress?.(done, libs.length, label)
      continue
    }

    if (!url) {
      failed.push(label)
      done++
      onProgress?.(done, libs.length, label)
      continue
    }

    try {
      await downloadToFile(url, dest)
      if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
        failed.push(label)
      } else {
        ok.push(label)
      }
    } catch (err) {
      // Optional platform natives may fail; required ones we report
      const isNative =
        /natives-(linux|osx|macos|windows|arm)/i.test(lib.name) || Boolean(lib.natives)
      if (isNative) {
        // skip wrong-platform natives quietly
      } else {
        failed.push(`${label} (${(err as Error).message})`)
      }
    }

    done++
    onProgress?.(done, libs.length, label)
  }

  return { ok, failed }
}

export async function installInstanceRuntime(
  instance: GameInstance,
  onProgress?: (event: ProgressEvent) => void,
): Promise<{ versionId: string }> {
  const emit = (stage: string, progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
  }

  emit('prepare', 0.02, 'Preparing installation…')

  let versionId = instance.gameVersion
  let versionJson: VersionJson

  if (instance.loader === 'vanilla') {
    emit('vanilla', 0.08, `Resolving Minecraft ${instance.gameVersion}…`)
    versionJson = await resolveVanillaVersion(instance.gameVersion)
    versionId = instance.gameVersion
  } else if (instance.loader === 'fabric') {
    const loaderVersion = instance.loaderVersion
    if (!loaderVersion) throw new Error('Fabric loader version is required')
    emit('fabric', 0.08, `Installing Fabric ${loaderVersion} for ${instance.gameVersion}…`)

    await resolveVanillaVersion(instance.gameVersion)

    versionId = `fabric-loader-${loaderVersion}-${instance.gameVersion}`
    const profileUrl = `${FABRIC_META}/versions/loader/${encodeURIComponent(instance.gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
    const profile = await httpGetJson<VersionJson>(profileUrl)

    const versionDir = path.join(getVersionsDir(), versionId)
    ensureDir(versionDir)
    fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(profile, null, 2))
    versionJson = await mergeVersionJson(versionId)
  } else if (instance.loader === 'forge' || instance.loader === 'neoforge') {
    const loaderVersion = instance.loaderVersion
    if (!loaderVersion) throw new Error(`${instance.loader} version is required`)

    emit(instance.loader, 0.08, `Installing ${instance.loader} ${loaderVersion}…`)
    await resolveVanillaVersion(instance.gameVersion)

    versionId = await installModLoaderViaInstaller(
      instance.loader,
      instance.gameVersion,
      loaderVersion,
      (p, msg) => emit(instance.loader, 0.1 + p * 0.35, msg),
    )
    versionJson = await mergeVersionJson(versionId)
  } else {
    throw new Error(`Unsupported loader: ${instance.loader}`)
  }

  // Client jar
  emit('client', 0.45, 'Downloading Minecraft client…')
  const clientId = versionJson.inheritsFrom || versionJson.id || instance.gameVersion
  let clientMeta = versionJson
  if (versionJson.inheritsFrom) {
    clientMeta = await resolveVanillaVersion(versionJson.inheritsFrom)
  }
  if (clientMeta.downloads?.client) {
    const clientJar = path.join(getVersionsDir(), clientId, `${clientId}.jar`)
    await downloadToFile(clientMeta.downloads.client.url, clientJar)
  }

  // Libraries (including Fabric maven)
  emit('libraries', 0.55, 'Downloading libraries…')
  const libResult = await ensureLibraries(versionJson, (done, total, name) => {
    emit('libraries', 0.55 + (done / Math.max(total, 1)) * 0.25, `Libraries ${done}/${total}: ${name}`)
  })
  if (libResult.failed.length > 0) {
    const critical = libResult.failed.filter((f) => !/natives-/i.test(f))
    if (critical.length > 0) {
      throw new Error(
        `Failed to download ${critical.length} libraries. First: ${critical[0]}. Click Install again.`,
      )
    }
  }

  emit('natives', 0.82, 'Extracting natives…')
  await extractNatives(versionJson, versionId)

  emit('assets', 0.88, 'Downloading assets…')
  await downloadAssets(versionJson, (p) => emit('assets', 0.88 + p * 0.1, 'Downloading assets…'))

  emit('done', 1, 'Installation complete')
  return { versionId }
}

async function installModLoaderViaInstaller(
  loader: 'forge' | 'neoforge',
  gameVersion: string,
  loaderVersion: string,
  onProgress: (p: number, msg: string) => void,
): Promise<string> {
  const settings = loadSettings()
  let javaPath = settings.javaPath
  if (!javaPath) {
    const found = await findJava()
    if (!found) throw new Error('Java not found. Install Java 17+ and set the path in Settings.')
    javaPath = found.path
  }
  // Prefer java.exe for installer console output
  if (process.platform === 'win32' && /javaw\.exe$/i.test(javaPath)) {
    const alt = javaPath.replace(/javaw\.exe$/i, 'java.exe')
    if (fs.existsSync(alt)) javaPath = alt
  }

  let installerUrl: string
  let versionId: string

  if (loader === 'forge') {
    const full = loaderVersion.includes(gameVersion) ? loaderVersion : `${gameVersion}-${loaderVersion}`
    installerUrl = `${FORGE_MAVEN}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
    versionId = `${gameVersion}-forge-${full.replace(`${gameVersion}-`, '')}`
  } else {
    versionId = `neoforge-${loaderVersion}`
    installerUrl = `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
  }

  const installerDir = path.join(getVersionsDir(), '_installers')
  ensureDir(installerDir)
  const installerPath = path.join(installerDir, path.basename(installerUrl))

  onProgress(0.1, 'Downloading installer…')
  await downloadToFile(installerUrl, installerPath)

  const gameDir = path.dirname(getVersionsDir())
  onProgress(0.4, 'Running installer (this may take a minute)…')

  await runJavaJar(javaPath, installerPath, ['--installClient', gameDir], gameDir)

  onProgress(1, 'Loader installed')

  const versionsDir = path.join(gameDir, 'versions')
  if (fs.existsSync(versionsDir)) {
    const dirs = fs.readdirSync(versionsDir)
    const match =
      dirs.find((d) => d.toLowerCase().includes(loader) && d.includes(gameVersion)) ||
      dirs.find((d) => d.toLowerCase().includes(loaderVersion)) ||
      dirs.find((d) => d.toLowerCase().includes(loader))
    if (match) {
      const src = path.join(versionsDir, match)
      const dest = path.join(getVersionsDir(), match)
      if (src !== dest) copyDirRecursive(src, dest)
      return match
    }
  }

  if (loader === 'forge') {
    const full = loaderVersion.includes(gameVersion) ? loaderVersion : `${gameVersion}-${loaderVersion}`
    return `${gameVersion}-forge-${full.replace(`${gameVersion}-`, '')}`
  }
  return `neoforge-${loaderVersion}`
}

function copyDirRecursive(src: string, dest: string) {
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}

function runJavaJar(
  javaPath: string,
  jarPath: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, ['-jar', jarPath, ...args], {
      cwd,
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
      else reject(new Error(`Installer failed (code ${code}): ${err.slice(-500)}`))
    })
  })
}

async function extractNatives(versionJson: VersionJson, versionId: string) {
  const nativesDir = getNativesDir(versionId)
  ensureDir(nativesDir)

  for (const lib of versionJson.libraries || []) {
    if (!libraryAllowed(lib) || !lib.natives) continue
    const classifier = lib.natives[currentOsName()]?.replace(
      '${arch}',
      process.arch === 'x64' ? '64' : '32',
    )
    if (!classifier) continue
    const artifact = lib.downloads?.classifiers?.[classifier]
    if (!artifact) continue
    const jarPath = path.join(getLibrariesDir(), artifact.path)
    if (!fs.existsSync(jarPath)) {
      try {
        await downloadToFile(artifact.url, jarPath)
      } catch {
        continue
      }
    }
    await extractZip(jarPath, nativesDir)
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const ps = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem;
        $zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}');
        foreach ($entry in $zip.Entries) {
          if ($entry.FullName -match 'META-INF') { continue }
          $target = Join-Path '${destDir.replace(/'/g, "''")}' $entry.FullName
          $dir = Split-Path $target -Parent
          if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
          if ($entry.FullName.EndsWith('/')) { continue }
          [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
        $zip.Dispose()
      `
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', ps], {
        windowsHide: true,
        stdio: 'ignore',
      })
      child.on('error', () => resolve())
      child.on('close', () => resolve())
    })
  } else {
    await new Promise<void>((resolve) => {
      const child = spawn('unzip', ['-o', zipPath, '-d', destDir, '-x', 'META-INF/*'], {
        stdio: 'ignore',
      })
      child.on('error', () => resolve())
      child.on('close', () => resolve())
    })
  }
}

async function downloadAssets(
  versionJson: VersionJson,
  onProgress?: (p: number) => void,
): Promise<void> {
  let assetIndex = versionJson.assetIndex
  if (!assetIndex && versionJson.inheritsFrom) {
    const parent = await resolveVanillaVersion(versionJson.inheritsFrom)
    assetIndex = parent.assetIndex
  }
  if (!assetIndex) return

  const indexesDir = path.join(getAssetsDir(), 'indexes')
  ensureDir(indexesDir)
  const indexPath = path.join(indexesDir, `${assetIndex.id}.json`)
  await downloadToFile(assetIndex.url, indexPath)

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as {
    objects: Record<string, { hash: string; size: number }>
  }

  const objects = Object.values(index.objects)
  const concurrency = 12
  let completed = 0
  let cursor = 0

  async function worker() {
    while (cursor < objects.length) {
      const i = cursor++
      const obj = objects[i]
      const hash = obj.hash
      const sub = hash.substring(0, 2)
      const dest = path.join(getAssetsDir(), 'objects', sub, hash)
      const url = `https://resources.download.minecraft.net/${sub}/${hash}`
      try {
        await downloadToFile(url, dest)
      } catch {
        try {
          await downloadToFile(url, dest)
        } catch {
          // skip
        }
      }
      completed++
      if (completed % 20 === 0 || completed === objects.length) {
        onProgress?.(completed / objects.length)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

function flattenArgs(
  args: Array<string | { rules?: Rule[]; value: string | string[] }> | undefined,
): string[] {
  if (!args) return []
  const out: string[] = []
  for (const arg of args) {
    if (typeof arg === 'string') {
      out.push(arg)
    } else if (arg && typeof arg === 'object') {
      if (!rulesAllow(arg.rules)) continue
      const value = arg.value
      if (Array.isArray(value)) out.push(...value)
      else if (typeof value === 'string') out.push(value)
    }
  }
  return out
}

function processAlive(): boolean {
  if (runningPid == null && !runningGame) return false

  const pid = runningPid ?? runningGame?.pid
  if (pid == null) {
    clearRunningState()
    return false
  }

  // exitCode set means process ended
  if (runningGame && runningGame.exitCode != null) {
    clearRunningState()
    return false
  }

  try {
    // signal 0 = existence check
    process.kill(pid, 0)
    return true
  } catch {
    clearRunningState()
    return false
  }
}

export function getRunningGameInfo(): RunningGameInfo {
  const alive = processAlive()
  if (!alive) {
    return {
      running: false,
      instanceId: null,
      instanceName: null,
      pid: null,
      startedAt: null,
    }
  }
  return {
    running: true,
    instanceId: runningInstanceId,
    instanceName: runningInstanceName,
    pid: runningPid,
    startedAt: runningStartedAt,
  }
}

function resolveVersionId(instance: GameInstance, override?: string): string {
  if (override) return override
  if (instance.loader === 'fabric' && instance.loaderVersion) {
    return `fabric-loader-${instance.loaderVersion}-${instance.gameVersion}`
  }
  if (instance.loader === 'forge' && instance.loaderVersion) {
    const full = instance.loaderVersion.includes(instance.gameVersion)
      ? instance.loaderVersion
      : `${instance.gameVersion}-${instance.loaderVersion}`
    return `${instance.gameVersion}-forge-${full.replace(`${instance.gameVersion}-`, '')}`
  }
  if (instance.loader === 'neoforge' && instance.loaderVersion) {
    return `neoforge-${instance.loaderVersion}`
  }
  return instance.gameVersion
}

function findInstalledVersionId(instance: GameInstance, preferred: string): string {
  const versionsDir = getVersionsDir()
  if (fs.existsSync(path.join(versionsDir, preferred, `${preferred}.json`))) {
    return preferred
  }
  if (!fs.existsSync(versionsDir)) return preferred

  const dirs = fs.readdirSync(versionsDir)
  const guess = dirs.find(
    (d) =>
      d.includes(instance.gameVersion) &&
      (instance.loader === 'vanilla' || d.toLowerCase().includes(instance.loader)),
  )
  return guess || preferred
}

export async function launchInstance(
  instance: GameInstance,
  account: MinecraftAccount | null,
  versionIdOverride?: string,
): Promise<LaunchResult> {
  if (!account?.accessToken || !account.username || !account.uuid) {
    return {
      success: false,
      message:
        'Microsoft login required. Sign in under Microsoft Login before playing — offline mode is disabled.',
    }
  }
  // Redacted token from renderer must never be used for launch
  if (account.accessToken === '***') {
    return {
      success: false,
      message: 'Invalid account session. Sign out and sign in again with Microsoft.',
    }
  }

  if (processAlive()) {
    const name = runningInstanceName || 'another instance'
    return {
      success: false,
      message: `Game is already running (${name}, PID ${runningPid}). Press Stop first.`,
    }
  }
  clearRunningState()

  const settings = loadSettings()

  let versionId = findInstalledVersionId(instance, resolveVersionId(instance, versionIdOverride))

  let versionJson: VersionJson
  try {
    versionJson = await mergeVersionJson(versionId)
  } catch (err) {
    return {
      success: false,
      message: `Version not installed. Open the instance and click Install / Repair first. (${(err as Error).message})`,
    }
  }

  const needMajor = requiredJavaMajor(versionJson, instance.gameVersion)
  let javaPath: string
  let javaMajor: number
  try {
    const resolved = await resolveJavaForGame(needMajor, settings.javaPath || undefined)
    javaPath = resolved.path
    javaMajor = resolved.major || parseJavaMajor(resolved.version)

    // Prefer java.exe over javaw so we can capture logs
    if (process.platform === 'win32' && /javaw\.exe$/i.test(javaPath)) {
      const alt = javaPath.replace(/javaw\.exe$/i, 'java.exe')
      if (fs.existsSync(alt)) javaPath = alt
    }

    if (javaMajor < needMajor) {
      return {
        success: false,
        message: `Minecraft ${instance.gameVersion} needs Java ${needMajor}+. Found Java ${javaMajor} at ${javaPath}. Install a newer JDK or use Install / Repair then try again (EG Launcher can download Mojang Java ${needMajor}).`,
      }
    }
  } catch (err) {
    return {
      success: false,
      message: `Java ${needMajor}+ is required for Minecraft ${instance.gameVersion}. ${(err as Error).message}`,
    }
  }

  // Make sure Fabric/Forge libs exist before launch (fixes silent install gaps)
  const libResult = await ensureLibraries(versionJson)
  const criticalMissing = libResult.failed.filter((f) => !/natives-/i.test(f))
  if (criticalMissing.length > 0) {
    return {
      success: false,
      message: `Missing libraries (${criticalMissing.length}). Click Install / Repair. First missing: ${criticalMissing[0]}`,
    }
  }

  await extractNatives(versionJson, versionId)

  const gameDir = getInstanceDir(instance.id)
  const nativesDir = getNativesDir(versionId)
  const assetsDir = getAssetsDir()
  ensureDir(path.join(gameDir, 'mods'))
  ensureDir(path.join(gameDir, 'logs'))

  const classpathEntries = buildClasspathEntries(versionJson, versionId)
  if (classpathEntries.length < 5) {
    return {
      success: false,
      message: `Classpath looks empty (${classpathEntries.length} jars). Click Install / Repair.`,
    }
  }

  const classpath = classpathEntries.join(path.delimiter)
  const mainClass = versionJson.mainClass
  if (!mainClass) {
    return { success: false, message: 'Version JSON has no mainClass' }
  }

  const username = account.username
  // Mojang profile IDs are undashed; keep as-is
  const uuid = account.uuid.replace(/-/g, '')
  const accessToken = account.accessToken

  const replacements: Record<string, string> = {
    '${auth_player_name}': username,
    '${version_name}': versionId,
    '${game_directory}': gameDir,
    '${assets_root}': assetsDir,
    '${assets_index_name}': versionJson.assetIndex?.id || versionJson.assets || 'legacy',
    '${auth_uuid}': uuid,
    '${auth_access_token}': accessToken,
    '${clientid}': CLIENT_ID_FOR_LAUNCH,
    '${auth_xuid}': '0',
    '${user_type}': 'msa',
    '${version_type}': 'release',
    '${natives_directory}': nativesDir,
    '${launcher_name}': 'EGLauncher',
    '${launcher_version}': '1.0.0',
    '${classpath}': classpath,
    '${library_directory}': getLibrariesDir(),
    '${classpath_separator}': path.delimiter,
  }

  const jvmArgs: string[] = [
    `-Xms${settings.ramMinMb}M`,
    `-Xmx${settings.ramMaxMb}M`,
  ]

  // Modern LWJGL / natives extraction dirs
  jvmArgs.push(`-Djava.library.path=${nativesDir}`)
  jvmArgs.push(`-Djna.tmpdir=${nativesDir}`)
  jvmArgs.push(`-Dorg.lwjgl.system.SharedLibraryExtractPath=${nativesDir}`)
  jvmArgs.push(`-Dio.netty.native.workdir=${nativesDir}`)
  jvmArgs.push(`-Dminecraft.launcher.brand=EGLauncher`)
  jvmArgs.push(`-Dminecraft.launcher.version=1.0.0`)

  const rawJvm = filterJvmArgsForJava(flattenArgs(versionJson.arguments?.jvm), javaMajor)
  let hasCp = false
  for (const arg of rawJvm) {
    const resolved = applyReplacements(arg, replacements)
    // Skip duplicates we already set
    if (
      resolved.startsWith('-Djava.library.path=') ||
      resolved.startsWith('-Djna.tmpdir=') ||
      resolved.startsWith('-Dorg.lwjgl.system.SharedLibraryExtractPath=') ||
      resolved.startsWith('-Dio.netty.native.workdir=') ||
      resolved.startsWith('-Dminecraft.launcher.brand=') ||
      resolved.startsWith('-Dminecraft.launcher.version=')
    ) {
      continue
    }
    if (resolved === '-cp' || resolved === '-classpath') {
      hasCp = true
      jvmArgs.push(resolved)
      continue
    }
    jvmArgs.push(resolved)
  }

  if (!hasCp && !rawJvm.some((a) => a.includes('${classpath}'))) {
    jvmArgs.push('-cp', classpath)
  }

  const gameArgs: string[] = []
  if (versionJson.arguments?.game) {
    for (const arg of flattenArgs(versionJson.arguments.game)) {
      gameArgs.push(applyReplacements(arg, replacements))
    }
  } else if (versionJson.minecraftArguments) {
    for (const arg of versionJson.minecraftArguments.split(' ')) {
      gameArgs.push(applyReplacements(arg, replacements))
    }
  } else {
    gameArgs.push(
      '--username',
      username,
      '--version',
      versionId,
      '--gameDir',
      gameDir,
      '--assetsDir',
      assetsDir,
      '--assetIndex',
      versionJson.assetIndex?.id || versionJson.assets || 'legacy',
      '--uuid',
      uuid,
      '--accessToken',
      accessToken,
      '--userType',
      'msa',
      '--versionType',
      'release',
    )
  }

  // Build full JVM arg list: jvm + main + game
  const fullArgs = [...jvmArgs, mainClass, ...gameArgs]

  // Windows CreateProcess command-line limit ~8191 chars — use @argfile
  const logPath = path.join(gameDir, 'logs', 'eg-launch.log')
  const argFile = path.join(gameDir, 'logs', 'jvm-args.txt')
  ensureDir(path.dirname(argFile))

  const useArgFile = process.platform === 'win32' || fullArgs.join(' ').length > 7000
  let spawnArgs: string[]
  if (useArgFile) {
    // Java argfiles: one argument per line; backslash-escape specials; paths with spaces in quotes
    const lines = fullArgs.map(toArgFileLine)
    fs.writeFileSync(argFile, lines.join('\n'), 'utf-8')
    spawnArgs = [`@${argFile}`]
  } else {
    spawnArgs = fullArgs
  }

  fs.writeFileSync(
    logPath,
    [
      `EG Launcher launch log — ${new Date().toISOString()}`,
      `java: ${javaPath}`,
      `javaMajor: ${javaMajor} (required ${needMajor})`,
      `versionId: ${versionId}`,
      `mainClass: ${mainClass}`,
      `gameDir: ${gameDir}`,
      `classpath jars: ${classpathEntries.length}`,
      `argfile: ${useArgFile ? argFile : '(inline)'}`,
      `cwd: ${gameDir}`,
      '',
      '--- stdout/stderr ---',
      '',
    ].join('\n'),
    'utf-8',
  )

  try {
    const child = spawn(javaPath, spawnArgs, {
      cwd: gameDir,
      detached: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Help some GPUs / Java on Windows
        APPDATA: process.env.APPDATA,
      },
    })

    runningGame = child
    runningPid = child.pid ?? null
    runningInstanceId = instance.id
    runningInstanceName = instance.name
    runningStartedAt = new Date().toISOString()

    const appendLog = (chunk: Buffer) => {
      try {
        fs.appendFileSync(logPath, chunk)
      } catch {
        // ignore
      }
    }
    child.stdout?.on('data', appendLog)
    child.stderr?.on('data', appendLog)

    child.on('error', (err) => {
      try {
        fs.appendFileSync(logPath, `\nSPAWN ERROR: ${err.message}\n`)
      } catch {
        // ignore
      }
      if (runningGame === child) clearRunningState()
    })

    child.on('close', (code, signal) => {
      try {
        fs.appendFileSync(logPath, `\nPROCESS EXIT code=${code} signal=${signal}\n`)
      } catch {
        // ignore
      }
      if (runningGame === child) clearRunningState()
    })

    // Wait briefly — if Java dies immediately, report the real error
    const early = await waitForEarlyExit(child, 4000)
    if (early.exited) {
      const logTail = readLogTail(logPath, 2500)
      clearRunningState()
      return {
        success: false,
        message: `Minecraft exited immediately (code ${early.code}).\n\n${logTail || 'No log output. Check Java version (need 21 for 1.21.x).'}\n\nFull log: ${logPath}`,
      }
    }

    // Don't keep the parent waiting; allow child to outlive IPC but keep handles for tracking
    child.unref()

    return {
      success: true,
      message: `Minecraft started (PID ${child.pid}). If no window appears, check ${logPath}`,
      pid: child.pid,
    }
  } catch (err) {
    clearRunningState()
    return { success: false, message: (err as Error).message }
  }
}

const CLIENT_ID_FOR_LAUNCH = 'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb'

function toArgFileLine(arg: string): string {
  // https://docs.oracle.com/en/java/javase/17/docs/specs/man/java.html#java-command-line-argument-files
  if (arg.length === 0) return '""'
  // Escape backslashes and quotes for argfile
  let escaped = arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  if (/[\s\t\n\r#]/.test(arg)) {
    escaped = `"${escaped}"`
  }
  return escaped
}

function waitForEarlyExit(
  child: ChildProcess,
  ms: number,
): Promise<{ exited: boolean; code: number | null }> {
  return new Promise((resolve) => {
    let done = false
    const finish = (exited: boolean, code: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.removeListener('close', onClose)
      resolve({ exited, code })
    }
    const onClose = (code: number | null) => finish(true, code)
    child.once('close', onClose)
    const timer = setTimeout(() => finish(false, null), ms)
  })
}

function readLogTail(logPath: string, maxChars: number): string {
  try {
    if (!fs.existsSync(logPath)) return ''
    const text = fs.readFileSync(logPath, 'utf-8')
    // Strip our header noise for the user message
    const marker = '--- stdout/stderr ---'
    const idx = text.indexOf(marker)
    const body = idx >= 0 ? text.slice(idx + marker.length).trim() : text
    if (body.length <= maxChars) return body
    return body.slice(-maxChars)
  } catch {
    return ''
  }
}

function applyReplacements(value: string, map: Record<string, string>): string {
  let out = value
  for (const [k, v] of Object.entries(map)) {
    out = out.split(k).join(v)
  }
  return out
}

function buildClasspathEntries(versionJson: VersionJson, versionId: string): string[] {
  const entries: string[] = []
  const seen = new Set<string>()

  for (const lib of versionJson.libraries || []) {
    if (!libraryAllowed(lib)) continue
    // Skip pure natives classifier jars that have no artifact (legacy)
    if (lib.natives && !lib.downloads?.artifact && !lib.name.includes(':natives-')) continue

    const p = libraryLocalPath(lib)
    if (fs.existsSync(p) && !seen.has(p)) {
      seen.add(p)
      entries.push(p)
    }
  }

  // Client jar (vanilla) — always required
  const vanillaId = versionJson.inheritsFrom || versionJson.id || versionId
  const clientJar = path.join(getVersionsDir(), vanillaId, `${vanillaId}.jar`)
  if (fs.existsSync(clientJar) && !seen.has(clientJar)) {
    entries.push(clientJar)
  }

  // Some loaders ship their own version jar
  const selfJar = path.join(getVersionsDir(), versionId, `${versionId}.jar`)
  if (fs.existsSync(selfJar) && selfJar !== clientJar && !seen.has(selfJar)) {
    entries.push(selfJar)
  }

  return entries
}

export function isGameRunning(): boolean {
  return processAlive()
}

export function forceClearRunningGame(): RunningGameInfo {
  const pid = runningPid
  if (pid) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
      } else {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          process.kill(pid, 'SIGTERM')
        }
      }
    } catch {
      // ignore
    }
  }
  clearRunningState()
  return getRunningGameInfo()
}
