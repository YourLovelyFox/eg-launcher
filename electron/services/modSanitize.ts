/**
 * Keep the instance mods/ folder playable for the configured loader.
 * Bee's SMP (Forge) ships fabric-api and sometimes a loose mods.zip in overrides —
 * those crash or confuse Forge with no useful UI error.
 */
import fs from 'fs'
import path from 'path'
import type { LoaderType } from '../../shared/types'
import { ensureDir, getInstanceModsDir } from '../paths'

export type SanitizeResult = {
  quarantined: string[]
  removed: string[]
  warnings: string[]
}

const QUARANTINE_DIR = '_disabled_incompatible'

/** Filenames that are Fabric/Quilt-only and will crash pure Forge/NeoForge without Connector. */
function isFabricOnlyJarName(name: string): boolean {
  const n = name.toLowerCase()
  if (!n.endsWith('.jar') && !n.endsWith('.jar.disabled')) return false
  // Forgified Fabric API is OK on Forge (Sinytra)
  if (n.includes('forgified-fabric') || n.includes('sinytra') || n.includes('connector')) {
    return false
  }
  // Dual fabric-forge jars are usually OK
  if (n.includes('fabric') && n.includes('forge')) return false
  // Pure Fabric API / loader
  if (/^fabric-api[-_+]/.test(n) || n.includes('fabric-api-')) return true
  if (n.includes('fabric-loader') || n.startsWith('fabric-language-')) return true
  if (n.includes('quilt-loader') || n.startsWith('quilted-fabric')) return true
  return false
}

function hasSinytraConnector(modsDir: string): boolean {
  try {
    return fs.readdirSync(modsDir).some((f) => {
      const n = f.toLowerCase()
      return n.endsWith('.jar') && (n.includes('connector') || n.includes('sinytra'))
    })
  } catch {
    return false
  }
}

/**
 * Move known-bad files out of mods/ so the game can start.
 * Returns what was changed (for UI toasts / logs).
 */
export function sanitizeInstanceMods(
  instanceId: string,
  loader: LoaderType,
): SanitizeResult {
  const modsDir = getInstanceModsDir(instanceId)
  const result: SanitizeResult = { quarantined: [], removed: [], warnings: [] }
  if (!fs.existsSync(modsDir)) return result

  const isForgeFamily = loader === 'forge' || loader === 'neoforge'
  const connector = isForgeFamily && hasSinytraConnector(modsDir)
  const quarantineRoot = path.join(modsDir, QUARANTINE_DIR)
  ensureDir(quarantineRoot)

  let names: string[]
  try {
    names = fs.readdirSync(modsDir)
  } catch {
    return result
  }

  for (const name of names) {
    if (name === QUARANTINE_DIR) continue
    const full = path.join(modsDir, name)
    let st: fs.Stats
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue

    const lower = name.toLowerCase()

    // Loose archives in mods/ are not loaded as Forge mods and often came from overrides
    if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) {
      try {
        const dest = path.join(quarantineRoot, name)
        if (fs.existsSync(dest)) fs.unlinkSync(dest)
        fs.renameSync(full, dest)
        result.quarantined.push(name)
        result.warnings.push(
          `Moved ${name} out of mods/ (archives are not Forge mods). Extract jars manually if needed.`,
        )
      } catch (err) {
        result.warnings.push(`Could not move ${name}: ${(err as Error).message}`)
      }
      continue
    }

    if (isForgeFamily && !connector && isFabricOnlyJarName(name)) {
      try {
        const dest = path.join(quarantineRoot, name)
        if (fs.existsSync(dest)) fs.unlinkSync(dest)
        fs.renameSync(full, dest)
        result.quarantined.push(name)
        result.warnings.push(
          `Disabled ${name} — Fabric-only mod on ${loader} (would crash on launch). Install Sinytra Connector if the pack needs Fabric mods.`,
        )
      } catch (err) {
        result.warnings.push(`Could not quarantine ${name}: ${(err as Error).message}`)
      }
    }
  }

  return result
}
