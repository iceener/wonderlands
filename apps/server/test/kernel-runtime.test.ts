import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createKernelRuntimeService } from '../src/application/kernel/kernel-runtime-service'
import { createLogger } from '../src/shared/logger'

test('kernel runtime reports disabled status when the capability is off', async () => {
  let fetchCalls = 0
  const runtime = createKernelRuntimeService({
    config: {
      cloud: {
        apiKey: null,
        apiUrl: 'https://api.kernel.sh/',
      },
      enabled: false,
      local: {
        apiUrl: 'http://127.0.0.1:10001/',
        cdpUrl: 'http://127.0.0.1:9222/',
      },
      provider: 'local',
    },
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('fetch should not be called when kernel is disabled')
    },
    logger: createLogger('error'),
    now: () => '2026-04-07T00:00:00.000Z',
  })

  const availability = await runtime.initialize()

  assert.equal(availability.status, 'disabled')
  assert.equal(availability.available, false)
  assert.equal(fetchCalls, 0)
  assert.equal(runtime.getAdapter(), null)
})

test('kernel runtime marks local Kernel as ready when the local API and CDP probe succeed', async () => {
  const requestedUrls: string[] = []
  const runtime = createKernelRuntimeService({
    config: {
      cloud: {
        apiKey: null,
        apiUrl: 'https://api.kernel.sh/',
      },
      enabled: true,
      local: {
        apiUrl: 'http://127.0.0.1:10001/',
        cdpUrl: 'http://127.0.0.1:9222/',
      },
      provider: 'local',
    },
    fetchImpl: async (input) => {
      requestedUrls.push(String(input))

      return String(input).endsWith('/json/version')
        ? new Response(
            JSON.stringify({
              webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/example',
            }),
            {
              headers: {
                'content-type': 'application/json',
              },
              status: 200,
            },
          )
        : new Response('[]', {
            headers: {
              'content-type': 'application/json',
            },
            status: 200,
          })
    },
    logger: createLogger('error'),
    now: () => '2026-04-07T00:00:00.000Z',
  })

  const availability = await runtime.initialize()

  assert.deepEqual(requestedUrls, [
    'http://127.0.0.1:10001/recording/list',
    'http://127.0.0.1:9222/json/version',
  ])
  assert.equal(availability.status, 'ready')
  assert.equal(availability.available, true)
  assert.equal(availability.endpoint, 'http://127.0.0.1:10001/recording/list')
  assert.equal(runtime.getAdapter()?.provider, 'local')
})

test('kernel runtime still marks local Kernel as ready when the local API succeeds and the CDP probe returns 404', async () => {
  const runtime = createKernelRuntimeService({
    config: {
      cloud: {
        apiKey: null,
        apiUrl: 'https://api.kernel.sh/',
      },
      enabled: true,
      local: {
        apiUrl: 'http://127.0.0.1:10001/',
        cdpUrl: 'http://127.0.0.1:9222/',
      },
      provider: 'local',
    },
    fetchImpl: async (input) =>
      String(input).endsWith('/recording/list')
        ? new Response('[]', {
            headers: {
              'content-type': 'application/json',
            },
            status: 200,
          })
        : new Response(null, {
            status: 404,
          }),
    logger: createLogger('error'),
    now: () => '2026-04-07T00:00:00.000Z',
  })

  const availability = await runtime.initialize()

  assert.equal(availability.status, 'ready')
  assert.equal(availability.available, true)
  assert.match(
    availability.detail,
    /CDP probe .* failed with: kernel_local health check failed with HTTP 404/,
  )
  assert.equal(runtime.getAdapter()?.provider, 'local')
})
