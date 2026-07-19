import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { onTestFinished, test } from 'vitest'

import { closeAppRuntime } from '../src/app/runtime'
import type { ToolContext } from '../src/application/tooling/tool-registry'
import { mcpToolAssignments } from '../src/db/schema'
import { createRunRepository } from '../src/adapters/persistence/sqlite/runtime/run-repository'
import { asAccountId, asRunId, asTenantId } from '../src/shared/ids'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createAsyncTestHarness } from './helpers/create-test-app'

const filesMcpPath = resolve(process.cwd(), '../../mcp/files-mcp/src/index.ts')

const writeMcpServersFile = (contents: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-workspace-scope-'))
  const filePath = join(dir, 'servers.json')
  writeFileSync(filePath, JSON.stringify(contents), 'utf8')
  return filePath
}

const bootstrapRun = async (
  app: ReturnType<typeof createAsyncTestHarness> extends Promise<infer THarness>
    ? THarness['app']
    : never,
  headers: Record<string, string>,
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Create a scoped workspace file',
      profile: 'default',
      title: 'Scoped files',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 201)
  return response.json()
}

const parseImmediateToolOutput = <TOutput>(result: {
  kind: 'immediate'
  output: {
    content?: Array<{ text?: string; type: string }>
  }
}): TOutput => JSON.parse(String(result.output.content?.[0]?.text)) as TOutput

const createToolContext = (
  runtime: Awaited<ReturnType<typeof createAsyncTestHarness>>['runtime'],
  run: NonNullable<
    ReturnType<typeof createRunRepository>['getById'] extends { value: infer TValue }
      ? TValue
      : never
  >,
  tenantId: string,
  accountId: string,
): ToolContext => ({
  createId: runtime.services.ids.create,
  db: runtime.db,
  nowIso: () => new Date().toISOString(),
  run,
  tenantScope: {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  },
  toolCallId: 'call_files_scope_1',
})

const assignMcpToolToProfile = (
  runtime: Awaited<ReturnType<typeof createAsyncTestHarness>>['runtime'],
  input: {
    runtimeName: string
    serverId: string
    tenantId: string
    toolProfileId: string
  },
) => {
  const createdAt = '2026-03-30T05:00:00.000Z'

  runtime.db
    .insert(mcpToolAssignments)
    .values({
      createdAt,
      id: `mta_${input.toolProfileId}_${input.runtimeName}`,
      requiresConfirmation: false,
      runtimeName: input.runtimeName,
      serverId: input.serverId,
      tenantId: input.tenantId,
      toolProfileId: input.toolProfileId,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .run()
}

test('workspace-scoped files MCP requires an explicit tool assignment for assistant runs', async () => {
  const filePath = writeMcpServersFile([
    {
      args: ['--import', 'tsx', filesMcpPath],
      command: process.execPath,
      id: 'workspace_files',
      kind: 'stdio',
      stderr: 'pipe',
      toolPrefix: 'files',
      workspaceScoped: 'account',
    },
  ])
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    MCP_SERVERS_FILE: filePath,
    NODE_ENV: 'test',
  })
  const { accountId, assistantToolProfileId, headers, tenantId } = seedApiKeyAuth(runtime)

  onTestFinished(async () => {
    rmSync(dirname(filePath), { force: true, recursive: true })
    await closeAppRuntime(runtime)
  })

  const bootstrap = await bootstrapRun(app, headers)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }
  const run = createRunRepository(runtime.db).getById(scope, asRunId(bootstrap.data.runId))
  const filesWriteTool = runtime.services.tools.get('files__fs_write')

  assert.ok(filesWriteTool)
  assert.equal(run.ok, true)

  if (!filesWriteTool || !run.ok) {
    return
  }

  const toolContext = createToolContext(runtime, run.value, tenantId, accountId)
  const denied = await filesWriteTool.execute(toolContext, {
    content: 'Blocked until the profile grants it.',
    operation: 'create',
    path: 'blocked.txt',
  })

  assert.equal(denied.ok, false)

  if (denied.ok) {
    return
  }

  assert.equal(denied.error.type, 'permission')
  assert.match(denied.error.message, /not assigned to tool profile/)

  assignMcpToolToProfile(runtime, {
    runtimeName: 'files__fs_write',
    serverId: 'workspace_files',
    tenantId,
    toolProfileId: assistantToolProfileId,
  })

  const allowed = await filesWriteTool.execute(toolContext, {
    content: 'Allowed after the profile grant.',
    operation: 'create',
    path: 'allowed.txt',
  })

  assert.equal(allowed.ok, true)
})

test('workspace-scoped files MCP writes into the account vault instead of run or shared roots', async () => {
  const filePath = writeMcpServersFile([
    {
      args: ['--import', 'tsx', filesMcpPath],
      command: process.execPath,
      id: 'workspace_files',
      kind: 'stdio',
      stderr: 'pipe',
      toolPrefix: 'files',
      workspaceScoped: 'account',
    },
  ])
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    MCP_SERVERS_FILE: filePath,
    NODE_ENV: 'test',
  })
  const { accountId, assistantToolProfileId, headers, tenantId } = seedApiKeyAuth(runtime)

  assignMcpToolToProfile(runtime, {
    runtimeName: 'files__fs_write',
    serverId: 'workspace_files',
    tenantId,
    toolProfileId: assistantToolProfileId,
  })

  onTestFinished(async () => {
    rmSync(dirname(filePath), { force: true, recursive: true })
    await closeAppRuntime(runtime)
  })

  const bootstrap = await bootstrapRun(app, headers)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }
  const run = createRunRepository(runtime.db).getById(scope, asRunId(bootstrap.data.runId))

  assert.equal(run.ok, true)
  assert.ok(run.value.workspaceRef)

  const filesWriteTool = runtime.services.tools.get('files__fs_write')

  assert.ok(filesWriteTool)

  if (!filesWriteTool || !run.ok) {
    return
  }

  const toolContext = createToolContext(runtime, run.value, tenantId, accountId)

  const result = await filesWriteTool.execute(toolContext, {
    content: 'Nicolas Cage belongs to the scoped run workspace.',
    operation: 'create',
    path: 'nicolas-cage.txt',
  })

  assert.equal(result.ok, true)

  if (!result.ok || result.value.kind !== 'immediate') {
    return
  }

  const parsedOutput = parseImmediateToolOutput<{
    applied?: boolean
    hint?: string
    path?: string
    result?: {
      diff?: string
    }
    success?: boolean
  }>(result.value)
  const expectedWorkspaceRoot = resolve(
    runtime.config.files.storage.root,
    '..',
    'workspaces',
    `ten_${tenantId}`,
    `acc_${accountId}`,
  )
  const vaultRef = join(expectedWorkspaceRoot, 'vault')
  const vaultFile = join(vaultRef, 'nicolas-cage.txt')
  const runWorkspaceFile = join(run.value.workspaceRef ?? '', 'nicolas-cage.txt')
  const sharedRootFile = resolve(
    runtime.config.files.storage.root,
    '..',
    'workspaces',
    'nicolas-cage.txt',
  )
  const scopedPrefix = relative(
    resolve(runtime.config.files.storage.root, '..', 'workspaces'),
    vaultRef,
  ).replace(/\\/g, '/')

  assert.equal(parsedOutput.path, 'nicolas-cage.txt')
  assert.equal(parsedOutput.success, true)
  assert.equal(parsedOutput.applied, true)
  assert.match(parsedOutput.hint ?? '', /File created at "nicolas-cage\.txt"/)
  assert.doesNotMatch(parsedOutput.hint ?? '', new RegExp(run.value.id))
  assert.match(parsedOutput.result?.diff ?? '', /--- a\/nicolas-cage\.txt\t/)
  assert.match(parsedOutput.result?.diff ?? '', /\+\+\+ b\/nicolas-cage\.txt\t/)
  assert.doesNotMatch(parsedOutput.result?.diff ?? '', new RegExp(scopedPrefix))
  assert.equal(existsSync(vaultFile), true)
  assert.equal(existsSync(run.value.workspaceRef ?? ''), false)
  assert.equal(existsSync(runWorkspaceFile), false)
  assert.equal(
    readFileSync(vaultFile, 'utf8'),
    'Nicolas Cage belongs to the scoped run workspace.\n',
  )
  assert.equal(existsSync(sharedRootFile), false)
})

test('workspace-scoped files MCP accepts /vault aliases for search without rewriting enum fields', async () => {
  const filePath = writeMcpServersFile([
    {
      args: ['--import', 'tsx', filesMcpPath],
      command: process.execPath,
      id: 'workspace_files',
      kind: 'stdio',
      stderr: 'pipe',
      toolPrefix: 'files',
      workspaceScoped: 'account',
    },
  ])
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    MCP_SERVERS_FILE: filePath,
    NODE_ENV: 'test',
  })
  const { accountId, assistantToolProfileId, headers, tenantId } = seedApiKeyAuth(runtime)

  for (const runtimeName of ['files__fs_manage', 'files__fs_search', 'files__fs_write']) {
    assignMcpToolToProfile(runtime, {
      runtimeName,
      serverId: 'workspace_files',
      tenantId,
      toolProfileId: assistantToolProfileId,
    })
  }

  onTestFinished(async () => {
    rmSync(dirname(filePath), { force: true, recursive: true })
    await closeAppRuntime(runtime)
  })

  const bootstrap = await bootstrapRun(app, headers)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }
  const run = createRunRepository(runtime.db).getById(scope, asRunId(bootstrap.data.runId))

  assert.equal(run.ok, true)

  const filesManageTool = runtime.services.tools.get('files__fs_manage')
  const filesWriteTool = runtime.services.tools.get('files__fs_write')
  const filesSearchTool = runtime.services.tools.get('files__fs_search')

  assert.ok(filesManageTool)
  assert.ok(filesWriteTool)
  assert.ok(filesSearchTool)

  if (!filesManageTool || !filesWriteTool || !filesSearchTool || !run.ok) {
    return
  }

  const toolContext = createToolContext(runtime, run.value, tenantId, accountId)

  const mkdirResult = await filesManageTool.execute(toolContext, {
    operation: 'mkdir',
    path: '/vault/notes',
    recursive: true,
  })

  assert.equal(mkdirResult.ok, true)

  const writeResult = await filesWriteTool.execute(toolContext, {
    content: '# Vault alias test',
    operation: 'create',
    path: '/vault/notes/index.md',
  })

  assert.equal(writeResult.ok, true)

  const searchResult = await filesSearchTool.execute(toolContext, {
    path: '/vault',
    query: 'index.md',
    target: 'filename',
  })

  assert.equal(searchResult.ok, true)

  if (!searchResult.ok || searchResult.value.kind !== 'immediate') {
    return
  }

  const parsedOutput = parseImmediateToolOutput<{
    hint?: string
    results?: {
      byFilename?: Array<{ path?: string }>
    }
    success?: boolean
  }>(searchResult.value)
  const expectedWorkspaceRoot = resolve(
    runtime.config.files.storage.root,
    '..',
    'workspaces',
    `ten_${tenantId}`,
    `acc_${accountId}`,
  )
  const vaultRef = join(expectedWorkspaceRoot, 'vault')
  const scopedPrefix = relative(
    resolve(runtime.config.files.storage.root, '..', 'workspaces'),
    vaultRef,
  ).replace(/\\/g, '/')

  assert.equal(parsedOutput.success, true)
  assert.deepEqual(parsedOutput.results?.byFilename?.map((entry) => entry.path), ['notes/index.md'])
  assert.match(parsedOutput.hint ?? '', /Found 1 file\(s\)\./)
  assert.doesNotMatch(JSON.stringify(parsedOutput), new RegExp(scopedPrefix))
})
