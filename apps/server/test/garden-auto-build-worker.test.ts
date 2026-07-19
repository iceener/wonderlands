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

test('garden auto-build worker debounces source changes and rebuilds active scanned sites', async () => {
  const { app, config, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    GARDEN_WORKER_AUTO_START: 'false',
    NODE_ENV: 'test',
  })
  const admin = seedApiKeyAuth(runtime)
  let nowIso = '2026-04-03T00:00:00.000Z'
  runtime.services.clock.nowIso = () => nowIso

  const vaultRef = ensureWorkspaceVaultRef({
    accountId: admin.accountId,
    fileStorageRoot: config.files.storage.root,
    runtime,
    tenantId: admin.tenantId,
  })
  const sourceScopeRef = join(vaultRef, 'site')

  writeTextFile(
    join(sourceScopeRef, '_garden.yml'),
    `schema: garden/v1
title: Auto Garden
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
title: Auto Garden
---
Version 1.
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
    name: 'Auto Garden',
    slug: 'auto-garden',
    sourceScopePath: 'site',
    status: 'active',
  })

  assert.equal(site.ok, true)

  if (!site.ok) {
    throw new Error(site.error.message)
  }

  const worker = createGardenAutoBuildWorker({
    config,
    db: runtime.db,
    services: runtime.services,
  })

  assert.equal(await worker.processEligibleSites(), 0)

  let builds = gardenService.listBuilds(scope, site.value.id)
  assert.equal(builds.ok, true)

  if (!builds.ok) {
    throw new Error(builds.error.message)
  }

  assert.equal(builds.value.length, 0)

  nowIso = '2026-04-03T00:00:03.000Z'
  assert.equal(await worker.processEligibleSites(), 1)

  builds = gardenService.listBuilds(scope, site.value.id)
  assert.equal(builds.ok, true)

  if (!builds.ok) {
    throw new Error(builds.error.message)
  }

  assert.equal(builds.value.length, 1)
  assert.equal(builds.value[0]?.status, 'completed')
  assert.equal(builds.value[0]?.triggerKind, 'auto_scan')
  const publishedAfterFirstBuild = gardenService.getSiteById(scope, site.value.id)
  assert.equal(publishedAfterFirstBuild.ok, true)

  if (!publishedAfterFirstBuild.ok) {
    throw new Error(publishedAfterFirstBuild.error.message)
  }

  assert.equal(publishedAfterFirstBuild.value.currentPublishedBuildId, builds.value[0]?.id)

  const publishedFirstResponse = await app.request('http://local/auto-garden')
  const publishedFirstHtml = await publishedFirstResponse.text()

  assert.equal(publishedFirstResponse.status, 200)
  assert.match(publishedFirstHtml, /Version 1\./)

  nowIso = '2026-04-03T00:00:06.000Z'
  assert.equal(await worker.processEligibleSites(), 0)

  builds = gardenService.listBuilds(scope, site.value.id)
  assert.equal(builds.ok, true)

  if (!builds.ok) {
    throw new Error(builds.error.message)
  }

  assert.equal(builds.value.length, 1)

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Auto Garden
---
Version 2.
`,
  )

  nowIso = '2026-04-03T00:00:07.000Z'
  assert.equal(await worker.processEligibleSites(), 0)

  nowIso = '2026-04-03T00:00:10.000Z'
  assert.equal(await worker.processEligibleSites(), 1)

  builds = gardenService.listBuilds(scope, site.value.id)
  assert.equal(builds.ok, true)

  if (!builds.ok) {
    throw new Error(builds.error.message)
  }

  assert.equal(builds.value.length, 2)
  assert.equal(builds.value[0]?.status, 'completed')
  assert.equal(builds.value[0]?.triggerKind, 'auto_scan')
  assert.notEqual(
    builds.value[0]?.sourceFingerprintSha256,
    builds.value[1]?.sourceFingerprintSha256,
  )
  const publishedAfterSecondBuild = gardenService.getSiteById(scope, site.value.id)
  assert.equal(publishedAfterSecondBuild.ok, true)

  if (!publishedAfterSecondBuild.ok) {
    throw new Error(publishedAfterSecondBuild.error.message)
  }

  assert.equal(publishedAfterSecondBuild.value.currentPublishedBuildId, builds.value[0]?.id)

  const publishedSecondResponse = await app.request('http://local/auto-garden')
  const publishedSecondHtml = await publishedSecondResponse.text()

  assert.equal(publishedSecondResponse.status, 200)
  assert.match(publishedSecondHtml, /Version 2\./)
})
