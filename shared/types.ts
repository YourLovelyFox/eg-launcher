export type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge'

export type ProgressEvent = {
  stage: string
  progress: number
  message: string
}

export type MinecraftAccount = {
  id: string
  username: string
  uuid: string
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  skinUrl?: string
}

export type LauncherSettings = {
  ramMinMb: number
  ramMaxMb: number
  javaPath: string
  gameDirectory: string
  closeOnLaunch: boolean
  resolveDependencies: boolean
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
}

export type RunningGameInfo = {
  running: boolean
  instanceId: string | null
  instanceName: string | null
  pid: number | null
  startedAt: string | null
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }
