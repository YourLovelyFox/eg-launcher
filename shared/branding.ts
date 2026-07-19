/** App branding — single place for launcher name & permanent pack. */
export const APP_NAME = 'EG'
export const APP_TAGLINE = 'Launcher'
export const APP_FULL_NAME = 'EG Launcher'
/** Display version — keep in sync with package.json for UI; runtime uses app.getVersion(). */
export const APP_VERSION = '1.0.2'

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
} as const

/** Partner servers / SMPs pinned in the sidebar. Not auto-installed. */
export type PartnerDefinition = {
  id: string
  title: string
  menuLabel: string
  description: string
  /** Minecraft version for the default instance */
  gameVersion: string
  loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
  /** Multiplayer server added to servers.dat by default */
  serverAddress: string
  /** Display name of the server entry in the multiplayer list */
  serverName: string
  /** Instance name created for this partner */
  instanceName: string
  /**
   * Default mods installed with required dependencies (Modrinth slug or project id).
   * Empty for vanilla partners.
   */
  defaultMods: readonly string[]
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
    defaultMods: [
      'sodium', // Sodium
      'xaeros-minimap', // Xaero's Minimap
      'xaeros-world-map', // Xaero's World Map
      'appleskin', // AppleSkin
      '3dskinlayers', // 3D Skin Layers
      'zoomify', // Zoomify
    ],
  },
} as const satisfies Record<string, PartnerDefinition>

export const PARTNER_LIST: PartnerDefinition[] = Object.values(PARTNERS)
