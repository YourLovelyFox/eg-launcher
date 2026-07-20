/** App branding — single place for launcher name & permanent pack. */
export const APP_NAME = 'EG'
export const APP_TAGLINE = 'Launcher'
export const APP_FULL_NAME = 'EG Launcher'
/** Display version — keep in sync with package.json for UI; runtime uses app.getVersion(). */
export const APP_VERSION = '1.0.7'

/**
 * News / partner content — CMS lives in private `eg-launcher-content`.
 * Live clients read public mirrors under `eg-launcher/news/`.
 * @see shared/contentRepo.ts
 */
export {
  CONTENT_OWNER as NEWS_GITHUB_OWNER,
  PUBLIC_REPO as NEWS_GITHUB_REPO,
  FEED_LAUNCHER_PUBLIC as NEWS_GITHUB_PATH,
  githubContentsApiUrl,
  rawGithubUrl,
  PUBLIC_OWNER,
  PUBLIC_BRANCH,
  FEED_LAUNCHER_PUBLIC,
  FEED_PARTNERS_PUBLIC,
} from './contentRepo'

import {
  githubContentsApiUrl,
  rawGithubUrl,
  PUBLIC_OWNER,
  PUBLIC_REPO,
  PUBLIC_BRANCH,
  FEED_LAUNCHER_PUBLIC,
  FEED_PARTNERS_PUBLIC,
} from './contentRepo'

/** Home news — public mirror (always readable without secrets). */
export const NEWS_GITHUB_API_URL = githubContentsApiUrl(
  PUBLIC_OWNER,
  PUBLIC_REPO,
  FEED_LAUNCHER_PUBLIC,
  PUBLIC_BRANCH,
)
export const DEFAULT_NEWS_FEED_URL = rawGithubUrl(
  PUBLIC_OWNER,
  PUBLIC_REPO,
  FEED_LAUNCHER_PUBLIC,
  PUBLIC_BRANCH,
)

/** Partner news feed (public mirror). */
export const PARTNER_NEWS_API_URL = githubContentsApiUrl(
  PUBLIC_OWNER,
  PUBLIC_REPO,
  FEED_PARTNERS_PUBLIC,
  PUBLIC_BRANCH,
)
export const PARTNER_NEWS_RAW_URL = rawGithubUrl(
  PUBLIC_OWNER,
  PUBLIC_REPO,
  FEED_PARTNERS_PUBLIC,
  PUBLIC_BRANCH,
)

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
