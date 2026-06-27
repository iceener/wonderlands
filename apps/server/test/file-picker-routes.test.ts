import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'vitest'

import { searchFilePicker } from '../src/application/files/file-picker-search'
import { fileLinks, files, workSessions } from '../src/db/schema'
import { asAccountId, asTenantId } from '../src/shared/ids'
import type { TenantScope } from '../src/shared/scope'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const seedSession = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    sessionId?: string
    tenantId: string
  },
) => {
  const now = '2026-03-29T00:00:00.000Z'
  const sessionId = input.sessionId ?? 'ses_picker'

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: input.accountId,
      deletedAt: null,
      id: sessionId,
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: input.tenantId,
      title: 'Picker session',
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  return sessionId
}

const seedWorkspaceFile = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    contents?: string
    relativePath: string
    tenantId: string
  },
) => {
  const vaultRoot = resolve(
    runtime.config.files.storage.root,
    '..',
    'workspaces',
    `ten_${input.tenantId}`,
    `acc_${input.accountId}`,
    'vault',
  )
  const absolutePath = join(vaultRoot, input.relativePath)
  const directoryPath = resolve(absolutePath, '..')

  mkdirSync(directoryPath, {
    recursive: true,
  })
  writeFileSync(absolutePath, input.contents ?? `contents for ${input.relativePath}`)
}

const seedAttachmentBlob = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    contents?: string
    storageKey: string
  },
) => {
  const absolutePath = resolve(runtime.config.files.storage.root, '..', input.storageKey)
  const directoryPath = resolve(absolutePath, '..')

  mkdirSync(directoryPath, {
    recursive: true,
  })
  writeFileSync(absolutePath, input.contents ?? `contents for ${input.storageKey}`)
}

test('file picker search ranks workspace matches and skips excluded folders', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  seedWorkspaceFile(runtime, {
    accountId,
    relativePath: 'README.md',
    tenantId,
  })
  seedWorkspaceFile(runtime, {
    accountId,
    relativePath: 'mcp/index.ts',
    tenantId,
  })
  seedWorkspaceFile(runtime, {
    accountId,
    relativePath: 'src/lib/file-search.ts',
    tenantId,
  })
  seedWorkspaceFile(runtime, {
    accountId,
    relativePath: 'dist/ignored.ts',
    tenantId,
  })

  const response = await app.request(
    'http://local/v1/file-picker/search?query=mcp%20index&limit=5',
    {
      headers,
    },
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data[0]?.source, 'workspace')
  assert.equal(body.data[0]?.relativePath, 'mcp/index.ts')
  assert.equal(body.data[0]?.mentionText, 'mcp/index.ts')
  assert.ok(
    body.data.every((item: { relativePath: string }) => item.relativePath !== 'dist/ignored.ts'),
  )
})

test('file picker search merges filesystem MCP folders as mount-qualified entries', async () => {
  const { runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  const mcpRoot = mkdtempSync(join(tmpdir(), 'file-picker-mcp-'))
  mkdirSync(join(mcpRoot, 'Projects'), { recursive: true })
  writeFileSync(join(mcpRoot, 'Projects', 'Alice.md'), '# Alice')

  const tenantScope: TenantScope = {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  }

  const result = await searchFilePicker(
    runtime.db,
    { query: 'alice', limit: 10 },
    {
      createId: runtime.services.ids.create,
      fileStorageRoot: runtime.config.files.storage.root,
      mcpFileRoots: [{ mountId: 'notes', rootPath: mcpRoot }],
      tenantScope,
    },
  )

  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }

  const mcpHit = result.value.find((item) => item.source === 'mcp')
  assert.ok(mcpHit, 'expected an mcp-sourced result')
  assert.equal(mcpHit?.relativePath, 'notes/Projects/Alice.md')
  assert.equal(mcpHit?.mentionText, 'notes/Projects/Alice.md')
  assert.equal(mcpHit?.label, 'Alice.md')
  assert.equal(mcpHit?.fileId, null)
})

test('file picker search merges durable attachments and session-visible files', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const sessionId = seedSession(runtime, {
    accountId,
    tenantId,
  })
  const now = '2026-03-29T00:00:00.000Z'

  runtime.db
    .insert(files)
    .values([
      {
        accessScope: 'account_library',
        checksumSha256: null,
        createdAt: now,
        createdByAccountId: accountId,
        createdByRunId: null,
        id: 'fil_library',
        metadata: null,
        mimeType: 'text/markdown',
        originUploadId: null,
        originalFilename: 'architecture.md',
        sizeBytes: 123,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/architecture--fil_library.md`,
        tenantId,
        title: null,
        updatedAt: now,
      },
      {
        accessScope: 'session_local',
        checksumSha256: null,
        createdAt: now,
        createdByAccountId: accountId,
        createdByRunId: null,
        id: 'fil_session',
        metadata: null,
        mimeType: 'text/plain',
        originUploadId: null,
        originalFilename: 'session-plan.txt',
        sizeBytes: 456,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/session-plan--fil_session.txt`,
        tenantId,
        title: null,
        updatedAt: now,
      },
    ])
    .run()

  runtime.db
    .insert(fileLinks)
    .values({
      createdAt: now,
      fileId: 'fil_session',
      id: 'flk_session',
      linkType: 'session',
      targetId: sessionId,
      tenantId,
    })
    .run()

  seedAttachmentBlob(runtime, {
    storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/architecture--fil_library.md`,
  })
  seedAttachmentBlob(runtime, {
    storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/session-plan--fil_session.txt`,
  })

  const accountLibraryResponse = await app.request(
    'http://local/v1/file-picker/search?query=architecture',
    {
      headers,
    },
  )
  const accountLibraryBody = await accountLibraryResponse.json()

  assert.equal(accountLibraryResponse.status, 200)
  assert.equal(accountLibraryBody.ok, true)
  assert.equal(accountLibraryBody.data[0]?.source, 'attachment')
  assert.equal(accountLibraryBody.data[0]?.fileId, 'fil_library')
  assert.equal(accountLibraryBody.data[0]?.mentionText, 'architecture.md')

  const sessionResponse = await app.request(
    `http://local/v1/file-picker/search?query=plan&sessionId=${sessionId}`,
    {
      headers,
    },
  )
  const sessionBody = await sessionResponse.json()

  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionBody.ok, true)
  assert.ok(
    sessionBody.data.some(
      (item: { fileId: string | null; source: string }) =>
        item.source === 'attachment' && item.fileId === 'fil_session',
    ),
  )

  const noSessionResponse = await app.request('http://local/v1/file-picker/search?query=plan', {
    headers,
  })
  const noSessionBody = await noSessionResponse.json()

  assert.equal(noSessionResponse.status, 200)
  assert.equal(noSessionBody.ok, true)
  assert.ok(
    noSessionBody.data.every((item: { fileId: string | null }) => item.fileId !== 'fil_session'),
  )
})
