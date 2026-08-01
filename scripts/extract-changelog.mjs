/**
 * Extract a version section from CHANGELOG.md for GitHub Releases.
 * GitHub-first notes: hash freeze + SAC reality (no cert / no Store required).
 *
 * Usage: node scripts/extract-changelog.mjs <version> [out-file]
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const version = (process.argv[2] || '').replace(/^v/i, '')
const outFile = process.argv[3]

if (!version) {
  console.error('Usage: node scripts/extract-changelog.mjs <version> [out-file]')
  process.exit(1)
}

function githubBanner() {
  return [
    '## Download (GitHub)',
    '',
    '| Asset | Platform |',
    '| --- | --- |',
    '| `EG-Launcher-*-win-x64-setup.exe` | Windows x64 (NSIS) |',
    '| `EG-Launcher-*-win-x64-uninstall.exe` | Windows uninstaller |',
    '| `EG-Launcher-*-linux-*.AppImage` | Linux x64 |',
    '',
    '### Windows Smart App Control / SmartScreen',
    '',
    'This Windows installer is **unsigned** (no code-signing certificate).',
    '',
    '- **SmartScreen** may show a warning → use **More info → Run anyway** if you trust this official release.',
    '- **Smart App Control (Enforcement)** may **hard-block** unknown unsigned apps. There is no free way to fully bypass that without a trusted signature or established file reputation for **this exact SHA-256**.',
    '- **Do not** download repacks from third parties; that resets trust and risks malware.',
    '',
    '**Hash freeze:** this version’s binaries are published **once**. Replacing them would create a new hash and wipe any reputation. See `docs/GITHUB-SAC.md`.',
    '',
    'Verify SHA-256 of assets if listed in the Actions log / release checks.',
    '',
    '---',
    '',
  ].join('\n')
}

const changelogPath = path.join(root, 'CHANGELOG.md')
if (!fs.existsSync(changelogPath)) {
  console.error('CHANGELOG.md not found')
  process.exit(1)
}

const text = fs.readFileSync(changelogPath, 'utf8')
const escaped = version.replace(/\./g, '\\.')
const re = new RegExp(
  `##\\s*\\[?${escaped}\\]?[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
  'i',
)
const match = text.match(re)

let body
if (match) {
  const section = match[0].trim()
  body = [
    githubBanner(),
    section,
    '',
    '---',
    '',
    'Full history: `CHANGELOG.md` in the repository. SAC notes: `docs/GITHUB-SAC.md`.',
  ].join('\n')
} else {
  body = [
    githubBanner(),
    `## EG Launcher ${version}`,
    '',
    `_No CHANGELOG.md section found for this version._`,
    '',
    'Add a `## [${version}]` section to CHANGELOG.md before the next release.',
  ].join('\n')
  console.error(`Warning: no CHANGELOG section for ${version}`)
}

if (outFile) {
  fs.writeFileSync(outFile, body, 'utf8')
}
process.stdout.write(body)
