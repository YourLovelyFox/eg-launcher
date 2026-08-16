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

function githubBanner(ver) {
  const isBeta = /beta|rc|pre/i.test(String(ver || ''))
  if (isBeta) {
    return [
      '## Download — BETA',
      '',
      '> **This is a BETA build of EG Launcher.** Things may change or break. Report issues on GitHub or Discord.',
      '>',
      '> **Windows portable:** download `EG-Launcher-*-win-x64-portable-BETA.zip`, unzip, run `EG Launcher.exe`. No installer.',
      '>',
      '> Windows SmartScreen / Smart App Control may warn because this BETA is **unsigned**. That is expected.',
      '',
      '| Asset | Platform |',
      '| --- | --- |',
      '| `EG-Launcher-*-win-x64-portable-BETA.zip` | **Windows x64 portable BETA** |',
      '',
      'See `docs/GITHUB-SAC.md` and `docs/GITHUB-RELEASES.md`.',
      '',
      '---',
      '',
    ].join('\n')
  }
  return [
    '## Download',
    '',
    '> **Windows portable BETA:** download `EG-Launcher-*-win-x64-portable-BETA.zip`, unzip, run `EG Launcher.exe`. No installer.',
    '>',
    '> This GitHub Release is a **full Latest** release (not a pre-release). The portable zip still shows the in-app **BETA** badge.',
    '>',
    '> Windows SmartScreen / Smart App Control may warn because this build is **unsigned**. That is expected.',
    '>',
    '> **Linux:** use the **AppImage** from this GitHub Release.',
    '>',
    '> There is no Microsoft Store listing and no public `setup.exe`.',
    '',
    '| Asset | Platform |',
    '| --- | --- |',
    '| `EG-Launcher-*-win-x64-portable-BETA.zip` | **Windows x64 portable BETA** |',
    '| `EG-Launcher-*-linux-*.AppImage` | **Linux x64** |',
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
    githubBanner(version),
    section,
    '',
    '---',
    '',
    'Full history: `CHANGELOG.md` in the repository. SAC notes: `docs/GITHUB-SAC.md`.',
  ].join('\n')
} else {
  body = [
    githubBanner(version),
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
