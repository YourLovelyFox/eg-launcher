/**
 * Extract a version section from CHANGELOG.md for GitHub Releases.
 *
 * Usage: node scripts/extract-changelog.mjs <version> [out-file]
 * Prints the body to stdout and optionally writes out-file.
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

const changelogPath = path.join(root, 'CHANGELOG.md')
if (!fs.existsSync(changelogPath)) {
  console.error('CHANGELOG.md not found')
  process.exit(1)
}

const text = fs.readFileSync(changelogPath, 'utf8')
const escaped = version.replace(/\./g, '\\.')
// ## [1.0.4] — date   OR   ## 1.0.4
const re = new RegExp(
  `##\\s*\\[?${escaped}\\]?[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
  'i',
)
const match = text.match(re)

let body
if (match) {
  const section = match[0].trim()
  body = [
    section,
    '',
    '---',
    '',
    `**Download** the assets below for your platform (Windows NSIS setup or Linux AppImage).`,
    '',
    `Full project history: see \`CHANGELOG.md\` in the repository.`,
  ].join('\n')
} else {
  body = [
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
