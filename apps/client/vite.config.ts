/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import {
  apiProxyPathPattern,
  appShellBasePath,
  gardenLiveProxyPathPattern,
  normalizeProxyPath,
} from './src/lib/services/dev-proxy-routes'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:3000'
  const appShellBasePathWithoutSlash = appShellBasePath.replace(/\/+$/u, '')

  return {
    base: appShellBasePath,
    plugins: [
      {
        name: 'ai-shell-path-redirect',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === appShellBasePathWithoutSlash) {
              res.statusCode = 302
              res.setHeader('location', appShellBasePath)
              res.end()
              return
            }

            next()
          })
        },
      },
      tailwindcss(),
      svelte(),
    ],
    resolve: {
      alias: {
        '@wonderlands/contracts': fileURLToPath(
          new URL('../../packages/contracts/src', import.meta.url),
        ),
      },
    },
    server: {
      middlewareMode: false,
      port: 5173,
      proxy: {
        [apiProxyPathPattern.source]: {
          rewrite: normalizeProxyPath,
          target: backendOrigin,
        },
        [gardenLiveProxyPathPattern.source]: {
          rewrite: normalizeProxyPath,
          target: backendOrigin,
        },
      },
    },
    test: {
      globals: false,
      environment: 'node',
      include: ['src/**/*.test.ts', 'shared/**/*.test.ts'],
      setupFiles: ['./src/test-preload.ts'],
      restoreMocks: true,
    },
  }
})
