import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createGardenBuildRepository } from '../src/adapters/persistence/sqlite'
import { initializeAppRuntime } from '../src/app/runtime'
import { createGardenService } from '../src/application/garden/garden-service'
import { asAccountId, asGardenBuildId, asTenantId } from '../src/shared/ids'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

test('runtime startup fails queued and running Garden builds left by an interrupted process', async () => {
  const { config, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    GARDEN_WORKER_AUTO_START: 'false',
    NODE_ENV: 'test',
  })
  const admin = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(admin.accountId),
    role: 'admin' as const,
    tenantId: asTenantId(admin.tenantId),
  }
  const gardenService = createGardenService({
    apiBasePath: config.api.basePath,
    createId: runtime.services.ids.create,
    db: runtime.db,
    fileStorageRoot: config.files.storage.root,
    now: () => runtime.services.clock.nowIso(),
  })
  const site = gardenService.createSite(scope, {
    buildMode: 'debounced_scan',
    name: 'Recovery Garden',
    slug: 'recovery-garden',
    sourceScopePath: 'site',
    status: 'active',
  })

  assert.equal(site.ok, true)

  if (!site.ok) {
    throw new Error(site.error.message)
  }

  const buildRepository = createGardenBuildRepository(runtime.db)
  const queuedBuildId = asGardenBuildId('gbd_interrupted_queued')
  const runningBuildId = asGardenBuildId('gbd_interrupted_running')
  const completedBuildId = asGardenBuildId('gbd_already_completed')

  for (const build of [
    { id: queuedBuildId, status: 'queued' as const },
    { id: runningBuildId, startedAt: '2026-04-03T00:00:01.000Z', status: 'running' as const },
    {
      completedAt: '2026-04-03T00:00:02.000Z',
      id: completedBuildId,
      status: 'completed' as const,
    },
  ]) {
    const created = buildRepository.create(scope, {
      ...build,
      createdAt: '2026-04-03T00:00:00.000Z',
      requestedByAccountId: scope.accountId,
      siteId: site.value.id,
      triggerKind: 'auto_scan',
    })
    assert.equal(created.ok, true)
  }

  const restartTime = '2026-04-03T00:01:00.000Z'
  runtime.services.clock.nowIso = () => restartTime
  const startupWarnings: Array<{ fields?: Record<string, unknown>; message: string }> = []
  runtime.services.logger.warn = (message, fields) => {
    startupWarnings.push({ fields, message })
  }

  await initializeAppRuntime(runtime)

  for (const buildId of [queuedBuildId, runningBuildId]) {
    const recovered = buildRepository.getById(scope, buildId)
    assert.equal(recovered.ok, true)

    if (!recovered.ok) {
      throw new Error(recovered.error.message)
    }

    assert.equal(recovered.value.status, 'failed')
    assert.equal(recovered.value.completedAt, restartTime)
    assert.equal(
      recovered.value.errorMessage,
      'Garden build interrupted by application restart before completion',
    )
  }

  const completed = buildRepository.getById(scope, completedBuildId)
  assert.equal(completed.ok, true)

  if (!completed.ok) {
    throw new Error(completed.error.message)
  }

  assert.equal(completed.value.status, 'completed')
  assert.equal(completed.value.completedAt, '2026-04-03T00:00:02.000Z')
  assert.deepEqual(startupWarnings, [
    {
      fields: { recoveredBuildCount: 2 },
      message: 'Recovered interrupted Garden builds during startup',
    },
  ])
})
