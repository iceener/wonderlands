import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { createInternalCommandContext } from '../../src/application/commands/internal-command-context'
import { MCP_CODE_MODE_CONFIRMATION_TARGET_REF } from '../../src/application/mcp/code-mode'
import { toToolContext } from '../../src/application/runtime/execution/run-tool-execution'
import {
  buildSandboxBashWrapperScript,
  resolveSandboxJobGardenShortcut,
} from '../../src/application/sandbox/register-sandbox-native-tools'
import { SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF } from '../../src/application/sandbox/sandbox-delete-confirmation'
import {
  agentRevisions,
  mcpServers,
  mcpToolAssignments,
  runs,
  sandboxExecutions,
  sessionThreads,
  toolExecutions,
  workSessions,
} from '../../src/db/schema'
import { createGardenSiteRepository } from '../../src/domain/garden/garden-site-repository'
import { asAccountId, asAgentRevisionId, asGardenSiteId, asTenantId } from '../../src/shared/ids'
import { seedApiKeyAuth } from '../helpers/api-key-auth'
import { createTestHarness } from '../helpers/create-test-app'
import { grantNativeToolToDefaultAgent } from '../helpers/grant-native-tool-agent'

const now = '2026-04-05T06:00:00.000Z'

test('resolveSandboxJobGardenShortcut expands a garden slug into canonical /vault mount and cwd', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }

  const created = createGardenSiteRepository(runtime.db).create(scope, {
    buildMode: 'manual',
    createdAt: now,
    createdByAccountId: scope.accountId,
    deployMode: 'api_hosted',
    id: asGardenSiteId('gst_overment'),
    name: 'Overment',
    protectedAccessMode: 'none',
    protectedSessionTtlSeconds: 3600,
    slug: 'overment',
    sourceScopePath: 'overment',
    status: 'active',
    updatedAt: now,
    updatedByAccountId: scope.accountId,
  })

  assert.equal(created.ok, true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }

  const resolved = resolveSandboxJobGardenShortcut(runtime.db, {
    agentRevisionId: asAgentRevisionId('agr_default'),
    args: {
      garden: 'overment',
      source: {
        kind: 'inline_script',
        script: 'console.log("inspect")',
      },
      task: 'Inspect garden',
    },
    tenantScope: scope,
  })

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.equal(resolved.value.cwdVaultPath, '/vault/overment')
  assert.deepEqual(resolved.value.vaultInputs, [
    {
      mountPath: '/vault/overment',
      vaultPath: '/vault/overment',
    },
  ])
})

test('resolveSandboxJobGardenShortcut accepts a garden id selector', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }

  const created = createGardenSiteRepository(runtime.db).create(scope, {
    buildMode: 'manual',
    createdAt: now,
    createdByAccountId: scope.accountId,
    deployMode: 'api_hosted',
    id: asGardenSiteId('gst_overment'),
    name: 'Overment',
    protectedAccessMode: 'none',
    protectedSessionTtlSeconds: 3600,
    slug: 'overment',
    sourceScopePath: 'overment',
    status: 'active',
    updatedAt: now,
    updatedByAccountId: scope.accountId,
  })

  assert.equal(created.ok, true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }

  const resolved = resolveSandboxJobGardenShortcut(runtime.db, {
    agentRevisionId: asAgentRevisionId('agr_default'),
    args: {
      garden: 'gst_overment',
      source: {
        kind: 'inline_script',
        script: 'console.log("inspect")',
      },
      task: 'Inspect garden',
    },
    tenantScope: scope,
  })

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.equal(resolved.value.cwdVaultPath, '/vault/overment')
})

test('resolveSandboxJobGardenShortcut resolves relative write-back targets under the selected garden root', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }

  const created = createGardenSiteRepository(runtime.db).create(scope, {
    buildMode: 'manual',
    createdAt: now,
    createdByAccountId: scope.accountId,
    deployMode: 'api_hosted',
    id: asGardenSiteId('gst_overment'),
    name: 'Overment',
    protectedAccessMode: 'none',
    protectedSessionTtlSeconds: 3600,
    slug: 'overment',
    sourceScopePath: 'overment',
    status: 'active',
    updatedAt: now,
    updatedByAccountId: scope.accountId,
  })

  assert.equal(created.ok, true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }

  const resolved = resolveSandboxJobGardenShortcut(runtime.db, {
    agentRevisionId: asAgentRevisionId('agr_default'),
    args: {
      garden: 'overment',
      outputs: {
        writeBack: [
          {
            fromPath: '/output/note.md',
            mode: 'write',
            toVaultPath: 'books/jim-collins/how-the-mighty-fall.md',
          },
        ],
      },
      source: {
        kind: 'inline_script',
        script: 'console.log("inspect")',
      },
      task: 'Inspect garden',
    },
    tenantScope: scope,
  })

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.deepEqual(resolved.value.outputs?.writeBack, [
    {
      fromPath: '/output/note.md',
      mode: 'write',
      toVaultPath: '/vault/overment/books/jim-collins/how-the-mighty-fall.md',
    },
  ])
})

test('resolveSandboxJobGardenShortcut rewrites relative writeBack targets under the selected garden root', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }

  const created = createGardenSiteRepository(runtime.db).create(scope, {
    buildMode: 'manual',
    createdAt: now,
    createdByAccountId: scope.accountId,
    deployMode: 'api_hosted',
    id: asGardenSiteId('gst_overment'),
    name: 'Overment',
    protectedAccessMode: 'none',
    protectedSessionTtlSeconds: 3600,
    slug: 'overment',
    sourceScopePath: 'overment',
    status: 'active',
    updatedAt: now,
    updatedByAccountId: scope.accountId,
  })

  assert.equal(created.ok, true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }

  const translated = resolveSandboxJobGardenShortcut(runtime.db, {
    agentRevisionId: asAgentRevisionId('agr_default'),
    args: {
      garden: 'overment',
      mode: 'bash',
      outputs: {
        writeBack: [
          {
            fromPath: '/output/note.md',
            mode: 'write',
            toVaultPath: 'music/deep-house/nora.md',
          },
        ],
      },
      source: {
        kind: 'inline_script',
        script: 'grep -RIn "nora" /vault || true',
      },
      task: 'Inspect Nora notes',
    },
    tenantScope: scope,
  })

  assert.equal(translated.ok, true)
  if (!translated.ok) {
    throw new Error(translated.error.message)
  }

  assert.equal(translated.value.garden, 'overment')
  assert.equal(translated.value.cwdVaultPath, '/vault/overment')
  assert.deepEqual(translated.value.vaultInputs, [
    {
      mountPath: '/vault/overment',
      vaultPath: '/vault/overment',
    },
  ])
  assert.deepEqual(translated.value.outputs?.writeBack, [
    {
      fromPath: '/output/note.md',
      mode: 'write',
      toVaultPath: '/vault/overment/music/deep-house/nora.md',
    },
  ])
})

test('resolveSandboxJobGardenShortcut maps toVaultPath "." to the selected garden root', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }

  const created = createGardenSiteRepository(runtime.db).create(scope, {
    buildMode: 'manual',
    createdAt: now,
    createdByAccountId: scope.accountId,
    deployMode: 'api_hosted',
    id: asGardenSiteId('gst_overment'),
    name: 'Overment',
    protectedAccessMode: 'none',
    protectedSessionTtlSeconds: 3600,
    slug: 'overment',
    sourceScopePath: 'overment',
    status: 'active',
    updatedAt: now,
    updatedByAccountId: scope.accountId,
  })

  assert.equal(created.ok, true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }

  const resolved = resolveSandboxJobGardenShortcut(runtime.db, {
    agentRevisionId: asAgentRevisionId('agr_default'),
    args: {
      garden: 'overment',
      outputs: {
        writeBack: [
          {
            mode: 'delete',
            toVaultPath: '.',
          },
        ],
      },
      source: {
        kind: 'inline_script',
        script: 'console.log("inspect")',
      },
      task: 'Delete a page from the garden root',
    },
    tenantScope: scope,
  })

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.deepEqual(resolved.value.outputs?.writeBack, [
    {
      mode: 'delete',
      toVaultPath: '/vault/overment',
    },
  ])
})

test('execute schema omits runtime because runtime is selected server-side', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const tool = runtime.services.tools.get('execute')

  assert.ok(tool)
  assert.equal(Object.hasOwn(tool?.inputSchema.properties ?? {}, 'runtime'), false)
})

test('execute schema exposes source and package controls through one tool surface', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const tool = runtime.services.tools.get('execute')

  assert.ok(tool)
  assert.equal(Object.hasOwn(tool?.inputSchema.properties ?? {}, 'script'), true)
  assert.equal(Object.hasOwn(tool?.inputSchema.properties ?? {}, 'source'), true)
  assert.equal(Object.hasOwn(tool?.inputSchema.properties ?? {}, 'packages'), true)
})

test('execute tool description warns about local_dev native package limits', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const tool = runtime.services.tools.get('execute')
  const scriptSchema = tool?.inputSchema.properties?.script as Record<string, unknown> | undefined

  assert.ok(tool)
  assert.equal(tool?.description.includes('--ignore-scripts'), true)
  assert.equal(tool?.description.includes('sharp'), true)
  assert.equal(tool?.description.includes('prefer pure-JS packages'), true)
  assert.equal(tool?.description.includes('write a script body, not a full module'), true)
  assert.equal(tool?.description.includes('static top-level `import`/`export` is not'), true)
  assert.equal(
    (scriptSchema?.description as string | undefined)?.includes('--ignore-scripts'),
    true,
  )
  assert.equal(
    (scriptSchema?.description as string | undefined)?.includes(
      'write a script body, not a full module',
    ),
    true,
  )
})

test('execute rejects static import syntax early in MCP code mode script bodies', async () => {
  const { config, runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_mcp_code_mode_execute',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Sandbox Session',
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      branchFromMessageId: null,
      branchFromSequence: null,
      createdAt: now,
      createdByAccountId: accountId,
      id: 'thr_mcp_code_mode_execute',
      parentThreadId: null,
      sessionId: 'ses_mcp_code_mode_execute',
      status: 'active',
      tenantId,
      title: 'Sandbox Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      actorAccountId: accountId,
      agentId: null,
      agentRevisionId: null,
      completedAt: null,
      configSnapshot: {},
      createdAt: now,
      errorJson: null,
      id: 'run_mcp_code_mode_execute',
      jobId: null,
      lastProgressAt: now,
      parentRunId: null,
      resultJson: null,
      rootRunId: 'run_mcp_code_mode_execute',
      sessionId: 'ses_mcp_code_mode_execute',
      sourceCallId: null,
      startedAt: now,
      status: 'waiting',
      task: 'MCP code mode execute validation',
      targetKind: 'assistant',
      tenantId,
      threadId: 'thr_mcp_code_mode_execute',
      toolProfileId: null,
      updatedAt: now,
      workspaceId: null,
    })
    .run()

  const granted = grantNativeToolToDefaultAgent(runtime, 'execute')
  assert.ok(granted)

  runtime.db
    .update(agentRevisions)
    .set({
      sandboxPolicyJson: {
        enabled: true,
      },
      toolPolicyJson: {
        mcpMode: 'code',
        native: ['execute'],
        ...(granted?.toolProfileId ? { toolProfileId: granted.toolProfileId } : {}),
      },
    })
    .where(eq(agentRevisions.id, granted!.revisionId))
    .run()

  const tool = runtime.services.tools.get('execute')
  assert.ok(tool)

  const run = runtime.db.select().from(runs).where(eq(runs.id, 'run_mcp_code_mode_execute')).get()
  assert.ok(run)

  const context = toToolContext(
    createInternalCommandContext(
      {
        config,
        db: runtime.db,
        services: runtime.services,
      },
      scope,
    ),
    run,
    'call_execute_mcp_code_mode_validation',
  )

  const result = await tool.execute(context, {
    mode: 'script',
    source: {
      kind: 'inline_script',
      script: 'import sharp from "sharp";\nreturn { ok: true };',
    },
    task: 'Reject static import in MCP code mode',
  })

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('expected execute validation to fail before queueing sandbox execution')
  }

  assert.equal(result.error.type, 'validation')
  assert.match(result.error.message, /script body, not a full module/)
  assert.match(result.error.message, /await import\(\.\.\.\)/)
  assert.match(result.error.message, /line 1/)
})

test('execute returns a confirmation wait before queueing MCP code-mode scripts that call untrusted loaded tools', async () => {
  const { config, runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_mcp_code_mode_confirm',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Sandbox Session',
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      branchFromMessageId: null,
      branchFromSequence: null,
      createdAt: now,
      createdByAccountId: accountId,
      id: 'thr_mcp_code_mode_confirm',
      parentThreadId: null,
      sessionId: 'ses_mcp_code_mode_confirm',
      status: 'active',
      tenantId,
      title: 'Sandbox Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      actorAccountId: accountId,
      agentId: null,
      agentRevisionId: null,
      completedAt: null,
      configSnapshot: {},
      createdAt: now,
      errorJson: null,
      id: 'run_mcp_code_mode_confirm',
      jobId: null,
      lastProgressAt: now,
      parentRunId: null,
      resultJson: null,
      rootRunId: 'run_mcp_code_mode_confirm',
      sessionId: 'ses_mcp_code_mode_confirm',
      sourceCallId: null,
      startedAt: now,
      status: 'waiting',
      task: 'MCP code mode confirmation wait',
      targetKind: 'assistant',
      tenantId,
      threadId: 'thr_mcp_code_mode_confirm',
      toolProfileId: null,
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  const granted = grantNativeToolToDefaultAgent(runtime, 'execute')
  assert.ok(granted)

  runtime.db
    .update(agentRevisions)
    .set({
      sandboxPolicyJson: {
        enabled: true,
      },
      toolPolicyJson: {
        mcpMode: 'code',
        native: ['execute'],
        ...(granted?.toolProfileId ? { toolProfileId: granted.toolProfileId } : {}),
      },
      toolProfileId: granted?.toolProfileId ?? null,
    })
    .where(eq(agentRevisions.id, granted!.revisionId))
    .run()

  runtime.db
    .update(runs)
    .set({
      agentId: granted?.agentId ?? null,
      agentRevisionId: granted?.revisionId ?? null,
      targetKind: 'agent',
      toolProfileId: granted?.toolProfileId ?? null,
      updatedAt: now,
    })
    .where(eq(runs.id, 'run_mcp_code_mode_confirm'))
    .run()

  runtime.db
    .insert(mcpServers)
    .values({
      configJson: {
        args: ['fixture'],
        command: 'node',
      },
      createdAt: now,
      createdByAccountId: accountId,
      enabled: true,
      id: 'srv_spotify_confirm',
      kind: 'stdio',
      label: 'Spotify',
      scope: 'account_private',
      tenantId,
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(mcpToolAssignments)
    .values({
      approvedAt: null,
      approvedFingerprint: null,
      createdAt: now,
      id: 'mta_spotify_confirm',
      requiresConfirmation: true,
      runtimeName: 'spotify__spotify_control',
      serverId: 'srv_spotify_confirm',
      tenantId,
      toolProfileId: granted!.toolProfileId!,
      updatedAt: now,
    })
    .run()

  runtime.services.tools.register({
    description: 'Control Spotify playback.',
    domain: 'mcp',
    execute: async () => ({
      ok: true,
      value: {
        kind: 'immediate',
        output: { ok: true },
      },
    }),
    inputSchema: {
      type: 'object',
    },
    name: 'spotify__spotify_control',
  })

  runtime.db
    .insert(toolExecutions)
    .values({
      argsJson: {
        names: ['spotify.spotify_control'],
      },
      completedAt: now,
      createdAt: now,
      domain: 'native',
      durationMs: 1,
      errorText: null,
      id: 'call_get_tools_spotify',
      outcomeJson: {
        resolved: [
          {
            binding: 'spotify.spotify_control',
            runtimeName: 'spotify__spotify_control',
          },
        ],
      },
      runId: 'run_mcp_code_mode_confirm',
      startedAt: now,
      tenantId,
      tool: 'get_tools',
    })
    .run()

  const originalGetTool = runtime.services.mcp.getTool
  runtime.services.mcp.getTool = (runtimeName) =>
    runtimeName === 'spotify__spotify_control'
      ? ({
          apps: null,
          description: 'Control Spotify playback.',
          execution: null,
          fingerprint: 'fp_spotify_control_confirm',
          inputSchema: {
            type: 'object',
          },
          modelVisible: true,
          outputSchema: null,
          registrationSkippedReason: null,
          remoteName: 'spotify_control',
          remoteTool: {
            inputSchema: {
              type: 'object',
            },
            name: 'spotify_control',
          },
          runtimeName: 'spotify__spotify_control',
          serverId: 'srv_spotify_confirm',
          title: 'Spotify Control',
        } as const)
      : originalGetTool(runtimeName)

  try {
    const tool = runtime.services.tools.get('execute')
    assert.ok(tool)

    const run = runtime.db.select().from(runs).where(eq(runs.id, 'run_mcp_code_mode_confirm')).get()
    assert.ok(run)

    const context = toToolContext(
      createInternalCommandContext(
        {
          config,
          db: runtime.db,
          services: runtime.services,
        },
        scope,
      ),
      run,
      'call_execute_mcp_code_mode_confirm',
    )

    const result = await tool.execute(context, {
      mode: 'script',
      source: {
        kind: 'inline_script',
        script: 'await spotify.spotify_control({ operations: [] });\nreturn { ok: true };',
      },
      task: 'Confirm Spotify playback control',
    })

    assert.equal(result.ok, true)
    if (!result.ok) {
      throw new Error(result.error.message)
    }

    assert.equal(result.value.kind, 'waiting')
    if (result.value.kind !== 'waiting') {
      throw new Error('expected execute to return a confirmation wait')
    }

    assert.equal(result.value.wait.type, 'human')
    assert.equal(result.value.wait.targetKind, 'human_response')
    assert.equal(result.value.wait.targetRef, MCP_CODE_MODE_CONFIRMATION_TARGET_REF)
    assert.equal(runtime.db.select().from(sandboxExecutions).all().length, 0)
  } finally {
    runtime.services.mcp.getTool = originalGetTool
  }
})

test('execute returns a confirmation wait before queueing delete write-backs', async () => {
  const { config, runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_delete_writeback_confirm',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Sandbox Session',
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      branchFromMessageId: null,
      branchFromSequence: null,
      createdAt: now,
      createdByAccountId: accountId,
      id: 'thr_delete_writeback_confirm',
      parentThreadId: null,
      sessionId: 'ses_delete_writeback_confirm',
      status: 'active',
      tenantId,
      title: 'Sandbox Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      actorAccountId: accountId,
      agentId: null,
      agentRevisionId: null,
      completedAt: null,
      configSnapshot: {},
      createdAt: now,
      errorJson: null,
      id: 'run_delete_writeback_confirm',
      jobId: null,
      lastProgressAt: now,
      parentRunId: null,
      resultJson: null,
      rootRunId: 'run_delete_writeback_confirm',
      sessionId: 'ses_delete_writeback_confirm',
      sourceCallId: null,
      startedAt: now,
      status: 'waiting',
      task: 'Delete write-back confirmation wait',
      targetKind: 'assistant',
      tenantId,
      threadId: 'thr_delete_writeback_confirm',
      toolProfileId: null,
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  const granted = grantNativeToolToDefaultAgent(runtime, 'execute')
  assert.ok(granted)

  runtime.db
    .update(agentRevisions)
    .set({
      sandboxPolicyJson: {
        enabled: true,
        vault: {
          allowedRoots: ['/vault/overment'],
          mode: 'read_write',
          requireApprovalForDelete: true,
        },
      },
      toolPolicyJson: {
        native: ['execute'],
        ...(granted?.toolProfileId ? { toolProfileId: granted.toolProfileId } : {}),
      },
      toolProfileId: granted?.toolProfileId ?? null,
    })
    .where(eq(agentRevisions.id, granted!.revisionId))
    .run()

  runtime.db
    .update(runs)
    .set({
      agentId: granted?.agentId ?? null,
      agentRevisionId: granted?.revisionId ?? null,
      targetKind: 'agent',
      toolProfileId: granted?.toolProfileId ?? null,
      updatedAt: now,
    })
    .where(eq(runs.id, 'run_delete_writeback_confirm'))
    .run()

  const tool = runtime.services.tools.get('execute')
  assert.ok(tool)

  const run = runtime.db
    .select()
    .from(runs)
    .where(eq(runs.id, 'run_delete_writeback_confirm'))
    .get()
  assert.ok(run)

  const context = toToolContext(
    createInternalCommandContext(
      {
        config,
        db: runtime.db,
        services: runtime.services,
      },
      scope,
    ),
    run,
    'call_execute_delete_writeback_confirm',
  )

  const result = await tool.execute(context, {
    mode: 'bash',
    outputs: {
      writeBack: [
        {
          mode: 'delete',
          toVaultPath: '/vault/overment/music/obsolete.md',
        },
      ],
    },
    source: {
      kind: 'inline_script',
      script: 'printf "planned delete" > /output/delete-marker.txt',
    },
    task: 'Delete obsolete page',
  })

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }

  assert.equal(result.value.kind, 'waiting')
  if (result.value.kind !== 'waiting') {
    throw new Error('expected execute to return a delete confirmation wait')
  }

  assert.equal(result.value.wait.type, 'human')
  assert.equal(result.value.wait.targetKind, 'human_response')
  assert.equal(result.value.wait.targetRef, SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF)
  assert.equal(runtime.db.select().from(sandboxExecutions).all().length, 0)
})

test('execute schema keeps source provider-friendly for model adapters', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const tool = runtime.services.tools.get('execute')
  const sourceSchema = tool?.inputSchema.properties?.source as Record<string, unknown> | undefined

  assert.ok(tool)
  assert.equal(Array.isArray(sourceSchema?.oneOf), false)
  assert.equal(Array.isArray(tool?.inputSchema.required), true)
  assert.equal((tool?.inputSchema.required as string[]).includes('task'), true)
  assert.equal((tool?.inputSchema.required as string[]).includes('source'), false)
})

test('buildSandboxBashWrapperScript mounts read-only roots at their virtual mount points', () => {
  const script = buildSandboxBashWrapperScript({
    cwd: '/vault',
    mountVault: true,
    network: { mode: 'off' },
    script: 'ls /input && ls /vault',
    vaultWritable: false,
  })

  assert.equal(
    script.includes('new OverlayFs({ root: "/input", mountPoint: "/", readOnly: true })'),
    true,
  )
  assert.equal(
    script.includes('new OverlayFs({ root: "/vault", mountPoint: "/", readOnly: true })'),
    true,
  )
})
