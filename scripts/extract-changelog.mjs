/**
 * Extract a version section from CHANGELOG.md for GitHub Releases.
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
    '## Download',
    '',
    '> **Windows:** GitHub `setup.exe` installers have been **removed** due to Smart App Control (SAC) / SmartScreen.',
    '>',
    '> The **Microsoft Store** is the official Windows channel, but it is **currently unavailable** while the app finishes Microsoft’s **publishing / certification process**. **Please wait a bit** — Windows users cannot install from GitHub in the meantime.',
    '>',
    '> **Linux:** use the **AppImage** below from this GitHub Release (available now).',
    '',
    '| Asset | Platform |',
    '| --- | --- |',
    '| `EG-Launcher-*-linux-*.AppImage` | **Linux x64** (only installer on GitHub) |',
    '| Windows | Microsoft Store — **pending publication** (not installable yet) |',
    '',
    'See `docs/GITHUB-SAC.md` and `docs/GITHUB-RELEASES.md`.',
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
