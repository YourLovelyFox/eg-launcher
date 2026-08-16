import { app, BrowserWindow, dialog, shell } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import https from 'https'
import http from 'http'
import os from 'os'
import path from 'path'
import { GITHUB_OWNER, GITHUB_RELEASES_URL, GITHUB_REPO } from '../../shared/branding'
import type { UpdateStatus } from '../../shared/types'
import { isMicrosoftStoreInstall } from './distribution'
import { getRunningGameInfo } from './minecraft'

const PORTABLE_ZIP = /^EG-Launcher-.+-win-x64-portable.*\.zip$/i
const GH_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=15`

type UpdateInfoFile = { tag?: string; version?: string; channel?: string }

type GhAsset = {
  name: string
  browser_download_url: string
  size: number
}

type GhRelease = {
  tag_name: string
  name: string | null
  draft: boolean
  prerelease: boolean
  published_at: string
  body: string | null
  assets: GhAsset[]
}

type PendingRelease = {
  tag: string
  version: string
  releaseName: string | null
  releaseNotes: string | null
  releaseDate: string | null
  assetName: string
  assetSize: number
  downloadUrl: string
}

let lastStatus: UpdateStatus = { state: 'idle' }
let updaterWin: BrowserWindow | null = null
let pending: PendingRelease | null = null
let pendingZip: string | null = null
let checkTimer: ReturnType<typeof setTimeout> | null = null

function currentVersion(): string {
  return app.getVersion()
}

function emit(status: UpdateStatus): UpdateStatus {
  lastStatus = status
  try {
    if (updaterWin && !updaterWin.isDestroyed()) {
      updaterWin.webContents.send('updater:status', status)
    }
  } catch {
    /* ignore */
  }
  return status
}

function readBundledUpdateInfo(): UpdateInfoFile | null {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'update-info.json') : '',
    path.join(path.dirname(app.getPath('exe')), 'update-info.json'),
    path.join(__dirname, '../../build/update-info.json'),
  ].filter(Boolean)
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as UpdateInfoFile
      }
    } catch {
      /* next */
    }
  }
  return null
}

function localIdentity(): { tag: string; version: string } {
  const info = readBundledUpdateInfo()
  const version = (info?.version || currentVersion()).replace(/^v/i, '')
  const tag = (info?.tag || `v${version}`).trim()
  return { tag, version }
}

export function canSelfUpdate(): boolean {
  return process.platform === 'win32' && app.isPackaged && !isMicrosoftStoreInstall()
}

export function isSelfUpdateChannel(): boolean {
  return canSelfUpdate()
}

function parseVer(raw: string): { core: number[]; pre: string } {
  const t = raw.replace(/^v/i, '').trim()
  const dash = t.indexOf('-')
  const coreStr = dash >= 0 ? t.slice(0, dash) : t
  const pre = dash >= 0 ? t.slice(dash + 1) : ''
  const core = coreStr.split('.').map((n) => parseInt(n, 10) || 0)
  while (core.length < 3) core.push(0)
  return { core, pre }
}

function cmpVer(aRaw: string, bRaw: string): number {
  const a = parseVer(aRaw)
  const b = parseVer(bRaw)
  for (let i = 0; i < 3; i++) {
    const d = a.core[i] - b.core[i]
    if (d) return d
  }
  if (!a.pre && b.pre) return 1
  if (a.pre && !b.pre) return -1
  return a.pre.localeCompare(b.pre, undefined, { numeric: true })
}

function versionFromAsset(name: string): string | null {
  const m = name.match(/^EG-Launcher-(.+)-win-x64-portable/i)
  return m ? m[1] : null
}

function isNewer(remote: PendingRelease, local: { tag: string; version: string }): boolean {
  const sameTag =
    remote.tag.replace(/^v/i, '').toLowerCase() === local.tag.replace(/^v/i, '').toLowerCase()
  if (sameTag) return false
  const remoteFileVer = versionFromAsset(remote.assetName) || remote.version
  const hasMeta = Boolean(readBundledUpdateInfo()?.tag)
  if (!hasMeta) {
    // Older portable zips have no update-info.json — only jump when the file version is newer.
    return cmpVer(remoteFileVer, local.version) > 0
  }
  return cmpVer(remote.tag, local.tag) > 0 || cmpVer(remoteFileVer, local.version) > 0
}

function ghGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'EG-Launcher-Updater',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          ghGet(res.headers.location).then(resolve, reject)
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode || 0}: ${body.slice(0, 180)}`))
            return
          }
          resolve(body)
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(25000, () => {
      req.destroy(new Error('GitHub API timed out'))
    })
  })
}

function downloadFile(
  url: string,
  dest: string,
  onProgress: (transferred: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('http://') ? http.get : https.get
    const req = get(
      url,
      { headers: { 'User-Agent': 'EG-Launcher-Updater', Accept: 'application/octet-stream' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          downloadFile(res.headers.location, dest, onProgress).then(resolve, reject)
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`Download failed (${res.statusCode || 0})`))
          res.resume()
          return
        }
        const total = Number(res.headers['content-length'] || 0)
        let transferred = 0
        const out = fs.createWriteStream(dest)
        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length
          onProgress(transferred, total)
        })
        res.pipe(out)
        out.on('finish', () => out.close((err) => (err ? reject(err) : resolve())))
        out.on('error', reject)
      },
    )
    req.on('error', reject)
    req.setTimeout(120000, () => req.destroy(new Error('Download timed out')))
  })
}

function findExe(dir: string): string | null {
  const want = 'EG Launcher.exe'
  const direct = path.join(dir, want)
  if (fs.existsSync(direct)) return direct
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (!fs.statSync(full).isDirectory()) continue
      const nested = path.join(full, want)
      if (fs.existsSync(nested)) return nested
    }
  } catch {
    /* ignore */
  }
  return null
}

function extractZip(zipPath: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dest, { recursive: true })
    const tar = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'tar.exe')
      : 'tar'
    const child = spawn(tar, ['-xf', zipPath, '-C', dest], { windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Could not extract update (tar exit ${code})`))
    })
  })
}

/** After the launcher exits: unzip into the same folder, then tell the user to reopen. Never auto-starts. */
function writeUnzipAndPromptScript(appDir: string, zipPath: string, pid: number): string {
  const script = path.join(os.tmpdir(), `eg-unzip-update-${Date.now()}.cmd`)
  const tar = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'tar.exe')
    : 'tar'
  const body = [
    '@echo off',
    'setlocal EnableExtensions',
    `set "APPDIR=${appDir}"`,
    `set "ZIP=${zipPath}"`,
    `set "OLDPID=${pid}"`,
    `set "TAR=${tar}"`,
    ':wait',
    'timeout /t 1 /nobreak >nul',
    'tasklist /FI "PID eq %OLDPID%" | find "%OLDPID%" >nul',
    'if not errorlevel 1 goto wait',
    'timeout /t 2 /nobreak >nul',
    'if not exist "%ZIP%" goto fail',
    '"%TAR%" -xf "%ZIP%" -C "%APPDIR%"',
    'if errorlevel 1 goto fail',
    'if exist "%APPDIR%\\EG Launcher.exe" goto ok',
    'for /d %%D in ("%APPDIR%\\*") do (',
    '  if exist "%%D\\EG Launcher.exe" (',
    '    robocopy "%%D" "%APPDIR%" /E /MOVE /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
    '  )',
    ')',
    'if exist "%APPDIR%\\EG Launcher.exe" goto ok',
    ':fail',
    'powershell -NoProfile -STA -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show(\'Could not unzip the update into the launcher folder.\',\'EG Launcher\')"',
    'goto cleanup',
    ':ok',
    'powershell -NoProfile -STA -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show(\'Update installed. Please reopen EG Launcher.\',\'EG Launcher\')"',
    ':cleanup',
    'if exist "%ZIP%" del /f /q "%ZIP%" >nul 2>&1',
    'del /f /q "%~f0" >nul 2>&1',
    '',
  ].join('\r\n')
  fs.writeFileSync(script, body, 'utf8')
  return script
}

function pickRelease(releases: GhRelease[]): PendingRelease | null {
  for (const rel of releases) {
    if (rel.draft) continue
    const asset = (rel.assets || []).find((a) => PORTABLE_ZIP.test(a.name))
    if (!asset) continue
    const version = versionFromAsset(asset.name) || rel.tag_name.replace(/^v/i, '')
    return {
      tag: rel.tag_name,
      version,
      releaseName: rel.name,
      releaseNotes: rel.body,
      releaseDate: rel.published_at,
      assetName: asset.name,
      assetSize: asset.size,
      downloadUrl: asset.browser_download_url,
    }
  }
  return null
}

export function setUpdaterWindow(win: BrowserWindow | null): void {
  updaterWin = win
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus
}

export function getAppVersionInfo() {
  const local = localIdentity()
  return {
    version: currentVersion(),
    tag: local.tag,
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    microsoftStore: isMicrosoftStoreInstall(),
    selfUpdateChannel: canSelfUpdate(),
  }
}

export function initAutoUpdater(win: BrowserWindow | null): void {
  setUpdaterWindow(win)
  if (!canSelfUpdate()) {
    emit({ state: 'unavailable', currentVersion: currentVersion(), reason: 'manual' })
    return
  }
  if (checkTimer) clearTimeout(checkTimer)
  checkTimer = setTimeout(() => {
    void checkForUpdates(false)
  }, 9000)
}

export function startPeriodicUpdateChecks(): void {
  /* used by init */
}

export function stopPeriodicUpdateChecks(): void {
  if (checkTimer) {
    clearTimeout(checkTimer)
    checkTimer = null
  }
}

export async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  if (!canSelfUpdate()) {
    if (manual) {
      try {
        await shell.openExternal(GITHUB_RELEASES_URL)
      } catch {
        /* ignore */
      }
    }
    return emit({
      state: 'unavailable',
      currentVersion: currentVersion(),
      reason: 'This build updates from GitHub Releases in the browser.',
    })
  }

  emit({ state: 'checking' })
  try {
    const raw = await ghGet(GH_API)
    const releases = JSON.parse(raw) as GhRelease[]
    if (!Array.isArray(releases)) throw new Error('Unexpected GitHub response')
    const next = pickRelease(releases)
    const local = localIdentity()
    if (!next || !isNewer(next, local)) {
      pending = null
      return emit({
        state: 'unavailable',
        currentVersion: local.version,
        reason: 'up-to-date',
      })
    }
    pending = next
    pendingZip = null
    return emit({
      state: 'available',
      currentVersion: local.version,
      version: next.version,
      tag: next.tag,
      releaseName: next.releaseName,
      releaseNotes: next.releaseNotes,
      releaseDate: next.releaseDate,
      assetName: next.assetName,
      assetSize: next.assetSize,
    })
  } catch (err) {
    const message = (err as Error).message || 'Could not check for updates'
    return emit({ state: 'error', message, currentVersion: currentVersion() })
  }
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!canSelfUpdate()) {
    return emit({
      state: 'error',
      message: 'Self-update is only available on the Windows portable build.',
      currentVersion: currentVersion(),
    })
  }
  if (!pending) {
    const checked = await checkForUpdates(false)
    if (checked.state !== 'available') return checked
  }
  const rel = pending
  if (!rel) {
    return emit({
      state: 'error',
      message: 'No update is available.',
      currentVersion: currentVersion(),
    })
  }

  const work = path.join(os.tmpdir(), `eg-launcher-update-${Date.now()}`)
  fs.mkdirSync(work, { recursive: true })
  const zipPath = path.join(work, rel.assetName)
  const unpack = path.join(work, 'unpacked')

  let lastTick = Date.now()
  let lastBytes = 0
  emit({
    state: 'downloading',
    currentVersion: currentVersion(),
    version: rel.version,
    tag: rel.tag,
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: rel.assetSize || 0,
  })

  try {
    await downloadFile(rel.downloadUrl, zipPath, (transferred, total) => {
      const now = Date.now()
      const dt = Math.max(1, now - lastTick)
      const speed = ((transferred - lastBytes) * 1000) / dt
      lastTick = now
      lastBytes = transferred
      emit({
        state: 'downloading',
        currentVersion: currentVersion(),
        version: rel.version,
        tag: rel.tag,
        percent: total ? Math.min(100, (transferred / total) * 100) : 0,
        bytesPerSecond: speed,
        transferred,
        total,
      })
    })
    await extractZip(zipPath, unpack)
    const exe = findExe(unpack)
    if (!exe) throw new Error('Downloaded zip did not contain EG Launcher.exe')
    pendingZip = zipPath
    try {
      fs.rmSync(unpack, { recursive: true, force: true })
    } catch {
      /* zip is enough */
    }
    return emit({
      state: 'ready',
      currentVersion: currentVersion(),
      version: rel.version,
      tag: rel.tag,
      releaseName: rel.releaseName,
      releaseNotes: rel.releaseNotes,
    })
  } catch (err) {
    return emit({
      state: 'error',
      message: (err as Error).message || 'Download failed',
      currentVersion: currentVersion(),
    })
  }
}

export async function installUpdate(): Promise<UpdateStatus> {
  if (!canSelfUpdate() || !pending || !pendingZip || !fs.existsSync(pendingZip)) {
    return emit({
      state: 'error',
      message: 'Download the update first.',
      currentVersion: currentVersion(),
    })
  }
  if (getRunningGameInfo().running) {
    return emit({
      state: 'error',
      message: 'Close Minecraft first, then update.',
      currentVersion: currentVersion(),
    })
  }
  const appDir = path.dirname(app.getPath('exe'))
  try {
    fs.accessSync(appDir, fs.constants.W_OK)
  } catch {
    return emit({
      state: 'error',
      message:
        'Cannot write to the launcher folder. Move the portable folder somewhere you own (for example Desktop) and try again.',
      currentVersion: currentVersion(),
    })
  }

  const opts = {
    type: 'info' as const,
    title: 'EG Launcher update',
    message: 'The launcher will close now',
    detail:
      'The new zip will be unzipped into this same folder. After the launcher closes, open EG Launcher again yourself.',
    buttons: ['Close launcher', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const win = updaterWin && !updaterWin.isDestroyed() ? updaterWin : null
  const choice = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (choice.response !== 0) {
    return emit({
      state: 'ready',
      currentVersion: currentVersion(),
      version: pending.version,
      tag: pending.tag,
      releaseName: pending.releaseName,
      releaseNotes: pending.releaseNotes,
    })
  }

  emit({
    state: 'installing',
    currentVersion: currentVersion(),
    version: pending.version,
    tag: pending.tag,
  })
  const script = writeUnzipAndPromptScript(appDir, pendingZip, process.pid)
  const child = spawn('cmd.exe', ['/d', '/c', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  setTimeout(() => {
    app.quit()
  }, 400)
  return lastStatus
}

export async function applyUpdate(): Promise<UpdateStatus> {
  const ready = lastStatus.state === 'ready' ? lastStatus : await downloadUpdate()
  if (ready.state === 'error' || ready.state !== 'ready') return ready
  return installUpdate()
}
