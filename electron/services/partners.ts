import path from 'path'
import type { PartnerDefinition } from '../../shared/branding'
import type { GameInstance, LoaderType, PartnerConfig, ProgressEvent } from '../../shared/types'
import {
  getDataRoot,
  getInstanceDir,
  readJsonFile,
  writeJsonFile,
} from '../paths'
import { createInstance, getInstance, listInstances, updateInstance } from './instances'
import { installInstanceRuntime, listLoaderVersions } from './minecraft'
import { installModWithDependencies } from './modInstall'
import { installFeaturedPack } from './featuredPack'
import { getProject, getProjectVersions } from './modrinth'
import { fetchPartnerConfigs, getPartnerConfigById } from './partnerConfig'
import { ensureDefaultServer } from './serversDat'

function toDefinition(p: PartnerConfig): PartnerDefinition {
  return {
    id: p.id,
    title: p.title,
    menuLabel: p.menuLabel,
    description: p.description,
    gameVersion: p.gameVersion,
    loader: p.loader,
    serverAddress: p.serverAddress,
    serverName: p.serverName,
    instanceName: p.instanceName,
    defaultMods: p.defaultMods,
    newsTag: p.newsTag,
    newsUsername: p.newsUsername,
    modrinthPackSlug: p.modrinthPackSlug,
    iconUrl: p.iconUrl,
    discordUrl: p.discordUrl ?? null,
  }
}

export type PartnerLocalState = {
  id: string
  installed: boolean
  instanceId: string | null
  installedAt: string | null
}

export type PartnerStatus = {
  partner: PartnerDefinition
  local: PartnerLocalState
  instance: GameInstance | null
}

type PartnerStore = Record<string, PartnerLocalState>

function storePath(): string {
  return path.join(getDataRoot(), 'partners.json')
}

function loadStore(): PartnerStore {
  return readJsonFile<PartnerStore>(storePath(), {})
}

function saveStore(store: PartnerStore): void {
  writeJsonFile(storePath(), store)
}

function defaultLocal(id: string): PartnerLocalState {
  return {
    id,
    installed: false,
    instanceId: null,
    installedAt: null,
  }
}

export async function listPartnerDefinitions(): Promise<PartnerDefinition[]> {
  const list = await fetchPartnerConfigs(false)
  return list.map(toDefinition)
}

export async function getPartnerDefinition(id: string): Promise<PartnerDefinition | null> {
  const p = await getPartnerConfigById(id)
  return p ? toDefinition(p) : null
}

export function getPartnerLocal(id: string): PartnerLocalState {
  const store = loadStore()
  const local = store[id] || defaultLocal(id)
  // If instance was deleted outside partner flow, mark uninstalled
  if (local.instanceId && !getInstance(local.instanceId)) {
    return defaultLocal(id)
  }
  return local
}

export async function getPartnerStatus(id: string): Promise<PartnerStatus> {
  const partner = await getPartnerDefinition(id)
  if (!partner) throw new Error(`Unknown partner: ${id}`)

  const local = getPartnerLocal(id)
  const instance = local.instanceId ? getInstance(local.instanceId) : null

  // Recover by instance name if store lost but instance still exists
  if (!instance) {
    const byName = listInstances().find((i) => i.name === partner.instanceName)
    if (byName) {
      const recovered: PartnerLocalState = {
        id: partner.id,
        installed: true,
        instanceId: byName.id,
        installedAt: byName.createdAt,
      }
      const store = loadStore()
      store[partner.id] = recovered
      saveStore(store)
      return { partner, local: recovered, instance: byName }
    }
  }

  return { partner, local, instance }
}

function ensurePartnerServer(instanceId: string, partner: PartnerDefinition): void {
  try {
    ensureDefaultServer(getInstanceDir(instanceId), {
      name: partner.serverName,
      ip: partner.serverAddress,
      hideAddress: false,
    })
  } catch (err) {
    console.warn('[partners] failed to write servers.dat', err)
  }
}

/** Re-write servers.dat so the partner IP is always first / present before join. */
export async function preparePartnerJoin(id: string): Promise<{
  instanceId: string
  serverAddress: string
  serverName: string
}> {
  const status = await getPartnerStatus(id)
  if (!status.local.installed || !status.local.instanceId) {
    throw new Error('Install the partner pack first')
  }
  ensurePartnerServer(status.local.instanceId, status.partner)
  return {
    instanceId: status.local.instanceId,
    serverAddress: status.partner.serverAddress,
    serverName: status.partner.serverName,
  }
}

async function resolveLoaderVersion(
  loader: LoaderType,
  gameVersion: string,
): Promise<string | undefined> {
  if (loader === 'vanilla') return undefined
  const versions = await listLoaderVersions(loader, gameVersion)
  if (!versions.length) {
    throw new Error(`No ${loader} loader builds found for Minecraft ${gameVersion}`)
  }
  const stable = versions.find((v) => v.stable)
  return (stable || versions[0]).id
}

/**
 * Create (or reuse) the partner instance, install Fabric/runtime, default mods
 * (+ required deps), and write the default multiplayer server into servers.dat.
 */
export async function installPartner(
  id: string,
  onProgress?: (event: ProgressEvent) => void,
): Promise<PartnerStatus> {
  const partner = await getPartnerDefinition(id)
  if (!partner) throw new Error(`Unknown partner: ${id}`)

  const emit = (stage: string, progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
  }

  emit('prepare', 0.02, `Preparing ${partner.title}…`)

  let status = await getPartnerStatus(id)
  let instance = status.instance

  const loaderVersion = await resolveLoaderVersion(partner.loader, partner.gameVersion)

  if (!instance) {
    emit('instance', 0.06, `Creating instance “${partner.instanceName}”…`)
    instance =
      listInstances().find((i) => i.name === partner.instanceName) ||
      createInstance({
        name: partner.instanceName,
        gameVersion: partner.gameVersion,
        loader: partner.loader,
        loaderVersion,
      })
  }

  // Keep version/loader aligned with partner definition (e.g. vanilla → fabric)
  if (
    instance.gameVersion !== partner.gameVersion ||
    instance.loader !== partner.loader ||
    (loaderVersion && instance.loaderVersion !== loaderVersion)
  ) {
    instance = updateInstance(instance.id, {
      gameVersion: partner.gameVersion,
      loader: partner.loader,
      loaderVersion,
    })
  }

  ensurePartnerServer(instance.id, partner)
  emit('server', 0.1, `Added server ${partner.serverAddress}`)

  emit(
    'runtime',
    0.12,
    `Installing Minecraft ${partner.gameVersion} (${partner.loader}${
      loaderVersion ? ` ${loaderVersion}` : ''
    })…`,
  )
  await installInstanceRuntime(instance, (p) => {
    emit(p.stage, 0.12 + p.progress * 0.38, p.message)
  })

  // Refresh instance after runtime (metadata may be unchanged but mods install needs current)
  instance = getInstance(instance.id) || instance

  // Optional Modrinth modpack
  const packSlug = partner.modrinthPackSlug?.trim()
  if (packSlug) {
    try {
      emit('pack', 0.48, `Installing Modrinth pack ${packSlug}…`)
      await installFeaturedPack(
        { slug: packSlug },
        (p) => emit(p.stage, 0.48 + p.progress * 0.2, p.message),
      )
      // featured pack may create its own instance — re-bind if needed
      instance = getInstance(instance.id) || instance
    } catch (err) {
      console.warn('[partners] pack install failed, continuing with mods:', err)
    }
  }

  const modSlugs = partner.defaultMods || []
  if (modSlugs.length > 0) {
    const failures: string[] = []
    for (let i = 0; i < modSlugs.length; i++) {
      const slug = modSlugs[i]!
      const base = 0.5 + (i / modSlugs.length) * 0.45
      const span = 0.45 / modSlugs.length

      let title = slug
      try {
        const project = await getProject(slug)
        title = project.title
        emit('mods', base, `Installing ${title}…`)

        const versions = await getProjectVersions(
          project.id,
          partner.gameVersion,
          partner.loader === 'vanilla' ? undefined : partner.loader,
        )
        const version = versions[0]
        if (!version) {
          failures.push(`${title}: no ${partner.loader} build for ${partner.gameVersion}`)
          continue
        }

        const result = await installModWithDependencies({
          instanceId: instance.id,
          projectId: project.id,
          versionId: version.id,
          resolveDependencies: true,
          onProgress: (p) => {
            emit('mods', base + p.progress * span * 0.9, p.message)
          },
        })

        for (const f of result.failed) {
          failures.push(`${f.title || f.projectId}: ${f.error}`)
        }
      } catch (err) {
        failures.push(`${title}: ${(err as Error).message}`)
      }
    }

    if (failures.length) {
      console.warn('[partners] some mods failed:', failures)
      // Soft-fail only if every primary mod failed
      if (failures.length >= modSlugs.length) {
        throw new Error(`Failed to install partner mods:\n${failures.join('\n')}`)
      }
    }
  }

  const local: PartnerLocalState = {
    id: partner.id,
    installed: true,
    instanceId: instance.id,
    installedAt: new Date().toISOString(),
  }
  const store = loadStore()
  store[partner.id] = local
  saveStore(store)

  emit('done', 1, `${partner.title} is ready`)
  return {
    partner,
    local,
    instance: getInstance(instance.id),
  }
}
