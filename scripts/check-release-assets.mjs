/**
 * Ensure a GitHub release has both Windows + Linux installers (and update yml).
 *
 * Usage:
 *   node scripts/check-release-assets.mjs [version]
 *   # version defaults to package.json (e.g. 2.5.0) — tag is v${version}
 *
 * Exit 0 if complete; exit 1 if anything required is missing.
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = (process.argv[2] || pkg.version || '').replace(/^v/i, '')
if (!version) {
  console.error('Usage: node scripts/check-release-assets.mjs <version>')
  process.exit(1)
}
const tag = `v${version}`

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

let names = []
try {
  const json = run(`gh release view ${tag} --json assets --jq ".assets[].name"`)
  names = json ? json.split(/\r?\n/).filter(Boolean) : []
} catch (e) {
  console.error(`Release ${tag} not found or gh failed:`, e.message)
  process.exit(1)
}

const required = [
  {
    label: 'Windows NSIS setup',
    test: (n) => /^EG-Launcher-.+-win-x64-setup\.exe$/i.test(n) && !n.includes('uninstall'),
  },
  {
    label: 'Windows uninstaller',
    test: (n) => /uninstall\.exe$/i.test(n),
  },
  {
    label: 'Windows latest.yml',
    test: (n) => n === 'latest.yml',
  },
  {
    label: 'Linux AppImage',
    test: (n) => /\.AppImage$/i.test(n),
  },
  {
    label: 'Linux latest-linux.yml',
    test: (n) => n === 'latest-linux.yml',
  },
]

console.log(`Release ${tag} assets:`)
for (const n of names) console.log(`  - ${n}`)

let ok = true
for (const r of required) {
  const hit = names.find((n) => r.test(n))
  if (hit) console.log(`OK  ${r.label}: ${hit}`)
  else {
    console.error(`MISS ${r.label}`)
    ok = false
  }
}

if (!ok) {
  console.error(`\nIncomplete release ${tag}. Windows + Linux are both required.`)
  console.error(`CI "Build & Release" on tag push builds both; wait for it or re-run the workflow.`)
  process.exit(1)
}

console.log(`\nRelease ${tag} is complete (Windows + Linux).`)
