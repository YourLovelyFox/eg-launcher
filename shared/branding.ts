/** App branding — single place for launcher name & permanent pack. */
export const APP_NAME = 'EG'
export const APP_TAGLINE = 'Launcher'
export const APP_FULL_NAME = 'EG Launcher'
/** Display version — keep in sync with package.json for UI; runtime uses app.getVersion(). */
export const APP_VERSION = '2.0.7'

import { resolveCmsApiBase } from './cmsApi'

/** Home news via HTTPS CMS API (MariaDB on server). */
export const DEFAULT_NEWS_FEED_URL = `${resolveCmsApiBase()}/news.php?kind=launcher`

/** Permanent featured modpack (Modrinth slug). Not auto-installed. */
export const FEATURED_PACK = {
  id: 'beessmp',
  slug: 'beessmp',
  projectId: 'kPorHsl4',
  title: "Bee's SMP",
  shortTitle: "Bee's SMP",
  description:
    'Heavy tech modpack with custom world generation, Leaving Earth, and space exploration.',
  menuLabel: "Bee's SMP",
  /**
   * Minimum total system RAM (rounded GB) required to install.
   * Below this, the pack is blocked — risk of system instability / BSoD.
   */
  minSystemRamGb: 12,
  /**
   * Recommended allocated Minecraft RAM (MB) for a good experience.
   * On 12 GB systems the launcher only allows ~6 GB (50%) — play is allowed with a warning.
   */
  recommendedAllocatedMb: 8192,
} as const

/** Partner servers / SMPs pinned in the sidebar. Not auto-installed. */
/** @deprecated Prefer PartnerConfig from shared/types — kept for built-in fallback */
export type PartnerDefinition = {
  id: string
  title: string
  menuLabel: string
  description: string
  gameVersion: string
  loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
  serverAddress: string
  serverName: string
  instanceName: string
  defaultMods: readonly string[]
  newsTag: string
  newsUsername?: string
  modrinthPackSlug?: string | null
  iconUrl?: string | null
}

export const PARTNERS = {
  horizonsSmp: {
    id: 'horizons-smp',
    title: 'Horizons SMP',
    menuLabel: 'Horizons SMP',
    description:
      'Official partner server. Fabric Minecraft with performance & QoL mods and the Horizons SMP multiplayer server ready to join.',
    gameVersion: '1.21.11',
    loader: 'fabric',
    serverAddress: 'play.horizons-smp.com',
    serverName: 'Horizons SMP',
    instanceName: 'Horizons SMP',
    newsTag: 'HorizonsSMP',
    newsUsername: 'HorizonsSMP',
    defaultMods: [
      'sodium', // Sodium
      'xaeros-minimap', // Xaero's Minimap
      'xaeros-world-map', // Xaero's World Map
      'appleskin', // AppleSkin
      '3dskinlayers', // 3D Skin Layers
      'zoomify', // Zoomify
    ],
    modrinthPackSlug: null,
    iconUrl: null,
  },
} as const satisfies Record<string, PartnerDefinition>

export const PARTNER_LIST: PartnerDefinition[] = Object.values(PARTNERS)
