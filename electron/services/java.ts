import { execFile, spawn } from 'child_process'
import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import { promisify } from 'util'
import { ensureDir, getDataRoot } from '../paths'

const execFileAsync = promisify(execFile)
const USER_AGENT = 'EGLauncher/1.0.0 (https://github.com/YourLovelyFox/eg-launcher)'
const JAVA_RUNTIME_INDEX =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

/**
 * Same source Modrinth App uses for "Install recommended" Java:
 * Azul Zulu metadata API → single JRE zip (not Mojang multi-file runtime).
 * @see https://github.com/modrinth/code packages/app-lib/src/api/jre.rs
 */
function azulOs(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

function azulArch(): string {
  if (process.arch === 'arm64') return 'aarch64'
  if (process.arch === 'ia32') return 'x86'
  return 'x64'
}

function javaBinName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

export type JavaInstall = {
  path: string
  version: string
  major: number
}

type RuntimeFileEntry =
  | { type: 'directory' }
  | {
      type: 'file'
      executable?: boolean
      downloads: {
        raw: { sha1: string; size: number; url: string }
        lzma?: { sha1: string; size: number; url: string }
      }
    }
  | {
      type: 'link'
      target: string
    }

function unique(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))]
}

function windowsJavaCandidates(): string[] {
  const candidates: string[] = []
  const programFiles = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean) as string[]

  const vendors = [
    'Java',
    'Eclipse Adoptium',
    'Microsoft',
    'Amazon Corretto',
    'Zulu',
    'BellSoft',
    'Semeru',
    'Oracle',
    'Common Files\\Oracle\\Java',
  ]

  for (const base of programFiles) {
    for (const vendor of vendors) {
      const root = path.join(base, vendor)
      if (!fs.existsSync(root)) continue
      try {
        for (const entry of fs.readdirSync(root)) {
          candidates.push(path.join(root, entry, 'bin', 'java.exe'))
          candidates.push(path.join(root, entry, 'bin', 'javaw.exe'))
          // Some installs are flat: Java\jdk-25\bin already covered; also jre paths
          candidates.push(path.join(root, entry, 'jre', 'bin', 'java.exe'))
        }
      } catch {
        // ignore
      }
    }
  }

  // Mojang / EG managed runtimes
  const managed = path.join(getDataRoot(), 'java')
  if (fs.existsSync(managed)) {
    try {
      for (const entry of fs.readdirSync(managed)) {
        candidates.push(path.join(managed, entry, 'bin', 'java.exe'))
        candidates.push(path.join(managed, entry, 'bin', 'javaw.exe'))
      }
    } catch {
      // ignore
    }
  }

  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'))
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe'))
  }

  candidates.push('java')
  candidates.push('javaw')
  return unique(candidates)
}

function unixJavaCandidates(): string[] {
  const candidates = [
    '/usr/bin/java',
    '/usr/lib/jvm/default-java/bin/java',
    '/usr/lib/jvm/java-25-openjdk/bin/java',
    '/usr/lib/jvm/java-21-openjdk/bin/java',
    '/usr/lib/jvm/java-17-openjdk/bin/java',
    '/opt/homebrew/opt/openjdk/bin/java',
  ]

  const managed = path.join(getDataRoot(), 'java')
  if (fs.existsSync(managed)) {
    try {
      for (const entry of fs.readdirSync(managed)) {
        candidates.push(path.join(managed, entry, 'bin', 'java'))
      }
    } catch {
      // ignore
    }
  }

  if (process.env.JAVA_HOME) {
    candidates.unshift(path.join(process.env.JAVA_HOME, 'bin', 'java'))
  }

  candidates.push('java')
  return unique(candidates)
}

export function parseJavaMajor(version: string): number {
  // "21.0.10", "1.8.0_51", "25.0.1"
  const cleaned = version.replace(/^"|"$/g, '')
  if (cleaned.startsWith('1.')) {
    const parts = cleaned.split('.')
    return Number(parts[1]) || 8
  }
  const major = Number(cleaned.split('.')[0])
  return Number.isFinite(major) ? major : 0
}

export async function getJavaVersion(javaPath: string): Promise<string | null> {
  try {
    const { stderr, stdout } = await execFileAsync(javaPath, ['-version'], {
      timeout: 8000,
      windowsHide: true,
    })
    const output = `${stderr}\n${stdout}`
    const match = output.match(/version\s+"([^"]+)"/i)
    return match?.[1] ?? output.split('\n')[0] ?? null
  } catch {
    return null
  }
}

export async function listJavaInstalls(): Promise<JavaInstall[]> {
  const candidates = process.platform === 'win32' ? windowsJavaCandidates() : unixJavaCandidates()
  const found: JavaInstall[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (candidate !== 'java' && candidate !== 'javaw' && !fs.existsSync(candidate)) continue
    const version = await getJavaVersion(candidate)
    if (!version) continue
    const major = parseJavaMajor(version)
    if (!major) continue
    const key = `${path.resolve(candidate)}|${major}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ path: candidate, version, major })
  }

  // Prefer higher majors first
  found.sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))
  return found
}

export async function findJava(): Promise<JavaInstall | null> {
  const all = await listJavaInstalls()
  return all[0] ?? null
}

export async function findJavaForMajor(minMajor: number): Promise<JavaInstall | null> {
  const all = await listJavaInstalls()
  // Prefer exact-or-higher, lowest sufficient major when possible for stability
  const ok = all.filter((j) => j.major >= minMajor)
  if (ok.length === 0) return null
  ok.sort((a, b) => a.major - b.major || b.path.localeCompare(a.path))
  // Prefer java.exe over javaw for logging
  const withJava = ok.find((j) => /java(\.exe)?$/i.test(j.path) && !/javaw/i.test(j.path))
  return withJava || ok[0]
}

function platformRuntimeKey(): string {
  if (process.platform === 'win32') {
    if (process.arch === 'arm64') return 'windows-arm64'
    return 'windows-x64'
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  }
  return process.arch === 'ia32' ? 'linux-i386' : 'linux'
}

function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
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
      .on('error', reject)
  })
}

function downloadFile(
  url: string,
  dest: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest))
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      resolve()
      return
    }
    const temp = `${dest}.part`
    const go = (requestUrl: string, left = 8) => {
      const lib = requestUrl.startsWith('https') ? https : http
      const req = lib.get(requestUrl, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
          res.resume()
          go(new URL(res.headers.location, requestUrl).toString(), left - 1)
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Download failed (${res.statusCode})`))
          res.resume()
          return
        }
        const total = Number(res.headers['content-length'] || 0)
        let downloaded = 0
        const file = fs.createWriteStream(temp)
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          onProgress?.(downloaded, total)
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
            resolve()
          })
        })
        file.on('error', reject)
      })
      req.on('error', reject)
      req.setTimeout(180_000, () => req.destroy(new Error('Download timed out')))
    }
    go(url)
  })
}

function isOptionalMojangJavaFile(rel: string): boolean {
  const n = rel.replace(/\\/g, '/').toLowerCase()
  // Policy / legal / man pages — Mojang CDN sometimes 403s these; JRE still runs without them
  return (
    n.includes('/conf/security/policy/') ||
    n.includes('/legal/') ||
    n.endsWith('.policy') ||
    n.endsWith('/readme') ||
    n.endsWith('.txt') && n.includes('license')
  )
}

async function extractZipArchive(zipPath: string, destDir: string): Promise<void> {
  ensureDir(destDir)
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const ps = [
        "$ErrorActionPreference = 'Stop'",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem",
        "$zipPath = $env:EG_ZIP_PATH",
        "$destDir = $env:EG_DEST_DIR",
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
      child.stderr?.on('data', (d) => {
        err += d.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Zip extract failed: ${err.trim().slice(-300) || code}`))
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

function findJavaBinaryUnder(root: string): string | null {
  const bin = javaBinName()
  const direct = path.join(root, 'bin', bin)
  if (fs.existsSync(direct)) return direct

  // Zip root is usually one folder: zulu21.x.x-ca-jre.../bin/java
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const p = path.join(root, entry.name, 'bin', bin)
      if (fs.existsSync(p)) return p
      // macOS: Contents/Home/bin/java
      const mac = path.join(root, entry.name, 'Contents', 'Home', 'bin', bin)
      if (fs.existsSync(mac)) return mac
    }
  } catch {
    // ignore
  }
  return null
}

type AzulPackage = {
  download_url: string
  name: string
  java_version?: number[]
}

/**
 * Download a portable Azul Zulu JRE — same approach as Modrinth App auto-install.
 * One zip, no Mojang multi-file CDN (avoids intermittent 403 on policy files).
 */
export async function ensureAzulZuluJava(
  major: number,
  onProgress?: (message: string, ratio: number) => void,
): Promise<JavaInstall> {
  const runtimeRoot = path.join(getDataRoot(), 'java', `zulu-${major}`)
  const existing = findJavaBinaryUnder(runtimeRoot)
  if (existing) {
    const version = (await getJavaVersion(existing)) || `zulu-${major}`
    const maj = parseJavaMajor(version) || major
    if (maj >= major) {
      return { path: existing, version, major: maj }
    }
  }

  const os = azulOs()
  const arch = azulArch()
  const metaUrl =
    `https://api.azul.com/metadata/v1/zulu/packages?` +
    `arch=${encodeURIComponent(arch)}` +
    `&java_version=${major}` +
    `&os=${encodeURIComponent(os)}` +
    `&archive_type=zip` +
    `&javafx_bundled=false` +
    `&java_package_type=jre` +
    `&latest=true` +
    `&page_size=1`

  onProgress?.(`Fetching Java ${major} package (Azul Zulu / Modrinth-style)…`, 0.02)
  const packages = await httpGetJson<AzulPackage[]>(metaUrl)
  const pkg = packages?.[0]
  if (!pkg?.download_url) {
    throw new Error(
      `No Azul Zulu JRE for Java ${major} (${os}/${arch}). Try another version or set Java in Settings.`,
    )
  }

  ensureDir(runtimeRoot)
  const zipName = (pkg.name || `zulu-${major}.zip`).replace(/[<>:"|?*]/g, '_')
  const zipPath = path.join(getDataRoot(), 'java', '_cache', zipName)
  ensureDir(path.dirname(zipPath))

  onProgress?.(`Downloading ${zipName}…`, 0.05)
  await downloadFile(pkg.download_url, zipPath, (downloaded, total) => {
    if (!total) return
    onProgress?.(
      `Downloading Java ${major}… ${Math.round((downloaded / total) * 100)}%`,
      0.05 + (downloaded / total) * 0.7,
    )
  })

  onProgress?.(`Extracting Java ${major}…`, 0.78)
  // Extract into a temp folder then move contents to runtimeRoot
  const extractTmp = path.join(getDataRoot(), 'java', `_extract-${major}-${Date.now()}`)
  try {
    await extractZipArchive(zipPath, extractTmp)
    // Wipe previous install
    if (fs.existsSync(runtimeRoot)) {
      fs.rmSync(runtimeRoot, { recursive: true, force: true })
    }
    ensureDir(runtimeRoot)
    // Move extracted root into runtimeRoot
    const kids = fs.readdirSync(extractTmp)
    if (kids.length === 1) {
      const only = path.join(extractTmp, kids[0])
      if (fs.statSync(only).isDirectory()) {
        fs.renameSync(only, path.join(runtimeRoot, kids[0]))
      } else {
        fs.renameSync(only, path.join(runtimeRoot, kids[0]))
      }
    } else {
      for (const k of kids) {
        fs.renameSync(path.join(extractTmp, k), path.join(runtimeRoot, k))
      }
    }
  } finally {
    try {
      fs.rmSync(extractTmp, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }

  const javaPath = findJavaBinaryUnder(runtimeRoot)
  if (!javaPath) {
    throw new Error(`Java ${major} extracted but ${javaBinName()} was not found under ${runtimeRoot}`)
  }

  // Make executable on Unix
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(javaPath, 0o755)
    } catch {
      // ignore
    }
  }

  const version = (await getJavaVersion(javaPath)) || `zulu-${major}`
  onProgress?.(`Java ${version} ready`, 1)
  return { path: javaPath, version, major: parseJavaMajor(version) || major }
}

export function componentForMajor(major: number): string {
  if (major >= 25) return 'java-runtime-epsilon'
  if (major >= 21) return 'java-runtime-delta'
  if (major >= 17) return 'java-runtime-gamma'
  if (major >= 16) return 'java-runtime-alpha'
  return 'jre-legacy'
}

/**
 * Download Mojang's official Java runtime for a component (e.g. java-runtime-epsilon = 25).
 */
export async function ensureMojangJavaRuntime(
  component: string,
  onProgress?: (message: string, ratio: number) => void,
): Promise<JavaInstall> {
  const runtimeRoot = path.join(getDataRoot(), 'java', component)
  const javaPath = path.join(
    runtimeRoot,
    'bin',
    process.platform === 'win32' ? 'java.exe' : 'java',
  )

  if (fs.existsSync(javaPath)) {
    const version = (await getJavaVersion(javaPath)) || component
    return { path: javaPath, version, major: parseJavaMajor(version) || 0 }
  }

  onProgress?.(`Downloading Java runtime (${component})…`, 0.02)
  const index = await httpGetJson<
    Record<string, Record<string, Array<{ manifest: { url: string }; version: { name: string } }>>>
  >(JAVA_RUNTIME_INDEX)

  const platform = platformRuntimeKey()
  const entries = index[platform]?.[component]
  if (!entries?.length) {
    throw new Error(
      `No Mojang Java runtime "${component}" for ${platform}. Install Java manually (see Settings).`,
    )
  }

  const meta = entries[0]
  const manifest = await httpGetJson<{ files: Record<string, RuntimeFileEntry> }>(meta.manifest.url)
  const files = Object.entries(manifest.files)
  const fileEntries = files.filter(([, info]) => info.type === 'file') as Array<
    [string, Extract<RuntimeFileEntry, { type: 'file' }>]
  >

  ensureDir(runtimeRoot)
  let done = 0
  const concurrency = 6
  let cursor = 0
  const softFails: string[] = []
  let hardFail: Error | null = null

  async function worker() {
    while (cursor < fileEntries.length) {
      if (hardFail) return
      const i = cursor++
      const [rel, info] = fileEntries[i]!
      const dest = path.join(runtimeRoot, rel.replace(/\//g, path.sep))
      try {
        await downloadFile(info.downloads.raw.url, dest)
        if (info.executable && process.platform !== 'win32') {
          try {
            fs.chmodSync(dest, 0o755)
          } catch {
            // ignore
          }
        }
      } catch (err) {
        const msg = (err as Error).message || String(err)
        if (isOptionalMojangJavaFile(rel) || /403|404/.test(msg)) {
          softFails.push(`${rel}: ${msg}`)
        } else {
          hardFail = new Error(`Failed downloading ${rel}: ${msg}`)
          return
        }
      }
      done++
      if (done % 10 === 0 || done === fileEntries.length) {
        onProgress?.(
          `Downloading Java ${meta.version?.name || component} (${done}/${fileEntries.length})…`,
          done / Math.max(fileEntries.length, 1),
        )
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  if (hardFail) throw hardFail

  // Create directories that were only listed as type directory (optional)
  for (const [rel, info] of files) {
    if (info.type === 'directory') {
      ensureDir(path.join(runtimeRoot, rel.replace(/\//g, path.sep)))
    }
  }

  if (!fs.existsSync(javaPath)) {
    throw new Error(
      `Java runtime incomplete (${javaPath} missing). Soft skips: ${softFails.slice(0, 3).join('; ')}`,
    )
  }

  // Accept install if java runs even if some policy files 403'd
  const version = await getJavaVersion(javaPath)
  if (!version) {
    throw new Error(`Java binary present but not runnable at ${javaPath}`)
  }
  onProgress?.(`Java ${version} ready`, 1)
  return { path: javaPath, version, major: parseJavaMajor(version) }
}

/**
 * Resolve a Java install that satisfies the required major version.
 * Auto-downloads when needed:
 *  1) Azul Zulu JRE (same method as Modrinth App)
 *  2) Mojang multi-file runtime (fallback)
 */
export async function resolveJavaForGame(
  requiredMajor: number,
  preferredPath?: string,
  onProgress?: (message: string, ratio: number) => void,
): Promise<JavaInstall> {
  // User override if it meets the requirement
  if (preferredPath) {
    const ver = await getJavaVersion(preferredPath)
    if (ver) {
      const major = parseJavaMajor(ver)
      if (major >= requiredMajor) {
        return { path: preferredPath, version: ver, major }
      }
    }
  }

  const local = await findJavaForMajor(requiredMajor)
  if (local) return local

  // Prefer exact major for auto-install (21 for 1.20.x packs, etc.)
  const targetMajor = requiredMajor >= 25 ? 25 : requiredMajor >= 21 ? 21 : requiredMajor >= 17 ? 17 : 8

  onProgress?.(
    `Minecraft needs Java ${requiredMajor}+. Downloading Azul Zulu JRE (Modrinth-style)…`,
    0,
  )
  try {
    return await ensureAzulZuluJava(targetMajor, onProgress)
  } catch (azulErr) {
    onProgress?.(
      `Azul download failed, trying Mojang runtime… (${(azulErr as Error).message})`,
      0.05,
    )
    try {
      const component = componentForMajor(requiredMajor)
      return await ensureMojangJavaRuntime(component, onProgress)
    } catch (mojangErr) {
      throw new Error(
        `Could not auto-install Java ${requiredMajor}+.\n` +
          `Azul/Zulu: ${(azulErr as Error).message}\n` +
          `Mojang: ${(mojangErr as Error).message}`,
      )
    }
  }
}

/** JVM flags that need a minimum Java major version */
export function filterJvmArgsForJava(args: string[], javaMajor: number): string[] {
  return args.filter((arg) => {
    // Added in Java 23/24 — required by modern Minecraft but fatal on older JREs
    if (arg.startsWith('--sun-misc-unsafe-memory-access')) {
      return javaMajor >= 23
    }
    // --enable-native-access is Java 17+ (preview) / more widely 21+
    if (arg.startsWith('--enable-native-access')) {
      return javaMajor >= 17
    }
    return true
  })
}
