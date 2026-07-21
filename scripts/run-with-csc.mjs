/**
 * Load self-signed code-signing env for electron-builder (Windows).
 *
 * Looks for (first hit wins):
 *   1) CSC_LINK / CSC_KEY_PASSWORD already set
 *   2) certs/eg-launcher-codesign.pfx + certs/csc-password.txt
 *
 * If no cert: sets CSC_IDENTITY_AUTO_DISCOVERY=false and continues unsigned.
 *
 * Usage:
 *   node scripts/run-with-csc.mjs -- npx electron-builder --win nsis --x64 --publish never
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const args = process.argv.slice(2)
const sep = args.indexOf('--')
if (sep < 0 || sep === args.length - 1) {
  console.error('Usage: node scripts/run-with-csc.mjs -- <command> [args...]')
  process.exit(1)
}
const cmdArgs = args.slice(sep + 1)

const env = { ...process.env }
const pfx = path.join(root, 'certs', 'eg-launcher-codesign.pfx')
const passFile = path.join(root, 'certs', 'csc-password.txt')

const hasEnvLink = Boolean(env.CSC_LINK || env.WIN_CSC_LINK)

if (!hasEnvLink && fs.existsSync(pfx) && fs.existsSync(passFile)) {
  env.CSC_LINK = pfx
  env.CSC_KEY_PASSWORD = fs.readFileSync(passFile, 'utf8').trim()
  env.WIN_CSC_LINK = pfx
  env.WIN_CSC_KEY_PASSWORD = env.CSC_KEY_PASSWORD
  console.log('[csc] Using self-signed cert:', pfx)
} else if (hasEnvLink) {
  console.log('[csc] Using CSC_LINK / WIN_CSC_LINK from environment')
} else {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  console.log('[csc] No cert found — building unsigned (run scripts/generate-self-signed-cert.ps1)')
}

// Avoid electron-builder hunting for Apple identities on Windows
if (process.platform === 'win32' && !env.CSC_IDENTITY_AUTO_DISCOVERY) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = env.CSC_LINK ? 'true' : 'false'
}

const command = cmdArgs[0]
const rest = cmdArgs.slice(1)
const child = spawn(command, rest, {
  env,
  stdio: 'inherit',
  shell: true,
  cwd: root,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
