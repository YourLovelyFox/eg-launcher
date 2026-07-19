/// <reference types="vite/client" />

import type { HiveApi } from '../electron/preload'

declare global {
  interface Window {
    hive: HiveApi
  }
}

export {}
