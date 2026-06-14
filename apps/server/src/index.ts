import { type ServerType, serve } from '@hono/node-server'

import { loadConfig } from './app/config'
import { createApp } from './app/create-app'
import { loadEnvFileIntoProcess } from './app/load-env'
import { closeAppRuntime, createAppRuntime, initializeAppRuntime } from './app/runtime'

loadEnvFileIntoProcess()

const config = loadConfig()
const runtime = await initializeAppRuntime(createAppRuntime(config))
const app = createApp(runtime)

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.server.host,
    port: config.server.port,
  },
  (info) => {
    runtime.services.logger.info('HTTP server listening', {
      apiBasePath: config.api.basePath,
      databasePath: config.database.path,
      host: config.server.host,
      port: info.port,
      subsystem: 'server',
    })
  },
)

const closeHttpServer = async (serverToClose: ServerType): Promise<void> => {
  if (
    'closeIdleConnections' in serverToClose &&
    typeof serverToClose.closeIdleConnections === 'function'
  ) {
    serverToClose.closeIdleConnections()
  }

  await new Promise<void>((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

let shutdownPromise: Promise<void> | null = null

const shutdown = async (signal: string) => {
  if (shutdownPromise) {
    return shutdownPromise
  }

  runtime.services.logger.info('Shutting down runtime', {
    signal,
    subsystem: 'server',
  })

  shutdownPromise = (async () => {
    await closeHttpServer(server)
    await closeAppRuntime(runtime)
    process.exit(0)
  })().catch((error) => {
    runtime.services.logger.error('Failed to shut down cleanly', {
      error: error instanceof Error ? error.message : 'Unknown shutdown failure',
      signal,
      subsystem: 'server',
    })
    process.exit(1)
  })

  return shutdownPromise
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})
