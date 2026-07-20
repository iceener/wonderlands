import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { createWorkspaceService } from '../src/application/workspaces/workspace-service'
import { gardenBuilds, gardenSites, tenantMemberships } from '../src/db/schema'
import { asAccountId, asTenantId } from '../src/shared/ids'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const now = '2026-04-03T00:00:00.000Z'

const writeTextFile = (absolutePath: string, contents: string) => {
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, contents, 'utf8')
}

const ensureWorkspaceVaultRef = (input: {
  accountId: string
  adminAccountId: string
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
      accountId: asAccountId(input.adminAccountId),
      role: 'admin',
      tenantId: asTenantId(input.tenantId),
    },
    {
      accountId: asAccountId(input.accountId),
      nowIso: now,
    },
  )

  assert.equal(workspace.ok, true)

  if (!workspace.ok) {
    throw new Error(workspace.error.message)
  }

  return workspaceService.ensureVaultRef(workspace.value)
}

test('garden routes require owner or admin scope for site management and build triggers', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const admin = seedApiKeyAuth(runtime, {
    accountId: 'acc_admin',
    apiKeyId: 'key_admin',
    role: 'admin',
    secret: 'sk_admin_1234567890',
  })
  const member = seedApiKeyAuth(runtime, {
    accountId: 'acc_member',
    accountEmail: 'member@example.com',
    apiKeyId: 'key_member',
    includeMembership: false,
    includeTenant: false,
    role: 'member',
    secret: 'sk_member_1234567890',
    tenantId: admin.tenantId,
  })

  runtime.db
    .insert(tenantMemberships)
    .values({
      accountId: member.accountId,
      createdAt: now,
      id: 'mem_member',
      role: 'member',
      tenantId: admin.tenantId,
    })
    .run()

  runtime.db
    .insert(gardenSites)
    .values({
      buildMode: 'manual',
      createdAt: now,
      createdByAccountId: admin.accountId,
      currentBuildId: null,
      currentPublishedBuildId: null,
      deployMode: 'api_hosted',
      id: 'gst_existing',
      isDefault: false,
      name: 'Existing Garden',
      protectedAccessMode: 'none',
      protectedSecretRef: null,
      protectedSessionTtlSeconds: 86_400,
      slug: 'existing-garden',
      sourceScopePath: '.',
      status: 'draft',
      tenantId: admin.tenantId,
      updatedAt: now,
      updatedByAccountId: admin.accountId,
    })
    .run()

  const listResponse = await app.request('http://local/v1/gardens', {
    headers: member.headers,
    method: 'GET',
  })
  const listBody = await listResponse.json()

  assert.equal(listResponse.status, 403)
  assert.equal(listBody.ok, false)
  assert.equal(listBody.error.type, 'permission')

  const createResponse = await app.request('http://local/v1/gardens', {
    body: JSON.stringify({
      name: 'Member Garden',
      slug: 'member-garden',
    }),
    headers: {
      ...member.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()

  assert.equal(createResponse.status, 403)
  assert.equal(createBody.ok, false)
  assert.equal(createBody.error.type, 'permission')

  const buildResponse = await app.request('http://local/v1/gardens/gst_existing/builds', {
    body: JSON.stringify({}),
    headers: {
      ...member.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const buildBody = await buildResponse.json()

  assert.equal(buildResponse.status, 403)
  assert.equal(buildBody.ok, false)
  assert.equal(buildBody.error.type, 'permission')
})

test('garden routes can bootstrap a missing source scope without overwriting existing files', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
  const admin = seedApiKeyAuth(runtime)
  const vaultRef = ensureWorkspaceVaultRef({
    accountId: admin.accountId,
    adminAccountId: admin.accountId,
    fileStorageRoot: config.files.storage.root,
    runtime,
    tenantId: admin.tenantId,
  })

  const createResponse = await app.request('http://local/v1/gardens', {
    body: JSON.stringify({
      name: 'Bootstrap Garden',
      slug: 'bootstrap-garden',
      sourceScopePath: 'site',
    }),
    headers: {
      ...admin.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()
  const gardenSiteId = createBody.data.id as string
  const sourceScopeRef = join(vaultRef, 'site')

  assert.equal(createResponse.status, 201)

  const bootstrapResponse = await app.request(
    `http://local/v1/gardens/${encodeURIComponent(gardenSiteId)}/bootstrap-source`,
    {
      headers: admin.headers,
      method: 'POST',
    },
  )
  const bootstrapBody = await bootstrapResponse.json()

  assert.equal(bootstrapResponse.status, 200)
  assert.equal(bootstrapBody.ok, true)
  assert.deepEqual(bootstrapBody.data.createdPaths, [
    '_garden.yml',
    'index.md',
    'public/',
    '_meta/',
    '_meta/frontmatter.md',
  ])
  assert.deepEqual(bootstrapBody.data.skippedPaths, [])
  assert.equal(bootstrapBody.data.sourceScopePath, 'site')
  assert.equal(existsSync(join(sourceScopeRef, '_garden.yml')), true)
  assert.equal(existsSync(join(sourceScopeRef, 'index.md')), true)
  assert.equal(existsSync(join(sourceScopeRef, '_meta', 'frontmatter.md')), true)
  assert.equal(existsSync(join(sourceScopeRef, 'public')), true)
  assert.match(
    readFileSync(join(sourceScopeRef, '_garden.yml'), 'utf8'),
    /title: "Bootstrap Garden"/,
  )
  assert.match(
    readFileSync(join(sourceScopeRef, 'index.md'), 'utf8'),
    /Welcome to Bootstrap Garden/,
  )

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Bootstrap Garden
---

Custom homepage.
`,
  )

  const secondBootstrapResponse = await app.request(
    `http://local/v1/gardens/${encodeURIComponent(gardenSiteId)}/bootstrap-source`,
    {
      headers: admin.headers,
      method: 'POST',
    },
  )
  const secondBootstrapBody = await secondBootstrapResponse.json()

  assert.equal(secondBootstrapResponse.status, 200)
  assert.equal(secondBootstrapBody.ok, true)
  assert.deepEqual(secondBootstrapBody.data.createdPaths, [])
  assert.deepEqual(secondBootstrapBody.data.skippedPaths, [
    '_garden.yml',
    'index.md',
    'public/',
    '_meta/',
    '_meta/frontmatter.md',
  ])
  assert.match(readFileSync(join(sourceScopeRef, 'index.md'), 'utf8'), /Custom homepage\./)
})

test('garden routes reject overlapping builds for the same site', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const admin = seedApiKeyAuth(runtime)

  runtime.db
    .insert(gardenSites)
    .values({
      buildMode: 'manual',
      createdAt: now,
      createdByAccountId: admin.accountId,
      currentBuildId: null,
      currentPublishedBuildId: null,
      deployMode: 'api_hosted',
      id: 'gst_busy',
      isDefault: false,
      name: 'Busy Garden',
      protectedAccessMode: 'none',
      protectedSecretRef: null,
      protectedSessionTtlSeconds: 86_400,
      slug: 'busy-garden',
      sourceScopePath: '.',
      status: 'active',
      tenantId: admin.tenantId,
      updatedAt: now,
      updatedByAccountId: admin.accountId,
    })
    .run()

  runtime.db
    .insert(gardenBuilds)
    .values({
      completedAt: null,
      configFingerprintSha256: null,
      createdAt: now,
      errorMessage: null,
      id: 'gbd_running',
      manifestJson: null,
      protectedArtifactRoot: null,
      protectedPageCount: 0,
      publicArtifactRoot: null,
      publicPageCount: 0,
      requestedByAccountId: admin.accountId,
      siteId: 'gst_busy',
      sourceFingerprintSha256: null,
      startedAt: now,
      status: 'running',
      tenantId: admin.tenantId,
      triggerKind: 'manual',
      warningCount: 0,
    })
    .run()

  const buildResponse = await app.request('http://local/v1/gardens/gst_busy/builds', {
    body: JSON.stringify({}),
    headers: {
      ...admin.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const buildBody = await buildResponse.json()

  assert.equal(buildResponse.status, 409)
  assert.equal(buildBody.ok, false)
  assert.equal(buildBody.error.type, 'conflict')
  assert.match(buildBody.error.message, /already has an active build/i)
})

test('garden routes reassign the default site when a user picks a new one', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const admin = seedApiKeyAuth(runtime)

  const firstResponse = await app.request('http://local/v1/gardens', {
    body: JSON.stringify({
      isDefault: true,
      name: 'First Garden',
      slug: 'first-garden',
    }),
    headers: {
      ...admin.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const firstBody = await firstResponse.json()
  const firstSiteId = firstBody.data.id as string

  assert.equal(firstResponse.status, 201)
  assert.equal(firstBody.data.isDefault, true)

  const secondResponse = await app.request('http://local/v1/gardens', {
    body: JSON.stringify({
      name: 'Second Garden',
      slug: 'second-garden',
    }),
    headers: {
      ...admin.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const secondBody = await secondResponse.json()
  const secondSiteId = secondBody.data.id as string

  assert.equal(secondResponse.status, 201)
  assert.equal(secondBody.data.isDefault, false)

  const updateResponse = await app.request(
    `http://local/v1/gardens/${encodeURIComponent(secondSiteId)}`,
    {
      body: JSON.stringify({
        isDefault: true,
      }),
      headers: {
        ...admin.headers,
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )
  const updateBody = await updateResponse.json()

  assert.equal(updateResponse.status, 200)
  assert.equal(updateBody.data.isDefault, true)

  const firstSite = runtime.db
    .select()
    .from(gardenSites)
    .where(eq(gardenSites.id, firstSiteId))
    .get()
  const secondSite = runtime.db
    .select()
    .from(gardenSites)
    .where(eq(gardenSites.id, secondSiteId))
    .get()

  assert.equal(firstSite?.isDefault, false)
  assert.equal(secondSite?.isDefault, true)
})
