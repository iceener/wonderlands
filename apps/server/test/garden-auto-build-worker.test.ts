import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'

import { createGardenAutoBuildWorker } from '../src/application/garden/garden-auto-build-worker'
import { createGardenService } from '../src/application/garden/garden-service'
import { createWorkspaceService } from '../src/application/workspaces/workspace-service'
import { asAccountId, asTenantId } from '../src/shared/ids'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const writeTextFile = (absolutePath: string, contents: string) => {
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, contents, 'utf8')
}

const ensureWorkspaceVaultRef = (input: {
  accountId: string
  fileStorageRoot: string
  runtime: ReturnType<typeof createTestHarness>['runtime']
  tenantId: string
}) => {
  const workspaceService = createWorkspaceService(input.runtime.db, {
    createId: input.runtime.services.ids.create,
    fileStorageRoot: input.fileStorageRoot,
  })
  const workspace = workspaceService.ensureAccountWorkspace(
    {
      accountId: asAccountId(input.accountId),
      role: 'admin',
      tenantId: asTenantId(input.tenantId),
    },
    {
      nowIso: '2026-04-03T00:00:00.000Z',
    },
  )

  assert.equal(workspace.ok, true)

  if (!workspace.ok) {
    throw new Error(workspace.error.message)
  }

  return workspaceService.ensureVaultRef(workspace.value)
}

test('garden auto-build worker publishes a matching completed build without rebuilding it', async () => {
  const { config, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    GARDEN_WORKER_AUTO_START: 'false',
    NODE_ENV: 'test',
  })
  const admin = seedApiKeyAuth(runtime)
  const vaultRef = ensureWorkspaceVaultRef({
    accountId: admin.accountId,
    fileStorageRoot: config.files.storage.root,
    runtime,
    tenantId: admin.tenantId,
  })
  const sourceScopeRef = join(vaultRef, 'publish-gap-site')

  writeTextFile(
    join(sourceScopeRef, '_garden.yml'),
    `schema: garden/v1
title: Publish Gap Garden
navigation:
  - label: Home
    path: /
public:
  roots:
    - index.md
`,
  )
  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Publish Gap Garden
---
Ready to publish.
`,
  )

  const gardenService = createGardenService({
    apiBasePath: config.api.basePath,
    createId: runtime.services.ids.create,
    db: runtime.db,
    fileStorageRoot: config.files.storage.root,
    now: () => runtime.services.clock.nowIso(),
  })
  const scope = {
    accountId: asAccountId(admin.accountId),
    role: 'admin' as const,
    tenantId: asTenantId(admin.tenantId),
  }
  const site = gardenService.createSite(scope, {
    buildMode: 'debounced_scan',
    name: 'Publish Gap Garden',
    slug: 'publish-gap-garden',
    sourceScopePath: 'publish-gap-site',
    status: 'active',
  })

  assert.equal(site.ok, true)

  if (!site.ok) {
    throw new Error(site.error.message)
  }

  const completedBuild = await gardenService.requestBuild(scope, site.value.id, {
    triggerKind: 'manual',
  })
  assert.equal(completedBuild.ok, true)

  if (!completedBuild.ok) {
    throw new Error(completedBuild.error.message)
  }

  assert.equal(completedBuild.value.status, 'completed')
  const beforeRepair = gardenService.getSiteById(scope, site.value.id)
  assert.equal(beforeRepair.ok, true)

  if (!beforeRepair.ok) {
    throw new Error(beforeRepair.error.message)
  }

  assert.equal(beforeRepair.value.currentBuildId, completedBuild.value.id)
  assert.equal(beforeRepair.value.currentPublishedBuildId, null)

  const worker = createGardenAutoBuildWorker({
    config,
    db: runtime.db,
    services: runtime.services,
  })

  assert.equal(await worker.processEligibleSites(), 1)

  const builds = gardenService.listBuilds(scope, site.value.id)
  assert.equal(builds.ok, true)

  if (!builds.ok) {
    throw new Error(builds.error.message)
  }

  assert.equal(builds.value.length, 1)
  const afterRepair = gardenService.getSiteById(scope, site.value.id)
  assert.equal(afterRepair.ok, true)

  if (!afterRepair.ok) {
    throw new Error(afterRepair.error.message)
  }

  assert.equal(afterRepair.value.currentPublishedBuildId, completedBuild.value.id)
})
