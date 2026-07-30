/**
 * Sign Windows release EXEs with DigiCert Certificate Utility (DigiCertUtil.exe).
 *
 * Requires a real DigiCert (or other public CA) Code Signing certificate installed
 * in the Windows certificate store with a private key — DigiCertUtil alone is not enough.
 *
 * Usage:
 *   node scripts/sign-with-digicert.mjs
 *   node scripts/sign-with-digicert.mjs --file release/EG-Launcher-2.5.4-win-x64-setup.exe
 *   node scripts/sign-with-digicert.mjs --util "C:\Users\farka\Desktop\DigiCertUtil.exe"
 *   node scripts/sign-with-digicert.mjs --sha1 054D9508B364A02A068FA5C6153847B6
 *
 * Env:
 *   DIGICERT_UTIL   path to DigiCertUtil.exe
 *   DIGICERT_SHA1   optional certificate thumbprint (no spaces)
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { files: [], util: process.env.DIGICERT_UTIL || '', sha1: process.env.DIGICERT_SHA1 || '' }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--util' && args[i + 1]) out.util = args[++i]
    else if (a === '--sha1' && args[i + 1]) out.sha1 = args[++i].replace(/[\s:]/g, '')
    else if (a === '--file' && args[i + 1]) out.files.push(path.resolve(args[++i]))
    else if (a === '--help' || a === '-h') out.help = true
    else if (!a.startsWith('-')) out.files.push(path.resolve(a))
  }
  return out
}

function findDigiCertUtil(explicit) {
  const candidates = [
    explicit,
    process.env.DIGICERT_UTIL,
    path.join(os.homedir(), 'Desktop', 'DigiCertUtil.exe'),
    path.join(os.homedir(), 'OneDrive', 'Desktop', 'DigiCertUtil.exe'),
    'C:\\Program Files\\DigiCert\\DigiCertUtil.exe',
    'C:\\Program Files (x86)\\DigiCert\\DigiCertUtil.exe',
  ].filter(Boolean)

  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function defaultReleaseExes() {
  const releaseDir = path.join(root, 'release')
  if (!fs.existsSync(releaseDir)) return []
  return fs
    .readdirSync(releaseDir)
    .filter((n) => n.toLowerCase().endsWith('.exe'))
    .map((n) => path.join(releaseDir, n))
}

function hasCodeSigningCert() {
  // PowerShell: CodeSigningCert in user/machine My stores
  const ps = `
    $certs = @(Get-ChildItem Cert:\\CurrentUser\\My, Cert:\\LocalMachine\\My -CodeSigningCert -ErrorAction SilentlyContinue)
    if ($certs.Count -eq 0) { exit 2 }
    $certs | ForEach-Object {
      Write-Output ("THUMB=" + $_.Thumbprint)
      Write-Output ("SUBJECT=" + $_.Subject)
      Write-Output ("ISSUER=" + $_.Issuer)
      Write-Output ("NOTAFTER=" + $_.NotAfter.ToString('u'))
      Write-Output "---"
    }
    exit 0
  `
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return { ok: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() }
}

function main() {
  const opts = parseArgs()
  if (opts.help) {
    console.log(`Usage: node scripts/sign-with-digicert.mjs [--util path] [--sha1 thumb] [--file exe ...]
Signs release/*.exe (or --file) with DigiCertUtil.`)
    process.exit(0)
  }

  const util = findDigiCertUtil(opts.util)
  if (!util) {
    console.error(`[digicert] DigiCertUtil.exe not found.
Place it on your Desktop or set DIGICERT_UTIL / --util.`)
    process.exit(1)
  }
  console.log('[digicert] Util:', util)

  const certInfo = hasCodeSigningCert()
  if (!certInfo.ok) {
    console.error(`
[digicert] No Code Signing certificate in Windows (CurrentUser/LocalMachine My).

DigiCertUtil alone cannot sign. You need a real DigiCert OV/EV Code Signing cert:

  1. Buy/issue Code Signing in DigiCert CertCentral
  2. Install it (DigiCertUtil → import, or browser/token install)
  3. Confirm:
       Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert
  4. Re-run:  npm run sign:digicert

Until then, builds use the self-signed certs/eg-launcher-codesign.pfx (SAC will keep blocking).
`)
    process.exit(2)
  }

  console.log('[digicert] Code signing cert(s) found:')
  console.log(certInfo.stdout)

  const files = opts.files.length ? opts.files : defaultReleaseExes()
  if (!files.length) {
    console.error('[digicert] No .exe files to sign. Build first (npm run dist) or pass --file.')
    process.exit(1)
  }
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error('[digicert] Missing file:', f)
      process.exit(1)
    }
  }

  // DigiCertUtil: multiple files separated by *
  const fileArg = files.join('*')
  const args = ['sign', '/noInput']
  if (opts.sha1) args.push('/sha1', opts.sha1)
  args.push(fileArg)

  console.log('[digicert] Signing', files.length, 'file(s)...')
  const r = spawnSync(util, args, { stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) {
    console.error('[digicert] DigiCertUtil exit code', r.status)
    process.exit(r.status || 1)
  }

  // Verify with PowerShell
  for (const f of files) {
    const verify = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-AuthenticodeSignature -LiteralPath '${f.replace(/'/g, "''")}' | Format-List Path, Status, StatusMessage, @{n='Subject';e={$_.SignerCertificate.Subject}}, @{n='Issuer';e={$_.SignerCertificate.Issuer}}`,
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    console.log(verify.stdout || verify.stderr)
  }

  console.log(`
[digicert] Done. If Status is Valid and Issuer contains DigiCert (or your CA),
Smart App Control / SmartScreen should treat this much better than self-signed.

Ship a NEW version (e.g. 2.5.4) — do not replace 2.5.3 assets (hash freeze / reputation).
`)
}

main()
