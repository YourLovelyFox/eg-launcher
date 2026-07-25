import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'

/**
 * Dev launcher (npm run dev / dist:admin): Admin ON
 * Public live build (npm run build / dist / CI): Admin OFF
 */
function resolveAdminEnabled(command: 'build' | 'serve'): boolean {
  const flag = process.env.EG_ENABLE_ADMIN
  if (flag === '1' || flag === 'true') return true
  if (flag === '0' || flag === 'false') return false
  // Default: admin only while developing (vite serve)
  return command === 'serve'
}

function adminDefine(enableAdmin: boolean): Record<string, string> {
  return {
    __EG_ENABLE_ADMIN__: JSON.stringify(enableAdmin),
  }
}

export default defineConfig(({ command }) => {
  const enableAdmin = resolveAdminEnabled(command)
  // eslint-disable-next-line no-console
  console.log(`[eg-launcher] Admin panel: ${enableAdmin ? 'ENABLED (dev)' : 'DISABLED (live)'}`)

  const define = adminDefine(enableAdmin)

  return {
    define,
    plugins: [
      react(),
      electron({
        main: {
          entry: 'electron/main.ts',
          vite: {
            define,
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: [
                  'electron',
                  'electron-updater',
                  'builder-util-runtime',
                  'fs-extra',
                  'js-yaml',
                  'lazy-val',
                  'lodash.escaperegexp',
                  'lodash.isequal',
                  'semver',
                  'tiny-typed-emitter',
                ],
              },
            },
          },
        },
        preload: {
          input: 'electron/preload.ts',
          vite: {
            define,
            build: {
              outDir: 'dist-electron',
            },
          },
        },
        renderer: {},
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@shared': path.resolve(__dirname, 'shared'),
      },
    },
    server: {
      port: 5173,
    },
    build: {
      outDir: 'dist',
    },
  }
})
