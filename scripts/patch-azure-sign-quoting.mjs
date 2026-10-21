/**
 * CI-only workaround for electron-builder 25.1.8 Azure Trusted Signing.
 *
 * app-builder-lib 25.1.8 builds `Invoke-TrustedSigning -Files <path>` without quoting,
 * so "release\win-unpacked\EG Launcher.exe" is split at the space and signing fails.
 * This patches node_modules/app-builder-lib so every parameter value is passed as a
 * single-quoted PowerShell string (same approach as app-builder-lib 26.x).
 *
 * Only touches the Azure signing code path (used only when win.azureSignOptions is set),
 * so unsigned local `npm run dist` builds are unaffected.
 *
 * Usage (after `npm ci`): node scripts/patch-azure-sign-quoting.mjs
 * Remove this script once electron-builder is upgraded to 26.x.
 */
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pkgDir = path.dirname(require.resolve('app-builder-lib/package.json'))
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version
const file = path.join(pkgDir, 'out', 'codeSign', 'windowsSignAzureManager.js')

const ORIGINAL = 'return [...res, `-${field}`, value];'
const PATCHED = "return [...res, `-${field}`, `'${String(value).replace(/'/g, \"''\")}'`];"

const src = fs.readFileSync(file, 'utf8')

if (src.includes(PATCHED)) {
  console.log(`[azure-sign-patch] app-builder-lib ${version}: already patched`)
  process.exit(0)
}
if (version !== '25.1.8') {
  console.error(
    `[azure-sign-patch] app-builder-lib ${version} is not 25.1.8. Check whether it quotes -Files itself and remove this patch step.`,
  )
  process.exit(1)
}
const count = src.split(ORIGINAL).length - 1
if (count !== 1) {
  console.error(`[azure-sign-patch] expected 1 match in ${file}, found ${count}; not patching`)
  process.exit(1)
}
fs.writeFileSync(file, src.replace(ORIGINAL, PATCHED), 'utf8')
console.log(`[azure-sign-patch] app-builder-lib ${version}: Invoke-TrustedSigning parameters are now single-quoted`)
