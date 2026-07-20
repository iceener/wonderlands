import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'

import { createWorkspaceService } from '../src/application/workspaces/workspace-service'
import { asAccountId, asTenantId } from '../src/shared/ids'
import { hashPassword } from '../src/shared/password'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { seedAuthSession } from './helpers/auth-session'
import { createTestHarness } from './helpers/create-test-app'

const now = '2026-04-03T00:00:00.000Z'

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
      nowIso: now,
    },
  )

  assert.equal(workspace.ok, true)

  if (!workspace.ok) {
    throw new Error(workspace.error.message)
  }

  return workspaceService.ensureVaultRef(workspace.value)
}

test('garden preview resolves tenant access from the authenticated browser session without a tenant header', async () => {
  const { app, config, runtime } = createTestHarness({
    AUTH_METHODS: 'auth_session',
    NODE_ENV: 'test',
  })
  const admin = seedAuthSession(runtime, {
    accountId: 'acc_preview_browser',
    tenantId: 'ten_preview_browser',
  })
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
title: Browser Preview
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
title: Browser Preview
---
Preview works from a browser session.
`,
  )

  const createResponse = await app.request('http://local/api/gardens', {
    body: JSON.stringify({
      name: 'Browser Preview',
      slug: 'browser_preview',
      sourceScopePath: 'site',
      status: 'active',
    }),
    headers: {
      ...admin.cookieHeader,
      'content-type': 'application/json',
      'x-tenant-id': admin.tenantId,
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()
  const gardenSiteId = createBody.data.id as string

  assert.equal(createResponse.status, 201)

  const buildResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/builds`,
    {
      body: JSON.stringify({}),
      headers: {
        ...admin.cookieHeader,
        'content-type': 'application/json',
        'x-tenant-id': admin.tenantId,
      },
      method: 'POST',
    },
  )

  assert.equal(buildResponse.status, 201)

  const previewResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview`,
    {
      headers: admin.cookieHeader,
    },
  )
  const previewHtml = await previewResponse.text()

  assert.equal(previewResponse.status, 200)
  assert.match(previewHtml, /Preview works from a browser session/)
})

test('non-default published gardens are served from their slug at the host root', async () => {
  const { app, config, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const admin = seedApiKeyAuth(runtime)
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
title: Slug Garden
navigation:
  - label: Home
    path: /
  - label: Demo
    path: /books/demo
public:
  roots:
    - index.md
    - books/demo.md
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Slug Garden
---
Served from a slug path.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'books', 'demo.md'),
    `---
title: Demo Page
---
Served from a slug child path.
`,
  )

  const createResponse = await app.request('http://local/api/gardens', {
    body: JSON.stringify({
      isDefault: false,
      name: 'Slug Garden',
      slug: 'slug-garden',
      sourceScopePath: 'site',
      status: 'active',
    }),
    headers: {
      ...admin.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()
  const gardenSiteId = createBody.data.id as string

  assert.equal(createResponse.status, 201)

  const buildResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/builds`,
    {
      body: JSON.stringify({}),
      headers: {
        ...admin.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(buildResponse.status, 201)

  const publishResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/publish`,
    {
      headers: admin.headers,
      method: 'POST',
    },
  )

  assert.equal(publishResponse.status, 200)

  const liveResponse = await app.request('http://local/slug-garden')
  const liveHtml = await liveResponse.text()

  assert.equal(liveResponse.status, 200)
  assert.match(liveHtml, /Served from a slug path\./)
  assert.match(liveHtml, /data-garden-link="internal" href="\/slug-garden\/books\/demo"/)

  const liveChildResponse = await app.request('http://local/slug-garden/books/demo')
  const liveChildHtml = await liveChildResponse.text()

  assert.equal(liveChildResponse.status, 200)
  assert.match(liveChildHtml, /Served from a slug child path\./)

  const prefixedResponse = await app.request('http://local/g/slug-garden')
  assert.equal(prefixedResponse.status, 404)
})

test('non-default protected routes render an unlock form that posts to the slug-scoped auth endpoint', async () => {
  const { app, config, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const admin = seedApiKeyAuth(runtime)
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
title: Locked Slug Garden
navigation:
  - label: Home
    path: /
public:
  roots:
    - index.md
    - members.md
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Locked Slug Garden
---
Public home.
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'members.md'),
    `---
title: Members
visibility: protected
---
Protected members page.
`,
  )

  const createResponse = await app.request('http://local/api/gardens', {
    body: JSON.stringify({
      isDefault: false,
      name: 'Locked Slug Garden',
      protectedAccessMode: 'site_password',
      protectedSecretRef: hashPassword('open-sesame'),
      slug: 'locked-garden',
      sourceScopePath: 'site',
      status: 'active',
    }),
    headers: {
      ...admin.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()
  const gardenSiteId = createBody.data.id as string

  assert.equal(createResponse.status, 201)

  const buildResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/builds`,
    {
      body: JSON.stringify({}),
      headers: {
        ...admin.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(buildResponse.status, 201)

  const publishResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/publish`,
    {
      headers: admin.headers,
      method: 'POST',
    },
  )

  assert.equal(publishResponse.status, 200)

  const lockedResponse = await app.request('http://local/locked-garden/members')
  const lockedHtml = await lockedResponse.text()

  assert.equal(lockedResponse.status, 401)
  assert.match(lockedHtml, /type="password"/i)
  assert.match(lockedHtml, /"\/locked-garden\/_auth\/unlock"/)
})
