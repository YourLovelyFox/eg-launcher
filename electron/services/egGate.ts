/**
 * EG Gate — proves this client was started by EG Launcher when joining
 * the EG Forge Server (companion Forge mod: eggate).
 *
 * Shared secret lives in:
 *   resources/eg-gate/eg-gate.secret   (dev + packaged extraResources)
 *   or EG_GATE_SECRET env
 *
 * Client mod jar:
 *   resources/eg-gate/eggate.jar
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getInstanceModsDir } from '../paths'

const GATE_DIR_NAME = 'eg-gate'
const SECRET_FILE = 'eg-gate.secret'
const MOD_JAR = 'eggate.jar'

function candidateResourceRoots(): string[] {
  const roots: string[] = []
  // Packaged: process.resourcesPath/eg-gate
  try {
    if (process.resourcesPath) {
      roots.push(path.join(process.resourcesPath, GATE_DIR_NAME))
    }
  } catch {
    // ignore
  }
  // Dev: <repo>/resources/eg-gate
  try {
    roots.push(path.join(app.getAppPath(), 'resources', GATE_DIR_NAME))
  } catch {
    // ignore
  }
  // Dev when appPath is project root
  roots.push(path.join(process.cwd(), 'resources', GATE_DIR_NAME))
  // Sibling Desktop forge server (local authoring machine)
  roots.push(
    path.join(
      app.getPath('desktop'),
      'forge server',
      'mods',
    ),
  )
  roots.push(path.join(app.getPath('desktop'), 'forge server', 'config'))
  roots.push(
    path.join(app.getPath('desktop'), 'New folder', 'resources', GATE_DIR_NAME),
  )
  return roots
}

/** Shared secret the Forge server expects (config/eg-gate.secret). */
export function getEgGateToken(): string | null {
  const fromEnv = (process.env.EG_GATE_SECRET || '').trim()
  if (fromEnv) return fromEnv

  for (const root of candidateResourceRoots()) {
    const secretPath = path.join(root, SECRET_FILE)
    // mods/ folder only has jar — secret is in config/
    const alt =
      root.endsWith(`${path.sep}mods`) || root.endsWith('/mods')
        ? path.join(path.dirname(root), 'config', SECRET_FILE)
        : secretPath
    for (const p of [secretPath, alt]) {
      try {
        if (!fs.existsSync(p)) continue
        const line = fs
          .readFileSync(p, 'utf-8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith('#'))
        if (line) return line
      } catch {
        // continue
      }
    }
  }
  return null
}

/** Absolute path to eggate.jar if present. */
export function findEgGateModJar(): string | null {
  for (const root of candidateResourceRoots()) {
    const candidates = [
      path.join(root, MOD_JAR),
      path.join(root, 'eggate.jar'),
      // desktop/forge server/mods/eggate.jar
      root.endsWith('mods') ? path.join(root, MOD_JAR) : '',
    ].filter(Boolean)
    for (const p of candidates) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
      } catch {
        // continue
      }
    }
  }
  // Explicit forge server mods path
  try {
    const p = path.join(app.getPath('desktop'), 'forge server', 'mods', MOD_JAR)
    if (fs.existsSync(p)) return p
  } catch {
    // ignore
  }
  return null
}

/**
 * Copy eggate.jar into an instance mods folder (required to join EG Forge Server).
 * Returns true if the jar is present afterwards.
 */
export function ensureEgGateModInstalled(instanceId: string): {
  ok: boolean
  path?: string
  error?: string
} {
  const src = findEgGateModJar()
  if (!src) {
    return {
      ok: false,
      error:
        'eggate.jar not found. Build the forge server mod (scripts/install.ps1) or place eggate.jar in resources/eg-gate/.',
    }
  }
  try {
    const modsDir = getInstanceModsDir(instanceId)
    const dest = path.join(modsDir, MOD_JAR)
    fs.copyFileSync(src, dest)
    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** JVM args EG Launcher always adds so the eggate client mod can prove origin. */
export function getEgGateJvmArgs(): string[] {
  const args = [
    '-Dminecraft.launcher.brand=EGLauncher',
    `-Dminecraft.launcher.version=${app.getVersion?.() || '1.0.0'}`,
  ]
  const token = getEgGateToken()
  if (token) {
    args.push(`-Deg.gate.token=${token}`)
  }
  return args
}

export function isEgForgePartner(partnerId: string): boolean {
  return partnerId === 'eg-forge' || partnerId === 'eg-forge-server'
}
