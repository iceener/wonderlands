import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'

import { createWorkspaceService } from '../src/application/workspaces/workspace-service'
import { asAccountId, asTenantId } from '../src/shared/ids'
import { hashPassword } from '../src/shared/password'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const now = '2026-04-03T00:00:00.000Z'

const writeTextFile = (absolutePath: string, contents: string) => {
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, contents, 'utf8')
}

const extractCookieHeader = (setCookieHeader: string | null): string => {
  assert.ok(setCookieHeader)
  return setCookieHeader.split(';', 1)[0]
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

test('default garden serving keeps publish separate from preview and gates protected pages with unlock cookies', async () => {
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
title: Preview Garden
navigation:
  - label: Home
    path: /
public:
  roots:
    - index.md
    - protected.md
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Preview Garden
---
Public version 1.

Protected: [[protected]]

[Logo](public/logo.txt)
`,
  )

  writeTextFile(
    join(sourceScopeRef, 'protected.md'),
    `---
title: Protected Garden
visibility: protected
---
Protected version 1.
`,
  )

  writeTextFile(join(sourceScopeRef, 'public', 'logo.txt'), 'preview-logo-v1')

  const createResponse = await app.request('http://local/api/gardens', {
    body: JSON.stringify({
      isDefault: true,
      name: 'Preview Garden',
      protectedAccessMode: 'site_password',
      protectedSecretRef: hashPassword('open-sesame'),
      slug: 'preview_garden',
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

  const firstBuildResponse = await app.request(
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
  const firstBuildBody = await firstBuildResponse.json()

  assert.equal(firstBuildResponse.status, 201)
  assert.equal(firstBuildBody.data.status, 'completed')

  const statusResponse = await app.request('http://local/status')
  const statusBody = await statusResponse.json()

  assert.equal(statusResponse.status, 200)
  assert.equal(statusBody.status, 'ok')

  const unpublishedPublicResponse = await app.request('http://local/')
  const unpublishedPublicHtml = await unpublishedPublicResponse.text()
  assert.equal(unpublishedPublicResponse.status, 200)
  assert.match(unpublishedPublicHtml, /Publish a default garden to replace this page\./)
  assert.match(unpublishedPublicHtml, /href="\/ai\/"/)

  const unauthenticatedPreviewResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview`,
  )
  const unauthenticatedPreviewBody = await unauthenticatedPreviewResponse.json()

  assert.equal(unauthenticatedPreviewResponse.status, 401)
  assert.equal(unauthenticatedPreviewBody.ok, false)

  const previewResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview`,
    {
      headers: admin.headers,
    },
  )
  const previewHtml = await previewResponse.text()

  assert.equal(previewResponse.status, 200)
  assert.match(previewHtml, /Public version 1/)
  assert.match(previewHtml, /data-garden-search-root/)
  assert.match(previewHtml, /"protectedSearchState":"available"/)
  assert.match(
    previewHtml,
    new RegExp(`data-garden-link="internal" href="/api/gardens/${gardenSiteId}/preview/protected"`),
  )
  assert.match(
    previewHtml,
    new RegExp(
      `data-garden-link="internal" href="/api/gardens/${gardenSiteId}/preview/public/logo\\.txt"`,
    ),
  )

  const previewProtectedResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview/protected`,
    {
      headers: admin.headers,
    },
  )
  const previewProtectedHtml = await previewProtectedResponse.text()

  assert.equal(previewProtectedResponse.status, 200)
  assert.match(previewProtectedHtml, /Protected version 1/)

  const previewSearchResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview/_pagefind/public/pagefind.js`,
    {
      headers: admin.headers,
    },
  )
  const previewSearchBody = await previewSearchResponse.text()

  assert.equal(previewSearchResponse.status, 200)
  assert.match(previewSearchBody, /mergeIndex/)

  const previewProtectedSearchResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview/_pagefind/protected/pagefind.js`,
    {
      headers: admin.headers,
    },
  )

  assert.equal(previewProtectedSearchResponse.status, 200)

  const publishFirstResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/publish`,
    {
      headers: admin.headers,
      method: 'POST',
    },
  )
  const publishFirstBody = await publishFirstResponse.json()

  assert.equal(publishFirstResponse.status, 200)
  assert.equal(publishFirstBody.data.currentPublishedBuildId, firstBuildBody.data.id)

  const publicResponseV1 = await app.request('http://local/')
  const publicHtmlV1 = await publicResponseV1.text()

  assert.equal(publicResponseV1.status, 200)
  assert.match(publicHtmlV1, /Public version 1/)
  assert.match(publicHtmlV1, /data-garden-link="internal" href="\/protected"/)
  assert.match(publicHtmlV1, /data-garden-link="internal" href="\/public\/logo\.txt"/)
  assert.match(publicHtmlV1, /"protectedSearchState":"locked"/)

  const publicAssetResponse = await app.request('http://local/public/logo.txt')
  const publicAssetText = await publicAssetResponse.text()

  assert.equal(publicAssetResponse.status, 200)
  assert.equal(publicAssetText, 'preview-logo-v1')

  const publicSearchResponse = await app.request('http://local/_pagefind/public/pagefind.js')
  const publicSearchBody = await publicSearchResponse.text()

  assert.equal(publicSearchResponse.status, 200)
  assert.match(publicSearchBody, /mergeIndex/)

  const lockedProtectedSearchResponse = await app.request(
    'http://local/_pagefind/protected/pagefind.js',
  )

  assert.equal(lockedProtectedSearchResponse.status, 401)

  const lockedProtectedResponse = await app.request('http://local/protected')
  const lockedProtectedHtml = await lockedProtectedResponse.text()

  assert.equal(lockedProtectedResponse.status, 401)
  assert.match(lockedProtectedHtml, /password required/i)
  assert.match(lockedProtectedHtml, /type="password"/i)
  assert.match(lockedProtectedHtml, /\/_auth\/unlock/)

  const failedUnlockResponse = await app.request('http://local/_auth/unlock', {
    body: JSON.stringify({
      password: 'wrong-password',
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const failedUnlockBody = await failedUnlockResponse.json()

  assert.equal(failedUnlockResponse.status, 401)
  assert.equal(failedUnlockBody.ok, false)

  const successfulUnlockResponse = await app.request('http://local/_auth/unlock', {
    body: JSON.stringify({
      password: 'open-sesame',
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const unlockedCookie = extractCookieHeader(successfulUnlockResponse.headers.get('set-cookie'))

  assert.equal(successfulUnlockResponse.status, 200)

  const protectedResponseWithCookie = await app.request('http://local/protected', {
    headers: {
      cookie: unlockedCookie,
    },
  })
  const protectedHtmlWithCookie = await protectedResponseWithCookie.text()

  assert.equal(protectedResponseWithCookie.status, 200)
  assert.match(protectedHtmlWithCookie, /Protected version 1/)

  const unlockedProtectedSearchResponse = await app.request(
    'http://local/_pagefind/protected/pagefind.js',
    {
      headers: {
        cookie: unlockedCookie,
      },
    },
  )

  assert.equal(unlockedProtectedSearchResponse.status, 200)

  const publicResponseWithUnlock = await app.request('http://local/', {
    headers: {
      cookie: unlockedCookie,
    },
  })
  const publicHtmlWithUnlock = await publicResponseWithUnlock.text()

  assert.equal(publicResponseWithUnlock.status, 200)
  assert.match(publicHtmlWithUnlock, /"protectedSearchState":"available"/)

  writeTextFile(
    join(sourceScopeRef, 'index.md'),
    `---
title: Preview Garden
---
Public version 2.

Protected: [[protected]]

[Logo](public/logo.txt)
`,
  )
  writeTextFile(
    join(sourceScopeRef, 'protected.md'),
    `---
title: Protected Garden
visibility: protected
---
Protected version 2.
`,
  )
  writeTextFile(join(sourceScopeRef, 'public', 'logo.txt'), 'preview-logo-v2')

  const secondBuildResponse = await app.request(
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
  const secondBuildBody = await secondBuildResponse.json()

  assert.equal(secondBuildResponse.status, 201)
  assert.notEqual(secondBuildBody.data.id, firstBuildBody.data.id)

  const publicStillPublishedResponse = await app.request('http://local/')
  const publicStillPublishedHtml = await publicStillPublishedResponse.text()

  assert.equal(publicStillPublishedResponse.status, 200)
  assert.match(publicStillPublishedHtml, /Public version 1/)

  const previewResponseV2 = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview`,
    {
      headers: admin.headers,
    },
  )
  const previewHtmlV2 = await previewResponseV2.text()

  assert.equal(previewResponseV2.status, 200)
  assert.match(previewHtmlV2, /Public version 2/)

  const previewProtectedResponseV2 = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview/protected`,
    {
      headers: admin.headers,
    },
  )
  const previewProtectedHtmlV2 = await previewProtectedResponseV2.text()

  assert.equal(previewProtectedResponseV2.status, 200)
  assert.match(previewProtectedHtmlV2, /Protected version 2/)

  const stillPublishedProtectedResponse = await app.request('http://local/protected', {
    headers: {
      cookie: unlockedCookie,
    },
  })
  const stillPublishedProtectedHtml = await stillPublishedProtectedResponse.text()

  assert.equal(stillPublishedProtectedResponse.status, 200)
  assert.match(stillPublishedProtectedHtml, /Protected version 1/)

  const publishSecondResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/publish`,
    {
      headers: admin.headers,
      method: 'POST',
    },
  )
  const publishSecondBody = await publishSecondResponse.json()

  assert.equal(publishSecondResponse.status, 200)
  assert.equal(publishSecondBody.data.currentPublishedBuildId, secondBuildBody.data.id)

  const publicResponseV2 = await app.request('http://local/')
  const publicHtmlV2 = await publicResponseV2.text()

  assert.equal(publicResponseV2.status, 200)
  assert.match(publicHtmlV2, /Public version 2/)

  const staleCookieProtectedResponse = await app.request('http://local/protected', {
    headers: {
      cookie: unlockedCookie,
    },
  })

  assert.equal(staleCookieProtectedResponse.status, 401)

  const refreshedUnlockResponse = await app.request('http://local/_auth/unlock', {
    body: JSON.stringify({
      password: 'open-sesame',
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const refreshedUnlockCookie = extractCookieHeader(
    refreshedUnlockResponse.headers.get('set-cookie'),
  )

  assert.equal(refreshedUnlockResponse.status, 200)

  const protectedResponseV2 = await app.request('http://local/protected', {
    headers: {
      cookie: refreshedUnlockCookie,
    },
  })
  const protectedHtmlV2 = await protectedResponseV2.text()

  assert.equal(protectedResponseV2.status, 200)
  assert.match(protectedHtmlV2, /Protected version 2/)

  const lockResponse = await app.request('http://local/_auth/lock', {
    headers: {
      cookie: refreshedUnlockCookie,
    },
    method: 'POST',
  })
  const lockBody = await lockResponse.json()

  assert.equal(lockResponse.status, 200)
  assert.equal(lockBody.data.locked, true)

  const disableResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}`,
    {
      body: JSON.stringify({
        status: 'disabled',
      }),
      headers: {
        ...admin.headers,
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )

  assert.equal(disableResponse.status, 200)

  const disabledPublicResponse = await app.request('http://local/')
  const disabledPublicHtml = await disabledPublicResponse.text()
  assert.equal(disabledPublicResponse.status, 200)
  assert.match(disabledPublicHtml, /Publish a default garden to replace this page\./)

  const disabledPreviewResponse = await app.request(
    `http://local/api/gardens/${encodeURIComponent(gardenSiteId)}/preview`,
    {
      headers: admin.headers,
    },
  )
  const disabledPreviewHtml = await disabledPreviewResponse.text()

  assert.equal(disabledPreviewResponse.status, 200)
  assert.match(disabledPreviewHtml, /Public version 2/)
})
