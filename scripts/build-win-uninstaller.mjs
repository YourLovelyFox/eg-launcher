/**
 * Build standalone EG-Launcher-*-win-x64-uninstall.exe with makensis
 * (from electron-builder's cached NSIS toolkit).
 *
 * Usage:
 *   node scripts/build-win-uninstaller.mjs
 *   node scripts/build-win-uninstaller.mjs --version 2.0.0
 *
 * Signs with CSC_LINK / certs/ if available (same as the installer).
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const nsiPath = path.join(root, 'build', 'standalone-uninstaller.nsi')
const outDir = path.join(root, 'release')

function pkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  return pkg.version
}

function parseArgs() {
  const args = process.argv.slice(2)
  let version = pkgVersion()
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) version = args[++i]
  }
  return { version }
}

function findMakensis() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const cacheRoots = [
    path.join(localAppData, 'electron-builder', 'Cache', 'nsis'),
    path.join(os.homedir(), '.cache', 'electron-builder', 'nsis'),
  ]

  for (const cacheRoot of cacheRoots) {
    if (!fs.existsSync(cacheRoot)) continue
    const entries = fs.readdirSync(cacheRoot, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const candidate = path.join(cacheRoot, ent.name, 'Bin', 'makensis.exe')
      if (fs.existsSync(candidate)) return candidate
      const candidate2 = path.join(cacheRoot, ent.name, 'makensis.exe')
      if (fs.existsSync(candidate2)) return candidate2
    }
  }

  // PATH fallback
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['makensis'], {
    encoding: 'utf8',
  })
  if (which.status === 0) {
    const line = which.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (line && fs.existsSync(line)) return line
  }
  return null
}

function loadCsc() {
  if (process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD) {
    return {
      link: process.env.CSC_LINK,
      password: process.env.CSC_KEY_PASSWORD,
    }
  }
  const pfx = path.join(root, 'certs', 'eg-launcher-codesign.pfx')
  const passFile = path.join(root, 'certs', 'csc-password.txt')
  if (fs.existsSync(pfx) && fs.existsSync(passFile)) {
    return { link: pfx, password: fs.readFileSync(passFile, 'utf8').trim() }
  }
  return null
}

function findSigntool() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const winCodeSign = path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign')
  if (fs.existsSync(winCodeSign)) {
    const walk = (dir, depth = 0) => {
      if (depth > 6) return null
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return null
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        if (ent.isFile() && ent.name.toLowerCase() === 'signtool.exe') return full
        if (ent.isDirectory()) {
          const found = walk(full, depth + 1)
          if (found) return found
        }
      }
      return null
    }
    const found = walk(winCodeSign)
    if (found) return found
  }
  return null
}

function signFile(filePath) {
  const csc = loadCsc()
  if (!csc) {
    console.log('[uninstaller] No cert — leaving unsigned')
    return
  }
  const signtool = findSigntool()
  if (!signtool) {
    console.warn('[uninstaller] signtool.exe not found; skip sign')
    return
  }
  const r = spawnSync(
    signtool,
    [
      'sign',
      '/f',
      csc.link,
      '/p',
      csc.password,
      '/fd',
      'SHA256',
      '/tr',
      'http://timestamp.digicert.com',
      '/td',
      'SHA256',
      filePath,
    ],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) {
    console.warn('[uninstaller] sign failed:', r.stdout || r.stderr)
  } else {
    console.log('[uninstaller] Signed', filePath)
  }
}

function main() {
  const { version } = parseArgs()
  if (!fs.existsSync(nsiPath)) {
    console.error('Missing', nsiPath)
    process.exit(1)
  }

  const makensis = findMakensis()
  if (!makensis) {
    console.error(
      'makensis.exe not found. Run a Windows electron-builder package once so NSIS is cached, or install NSIS.',
    )
    process.exit(1)
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `EG-Launcher-${version}-win-x64-uninstall.exe`)
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile)

  console.log('[uninstaller] makensis:', makensis)
  console.log('[uninstaller] out:', outFile)

  const r = spawnSync(
    makensis,
    [
      `/DOUT_FILE=${outFile}`,
      `/DVERSION=${version}`,
      '/V2',
      nsiPath,
    ],
    { encoding: 'utf8', cwd: root },
  )
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  if (r.status !== 0 || !fs.existsSync(outFile)) {
    console.error('[uninstaller] makensis failed')
    process.exit(r.status || 1)
  }

  signFile(outFile)
  const st = fs.statSync(outFile)
  console.log(`[uninstaller] OK ${outFile} (${st.size} bytes)`)
}

main()
