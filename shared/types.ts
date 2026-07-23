export type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge'

/** Partner definition stored in CMS (private + public mirror). */
export type PartnerConfig = {
  id: string
  title: string
  menuLabel: string
  description: string
  gameVersion: string
  loader: LoaderType
  serverAddress: string
  serverName: string
  instanceName: string
  /** News tag e.g. HorizonsSMP */
  newsTag: string
  /** Login username for partner news portal */
  newsUsername: string
  /** Modrinth mod slugs/ids installed automatically */
  defaultMods: string[]
  /** Optional Modrinth modpack project slug/id */
  modrinthPackSlug?: string | null
  /** Optional icon URL (https) */
  iconUrl?: string | null
  /** Optional Discord invite / server URL */
  discordUrl?: string | null
  enabled?: boolean
}

/** Result of a Minecraft Server List Ping (or offline failure). */
export type MinecraftServerStatus = {
  online: boolean
  address: string
  host: string
  port: number
  latencyMs?: number
  version?: string | null
  playersOnline?: number | null
  playersMax?: number | null
  motd?: string | null
  error?: string
}

/** Local instance backup snapshot (folder under eg-data/backups). */
export type InstanceBackupInfo = {
  id: string
  instanceId: string
  instanceName: string
  createdAt: string
  label: string
  includeSaves: boolean
  sizeBytes: number
  gameVersion: string
  loader: LoaderType
  modCount: number
}

export type ProgressEvent = {
  stage: string
  progress: number
  message: string
}

export type MinecraftAccountType = 'microsoft' | 'offline'

export type MinecraftAccount = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  skinUrl?: string
  /** microsoft = paid MSA; offline = cracked / non-premium local account */
  type?: MinecraftAccountType
}

export type LauncherSettings = {
  ramMinMb: number
  ramMaxMb: number
  javaPath: string
  gameDirectory: string
  closeOnLaunch: boolean
  resolveDependencies: boolean
  /**
   * Legacy flag — offline login is always available on the Account page.
   * Kept for settings file compatibility; ignored by the app.
   */
  offlineModeEnabled?: boolean
}

/** Offline auth user record (password hash only — never plain passwords in the client). */
export type OfflineAuthUser = {
  id: string
  username: string
  passwordHash: string
  uuid: string
  displayName: string
  createdAt: string
}

export type OfflineAuthFile = {
  version: 1
  /** SHA-256 of the Settings unlock password (feature gate) */
  unlockPasswordHash: string | null
  users: OfflineAuthUser[]
}

/** Physical RAM + launcher allocation cap derived from total memory. */
export type SystemMemoryInfo = {
  /** Total physical memory in MB */
  totalMb: number
  /** Rounded GB (for tier matching; 8 GB sticks often report ~7.8) */
  totalGbRounded: number
  /** Max MB the launcher will allow for Minecraft (-Xmx) */
  maxAllowedMb: number
  /** Cap as percent of total (50 or 75) */
  allowedPercent: number
}

/**
 * Memory gate for heavy featured packs (e.g. Bee's SMP).
 * Enforced on install / play in main process + shown in the pack UI.
 */
export type FeaturedPackMemoryGate = {
  system: SystemMemoryInfo
  /** Current Settings max RAM (MB) */
  allocatedMb: number
  minSystemRamGb: number
  recommendedAllocatedMb: number
  /** False when total system RAM is below the pack's minimum */
  canInstall: boolean
  installBlockReason: string | null
  /**
   * User can allocate the recommended amount but currently has less set.
   * Play should be blocked until they raise Max RAM in Settings.
   */
  playNeedsMoreAllocated: boolean
  /**
   * System cannot allocate the recommended amount (e.g. 12 GB PC → 50% = 6 GB).
   * Play is allowed after an explicit low-memory warning.
   */
  playNeedsLowMemoryWarning: boolean
  /** Short label for UI, e.g. "6.0 GB" */
  maxAllowedLabel: string
  recommendedLabel: string
}

export type NewsTag = 'announcement' | 'update' | 'partner' | 'event' | 'info' | string

export type NewsItem = {
  id: string
  title: string
  summary?: string
  body?: string
  date: string
  tag?: NewsTag
  url?: string | null
}

export type NewsFeedResult = {
  title: string
  updated: string | null
  sourceUrl: string
  sourceType: 'json' | 'rss' | 'atom' | 'cache'
  items: NewsItem[]
  fromCache: boolean
  error?: string
}

export type InstalledMod = {
  projectId: string
  versionId: string
  slug: string
  title: string
  iconUrl?: string | null
  fileName: string
  versionNumber: string
  loaders: string[]
  gameVersions: string[]
  enabled: boolean
  downloadedAt: string
}

export type GameInstance = {
  id: string
  name: string
  gameVersion: string
  loader: LoaderType
  loaderVersion?: string
  createdAt: string
  lastPlayed?: string
  mods: InstalledMod[]
  iconColor?: string
}

export type ModrinthSearchHit = {
  project_id: string
  slug: string
  title: string
  description: string
  categories: string[]
  display_categories?: string[]
  client_side: string
  server_side: string
  project_type: string
  downloads: number
  icon_url: string | null
  author: string
  versions: string[]
  follows: number
  date_created: string
  date_modified: string
  latest_version: string
  license: string
  gallery?: string[]
  color?: number | null
}

export type ModrinthSearchResult = {
  hits: ModrinthSearchHit[]
  offset: number
  limit: number
  total_hits: number
}

export type ModrinthVersionFile = {
  hashes: { sha1: string; sha512: string }
  url: string
  filename: string
  primary: boolean
  size: number
  file_type: string | null
}

export type ModrinthDependency = {
  version_id: string | null
  project_id: string | null
  file_name: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export type ModrinthVersion = {
  id: string
  project_id: string
  name: string
  version_number: string
  changelog: string
  dependencies: ModrinthDependency[]
  game_versions: string[]
  version_type: 'release' | 'beta' | 'alpha'
  loaders: string[]
  featured: boolean
  status: string
  date_published: string
  downloads: number
  files: ModrinthVersionFile[]
}

export type ModrinthProject = {
  id: string
  slug: string
  title: string
  description: string
  categories: string[]
  client_side: string
  server_side: string
  body: string
  status: string
  project_type: string
  downloads: number
  followers: number
  icon_url: string | null
  color: number | null
  team: string
  published: string
  updated: string
  license: { id: string; name: string; url: string | null }
  versions: string[]
  game_versions: string[]
  loaders: string[]
  gallery: Array<{
    url: string
    featured: boolean
    title: string | null
    description: string | null
  }>
}

export type MinecraftVersionInfo = {
  id: string
  type: string
  url: string
  time: string
  releaseTime: string
}

export type LoaderVersionInfo = {
  id: string
  loader: LoaderType
  gameVersion: string
  stable: boolean
}

export type DeviceCodeResponse = {
  userCode: string
  deviceCode: string
  verificationUri: string
  expiresIn: number
  interval: number
  message: string
}

export type LaunchResult = {
  success: boolean
  message: string
  pid?: number
  /**
   * Soft gate (e.g. Bee's SMP on 12 GB PCs). UI should confirm, then re-launch
   * with `acknowledgeLowMemory: true`.
   */
  requiresConfirmation?: boolean
}

export type RunningGameInfo = {
  running: boolean
  instanceId: string | null
  instanceName: string | null
  pid: number | null
  startedAt: string | null
}

/** electron-updater status pushed to the renderer */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'unavailable'; currentVersion: string }
  | {
      state: 'available'
      currentVersion: string
      version: string
      releaseName: string | null
      releaseNotes: string | null
      releaseDate: string | null
    }
  | {
      state: 'downloading'
      currentVersion: string
      version: string
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | {
      state: 'ready'
      currentVersion: string
      version: string
      releaseName: string | null
      releaseNotes: string | null
    }
  | { state: 'error'; message: string; currentVersion: string }

export type AppVersionInfo = {
  version: string
  isPackaged: boolean
  platform: string
  arch: string
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }
