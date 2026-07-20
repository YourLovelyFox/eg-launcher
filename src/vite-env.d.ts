/// <reference types="vite/client" />

import type { HiveApi } from '../electron/preload'

declare const __EG_ENABLE_ADMIN__: boolean

declare global {
  interface Window {
    hive: HiveApi
  }
}

export {}
