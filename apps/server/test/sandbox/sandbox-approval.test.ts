import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { createInternalCommandContext } from '../../src/application/commands/internal-command-context'
import { MCP_CODE_MODE_CONFIRMATION_TARGET_REF } from '../../src/application/mcp/code-mode'
import { toToolContext } from '../../src/application/runtime/execution/run-tool-execution'
import { resolveRunWait } from '../../src/application/runtime/waits/run-wait-resolution'
import { SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF } from '../../src/application/sandbox/sandbox-delete-confirmation'
import { createSandboxExecutionService } from '../../src/application/sandbox/sandbox-execution-service'
import { createWorkspaceService } from '../../src/application/workspaces/workspace-service'
import {
  agentRevisions,
  domainEvents,
  mcpServers,
  mcpToolAssignments,
  runDependencies,
  runs,
  sandboxExecutions,
  sessionThreads,
  toolExecutions,
  workSessions,
} from '../../src/db/schema'
import { createSandboxExecutionRepository } from '../../src/adapters/persistence/sqlite/sandbox/sandbox-execution-repository'
import { createSandboxWritebackRepository } from '../../src/adapters/persistence/sqlite/sandbox/sandbox-writeback-repository'
import {
  asAccountId,
  asJobId,
  asRunId,
  asSandboxExecutionId,
  asSandboxWritebackOperationId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
} from '../../src/shared/ids'
import type { TenantScope } from '../../src/shared/scope'
import { seedApiKeyAuth } from '../helpers/api-key-auth'
import { createTestHarness } from '../helpers/create-test-app'
import { grantNativeToolToDefaultAgent } from '../helpers/grant-native-tool-agent'

const now = '2026-04-04T10:00:00.000Z'
const sandboxCompletedAt = '2026-04-04T09:59:00.000Z'

const createScope = (input: { accountId: string; tenantId: string }): TenantScope => ({
  accountId: asAccountId(input.accountId),
  role: 'admin',
  tenantId: asTenantId(input.tenantId),
})

const seedSandboxRunGraph = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    runId?: string
    sessionId?: string
    tenantId: string
    threadId?: string
  },
) => {
  const sessionId = input.sessionId ?? 'ses_sandbox'
  const threadId = input.threadId ?? 'thr_sandbox'
  const runId = input.runId ?? 'run_sandbox'

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
      createdByAccountId: input.accountId,
      id: threadId,
      parentThreadId: null,
      sessionId,
      status: 'active',
      tenantId: input.tenantId,
      title: 'Sandbox Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      actorAccountId: input.accountId,
      agentId: null,
      agentRevisionId: null,
      completedAt: null,
      configSnapshot: {},
      createdAt: now,
      errorJson: null,
      id: runId,
      jobId: null,
      lastProgressAt: now,
      parentRunId: null,
      resultJson: null,
      rootRunId: runId,
      sessionId,
      sourceCallId: null,
      startedAt: now,
      status: 'waiting',
      task: 'Sandbox approval test',
      targetKind: 'assistant',
      tenantId: input.tenantId,
      threadId,
      toolProfileId: null,
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .update(workSessions)
    .set({
      rootRunId: runId,
    })
    .where(eq(workSessions.id, sessionId))
    .run()

  return {
    runId,
    sessionId,
    threadId,
  }
}

const queuePendingWritebackExecution = (input: {
  executionId: string
  graph: ReturnType<typeof seedSandboxRunGraph>
  runtime: ReturnType<typeof createTestHarness>['runtime']
  scope: TenantScope
  writeback?:
    | {
        mode: 'write'
        fromPath: string
        requiresApproval: boolean
        toVaultPath: string
      }
    | {
        mode: 'delete'
        requiresApproval: boolean
        toVaultPath: string
      }
}) => {
  const executionService = createSandboxExecutionService({
    db: input.runtime.db,
    provider: 'local_dev',
    supportedRuntimes: ['node'],
  })
  const writeback = input.writeback ?? {
    fromPath: '/output/similar-artists.md',
    mode: 'write' as const,
    requiresApproval: true,
    toVaultPath: '/vault/overment/music/similar-artists.md',
  }

  const queued = executionService.queueExecution(input.scope, {
    createdAt: now,
    executionId: asSandboxExecutionId(input.executionId),
    jobId: asJobId(`job_${input.executionId}`),
    policySnapshot: {
      enabled: true,
      network: {
        mode: 'off',
      },
      packages: {
        mode: 'disabled',
      },
      runtime: {
        allowWorkspaceScripts: false,
        maxDurationSec: 120,
        maxInputBytes: 25_000_000,
        maxMemoryMb: 512,
        maxOutputBytes: 25_000_000,
        nodeVersion: '22',
      },
      vault: {
        allowedRoots: ['/vault/overment'],
        mode: 'read_write',
        requireApprovalForDelete: true,
        requireApprovalForWrite: true,
      },
    },
    request: {
      network: {
        mode: 'off',
      },
      outputs: {
        writeBack: [writeback],
      },
      runtime: 'node',
      source: {
        kind: 'inline_script',
        script: 'console.log("prepare output")',
      },
      task: 'Prepare similar artists page',
      vaultAccess: 'read_write',
    },
    rootJobId: null,
    runId: asRunId(input.graph.runId),
    sessionId: asWorkSessionId(input.graph.sessionId),
    threadId: asSessionThreadId(input.graph.threadId),
    title: 'Sandbox execution',
    vaultAccessMode: 'read_write',
    writebacks: [
      writeback.mode === 'delete'
        ? {
            id: asSandboxWritebackOperationId(`sbw_${input.executionId}`),
            mode: 'delete' as const,
            requiresApproval: writeback.requiresApproval,
            toVaultPath: writeback.toVaultPath,
          }
        : {
            fromPath: writeback.fromPath,
            id: asSandboxWritebackOperationId(`sbw_${input.executionId}`),
            mode: writeback.mode,
            requiresApproval: writeback.requiresApproval,
            toVaultPath: writeback.toVaultPath,
          },
    ],
  })

  assert.equal(queued.ok, true)
  if (!queued.ok) {
    throw new Error('expected sandbox execution to queue')
  }

  const executionRepository = createSandboxExecutionRepository(input.runtime.db)
  const updated = executionRepository.update(input.scope, {
    completedAt: sandboxCompletedAt,
    durationMs: 42,
    errorText: null,
    externalSandboxId: null,
    id: asSandboxExecutionId(input.executionId),
    startedAt: sandboxCompletedAt,
    status: 'completed',
    stderrText: '',
    stdoutText: 'prepared',
  })

  assert.equal(updated.ok, true)
  if (!updated.ok) {
    throw new Error(updated.error.message)
  }

  return queued.value
}

const installExecuteMcpConfirmationFixture = (input: {
  accountId: string
  callId: string
  graph: ReturnType<typeof seedSandboxRunGraph>
  runtime: ReturnType<typeof createTestHarness>['runtime']
  tenantId: string
  waitId: string
}) => {
  const granted = grantNativeToolToDefaultAgent(input.runtime, 'execute')
  assert.ok(granted)
  assert.ok(granted?.toolProfileId)

  input.runtime.db
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

  input.runtime.db
    .update(runs)
    .set({
      agentId: granted?.agentId ?? null,
      agentRevisionId: granted?.revisionId ?? null,
      targetKind: 'agent',
      toolProfileId: granted?.toolProfileId ?? null,
      updatedAt: now,
    })
    .where(eq(runs.id, input.graph.runId))
    .run()

  input.runtime.db
    .insert(mcpServers)
    .values({
      configJson: {
        args: ['fixture'],
        command: 'node',
      },
      createdAt: now,
      createdByAccountId: input.accountId,
      enabled: true,
      id: 'srv_spotify_execute_confirm',
      kind: 'stdio',
      label: 'Spotify',
      scope: 'account_private',
      tenantId: input.tenantId,
      updatedAt: now,
    })
    .run()

  input.runtime.db
    .insert(mcpToolAssignments)
    .values({
      approvedAt: null,
      approvedFingerprint: null,
      createdAt: now,
      id: 'mta_spotify_execute_confirm',
      requiresConfirmation: true,
      runtimeName: 'spotify__spotify_control',
      serverId: 'srv_spotify_execute_confirm',
      tenantId: input.tenantId,
      toolProfileId: granted!.toolProfileId!,
      updatedAt: now,
    })
    .run()

  input.runtime.services.tools.register({
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

  input.runtime.db
    .insert(toolExecutions)
    .values([
      {
        argsJson: {
          names: ['spotify.spotify_control'],
        },
        completedAt: now,
        createdAt: now,
        domain: 'native',
        durationMs: 1,
        errorText: null,
        id: 'call_get_tools_spotify_execute_confirm',
        outcomeJson: {
          resolved: [
            {
              binding: 'spotify.spotify_control',
              runtimeName: 'spotify__spotify_control',
            },
          ],
        },
        runId: input.graph.runId,
        startedAt: now,
        tenantId: input.tenantId,
        tool: 'get_tools',
      },
      {
        argsJson: {
          mode: 'script',
          source: {
            kind: 'inline_script',
            script: 'await spotify.spotify_control({ operations: [] });\nreturn { ok: true };',
          },
          task: 'Confirm Spotify playback control',
        },
        completedAt: null,
        createdAt: now,
        domain: 'native',
        durationMs: null,
        errorText: null,
        id: input.callId,
        outcomeJson: null,
        runId: input.graph.runId,
        startedAt: now,
        tenantId: input.tenantId,
        tool: 'execute',
      },
    ])
    .run()

  input.runtime.db
    .insert(runDependencies)
    .values({
      callId: input.callId,
      createdAt: now,
      description: 'Approve execute script mode MCP tools before launching the sandbox',
      id: input.waitId,
      resolutionJson: null,
      resolvedAt: null,
      runId: input.graph.runId,
      status: 'pending',
      targetKind: 'human_response',
      targetRef: MCP_CODE_MODE_CONFIRMATION_TARGET_REF,
      targetRunId: null,
      tenantId: input.tenantId,
      timeoutAt: null,
      type: 'human',
    })
    .run()

  const originalGetTool = input.runtime.services.mcp.getTool
  input.runtime.services.mcp.getTool = (runtimeName) =>
    runtimeName === 'spotify__spotify_control'
      ? ({
          apps: null,
          description: 'Control Spotify playback.',
          execution: null,
          fingerprint: 'fp_spotify_control_execute_confirm',
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
          serverId: 'srv_spotify_execute_confirm',
          title: 'Spotify Control',
        } as const)
      : originalGetTool(runtimeName)

  return {
    restore: () => {
      input.runtime.services.mcp.getTool = originalGetTool
    },
  }
}

const installExecuteDeleteConfirmationFixture = (input: {
  accountId: string
  callId: string
  graph: ReturnType<typeof seedSandboxRunGraph>
  runtime: ReturnType<typeof createTestHarness>['runtime']
  targetVaultPath: string
  tenantId: string
  waitId: string
}) => {
  const granted = grantNativeToolToDefaultAgent(input.runtime, 'execute')
  assert.ok(granted)
  assert.ok(granted?.toolProfileId)

  input.runtime.db
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

  input.runtime.db
    .update(runs)
    .set({
      agentId: granted?.agentId ?? null,
      agentRevisionId: granted?.revisionId ?? null,
      targetKind: 'agent',
      toolProfileId: granted?.toolProfileId ?? null,
      updatedAt: now,
    })
    .where(eq(runs.id, input.graph.runId))
    .run()

  input.runtime.db
    .insert(toolExecutions)
    .values({
      argsJson: {
        mode: 'bash',
        outputs: {
          writeBack: [
            {
              mode: 'delete',
              toVaultPath: input.targetVaultPath,
            },
          ],
        },
        script: 'printf "planned delete" > /output/delete-marker.txt',
        task: 'Delete obsolete page',
      },
      completedAt: null,
      createdAt: now,
      domain: 'native',
      durationMs: null,
      errorText: null,
      id: input.callId,
      outcomeJson: null,
      runId: input.graph.runId,
      startedAt: now,
      tenantId: input.tenantId,
      tool: 'execute',
    })
    .run()

  input.runtime.db
    .insert(runDependencies)
    .values({
      callId: input.callId,
      createdAt: now,
      description: `Approve execute before launching a sandbox that may delete ${input.targetVaultPath}`,
      id: input.waitId,
      resolutionJson: null,
      resolvedAt: null,
      runId: input.graph.runId,
      status: 'pending',
      targetKind: 'human_response',
      targetRef: SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF,
      targetRunId: null,
      tenantId: input.tenantId,
      timeoutAt: null,
      type: 'human',
    })
    .run()
}

test('commit_sandbox_writeback asks for approval when selected writebacks are pending', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    tenantId,
  })

  queuePendingWritebackExecution({
    executionId: 'sbx_pending_confirmation',
    graph,
    runtime,
    scope,
  })

  const tool = runtime.services.tools.get('commit_sandbox_writeback')
  assert.ok(tool)

  const run = runtime.db.select().from(runs).get()
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
    'call_commit_wait',
  )

  const result = await tool.execute(context, {
    sandboxExecutionId: 'sbx_pending_confirmation',
  })

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }

  assert.equal(result.value.kind, 'waiting')
  if (result.value.kind !== 'waiting') {
    throw new Error('expected waiting result')
  }

  assert.equal(result.value.wait.type, 'human')
  assert.equal(result.value.wait.targetKind, 'human_response')
  assert.equal(result.value.wait.targetRef, 'sandbox_writeback:sbx_pending_confirmation')
})

test('approving sandbox writeback confirmation applies the file into the vault', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    tenantId,
    runId: 'run_sandbox_commit',
    sessionId: 'ses_sandbox_commit',
    threadId: 'thr_sandbox_commit',
  })

  queuePendingWritebackExecution({
    executionId: 'sbx_commit_apply',
    graph,
    runtime,
    scope,
  })

  const workspaceService = createWorkspaceService(runtime.db, {
    createId: runtime.services.ids.create,
    fileStorageRoot: config.files.storage.root,
  })
  const workspace = workspaceService.ensureAccountWorkspace(scope, {
    nowIso: now,
  })

  assert.equal(workspace.ok, true)
  if (!workspace.ok) {
    throw new Error(workspace.error.message)
  }

  const layout = workspaceService.buildLayout(workspace.value, graph.sessionId, graph.runId)
  const sandboxHostRoot = join(layout.runRef, 'sandboxes', 'sbx_commit_apply')
  mkdirSync(join(sandboxHostRoot, 'output'), { recursive: true })
  writeFileSync(
    join(sandboxHostRoot, 'output', 'similar-artists.md'),
    '# Similar artists\n\n- Tinlicker\n',
    'utf8',
  )

  runtime.db
    .insert(toolExecutions)
    .values({
      argsJson: {
        sandboxExecutionId: 'sbx_commit_apply',
      },
      completedAt: null,
      createdAt: now,
      domain: 'native',
      durationMs: null,
      errorText: null,
      id: 'call_commit_apply',
      outcomeJson: null,
      runId: graph.runId,
      startedAt: now,
      tenantId,
      tool: 'commit_sandbox_writeback',
    })
    .run()

  runtime.db
    .insert(runDependencies)
    .values({
      callId: 'call_commit_apply',
      createdAt: now,
      description:
        'Approve applying sandbox write-back into /vault/overment/music/similar-artists.md',
      id: 'wte_commit_apply',
      resolutionJson: null,
      resolvedAt: null,
      runId: graph.runId,
      status: 'pending',
      targetKind: 'human_response',
      targetRef: 'sandbox_writeback:sbx_commit_apply',
      targetRunId: null,
      tenantId,
      timeoutAt: null,
      type: 'human',
    })
    .run()

  const resolved = await resolveRunWait(
    createInternalCommandContext(
      {
        config,
        db: runtime.db,
        services: runtime.services,
      },
      scope,
    ),
    asRunId(graph.runId),
    {
      approve: true,
      waitId: 'wte_commit_apply',
    },
  )

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.equal(resolved.value.kind, 'ready_to_resume')

  const writebacks = createSandboxWritebackRepository(runtime.db).listBySandboxExecutionId(
    scope,
    asSandboxExecutionId('sbx_commit_apply'),
  )
  assert.equal(writebacks.ok, true)
  if (!writebacks.ok) {
    throw new Error(writebacks.error.message)
  }

  assert.equal(writebacks.value[0]?.status, 'applied')
  assert.ok(writebacks.value[0]?.approvedAt)
  assert.ok(writebacks.value[0]?.appliedAt)
  assert.notEqual(writebacks.value[0]?.approvedAt, sandboxCompletedAt)
  assert.notEqual(writebacks.value[0]?.appliedAt, sandboxCompletedAt)
  assert.equal(writebacks.value[0]?.approvedAt, writebacks.value[0]?.appliedAt)
  assert.notEqual(writebacks.value[0]?.appliedAt, sandboxCompletedAt)

  const targetPath = join(layout.vaultRef, 'overment', 'music', 'similar-artists.md')
  assert.equal(readFileSync(targetPath, 'utf8'), '# Similar artists\n\n- Tinlicker\n')

  const toolExecution = runtime.db.select().from(toolExecutions).get()
  assert.deepEqual(toolExecution?.outcomeJson, {
    applied: [
      {
        id: 'sbw_sbx_commit_apply',
        operation: 'write',
        targetVaultPath: '/vault/overment/music/similar-artists.md',
      },
    ],
    sandboxExecutionId: 'sbx_commit_apply',
    skipped: [],
  })
})

test('approving sandbox writeback confirmation deletes the file from the vault', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    tenantId,
    runId: 'run_sandbox_delete',
    sessionId: 'ses_sandbox_delete',
    threadId: 'thr_sandbox_delete',
  })

  queuePendingWritebackExecution({
    executionId: 'sbx_commit_delete',
    graph,
    runtime,
    scope,
    writeback: {
      fromPath: '/output/delete-marker.txt',
      mode: 'delete',
      requiresApproval: true,
      toVaultPath: '/vault/overment/music/obsolete.md',
    },
  })

  const workspaceService = createWorkspaceService(runtime.db, {
    createId: runtime.services.ids.create,
    fileStorageRoot: config.files.storage.root,
  })
  const workspace = workspaceService.ensureAccountWorkspace(scope, {
    nowIso: now,
  })

  assert.equal(workspace.ok, true)
  if (!workspace.ok) {
    throw new Error(workspace.error.message)
  }

  const layout = workspaceService.buildLayout(workspace.value, graph.sessionId, graph.runId)
  const targetPath = join(layout.vaultRef, 'overment', 'music', 'obsolete.md')
  mkdirSync(join(layout.vaultRef, 'overment', 'music'), { recursive: true })
  writeFileSync(targetPath, '# Obsolete\n', 'utf8')

  runtime.db
    .insert(toolExecutions)
    .values({
      argsJson: {
        sandboxExecutionId: 'sbx_commit_delete',
      },
      completedAt: null,
      createdAt: now,
      domain: 'native',
      durationMs: null,
      errorText: null,
      id: 'call_commit_delete',
      outcomeJson: null,
      runId: graph.runId,
      startedAt: now,
      tenantId,
      tool: 'commit_sandbox_writeback',
    })
    .run()

  runtime.db
    .insert(runDependencies)
    .values({
      callId: 'call_commit_delete',
      createdAt: now,
      description: 'Approve applying sandbox write-back into /vault/overment/music/obsolete.md',
      id: 'wte_commit_delete',
      resolutionJson: null,
      resolvedAt: null,
      runId: graph.runId,
      status: 'pending',
      targetKind: 'human_response',
      targetRef: 'sandbox_writeback:sbx_commit_delete',
      targetRunId: null,
      tenantId,
      timeoutAt: null,
      type: 'human',
    })
    .run()

  const resolved = await resolveRunWait(
    createInternalCommandContext(
      {
        config,
        db: runtime.db,
        services: runtime.services,
      },
      scope,
    ),
    asRunId(graph.runId),
    {
      approve: true,
      waitId: 'wte_commit_delete',
    },
  )

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.equal(resolved.value.kind, 'ready_to_resume')

  const writebacks = createSandboxWritebackRepository(runtime.db).listBySandboxExecutionId(
    scope,
    asSandboxExecutionId('sbx_commit_delete'),
  )
  assert.equal(writebacks.ok, true)
  if (!writebacks.ok) {
    throw new Error(writebacks.error.message)
  }

  assert.equal(writebacks.value[0]?.status, 'applied')
  assert.equal(writebacks.value[0]?.operation, 'delete')
  assert.notEqual(writebacks.value[0]?.approvedAt, sandboxCompletedAt)
  assert.notEqual(writebacks.value[0]?.appliedAt, sandboxCompletedAt)
  assert.equal(writebacks.value[0]?.approvedAt, writebacks.value[0]?.appliedAt)
  assert.equal(existsSync(targetPath), false)

  const toolExecution = runtime.db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.id, 'call_commit_delete'))
    .get()
  assert.deepEqual(toolExecution?.outcomeJson, {
    applied: [
      {
        id: 'sbw_sbx_commit_delete',
        operation: 'delete',
        targetVaultPath: '/vault/overment/music/obsolete.md',
      },
    ],
    sandboxExecutionId: 'sbx_commit_delete',
    skipped: [],
  })
})

test('failed sandbox waits promote sandbox failure summary into the top-level tool error', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    tenantId,
    runId: 'run_sandbox_failure',
    sessionId: 'ses_sandbox_failure',
    threadId: 'thr_sandbox_failure',
  })

  runtime.db
    .insert(toolExecutions)
    .values({
      argsJson: {
        mode: 'script',
        task: 'Resize image',
      },
      completedAt: null,
      createdAt: now,
      domain: 'native',
      durationMs: null,
      errorText: null,
      id: 'call_execute_fail',
      outcomeJson: null,
      runId: graph.runId,
      startedAt: now,
      tenantId,
      tool: 'execute',
    })
    .run()

  runtime.db
    .insert(runDependencies)
    .values({
      callId: 'call_execute_fail',
      createdAt: now,
      description: 'Wait for sandbox execution to finish',
      id: 'wte_execute_fail',
      resolutionJson: null,
      resolvedAt: null,
      runId: graph.runId,
      status: 'pending',
      targetKind: 'external',
      targetRef: 'sandbox_execution:sbx_execute_fail',
      targetRunId: null,
      tenantId,
      timeoutAt: null,
      type: 'tool',
    })
    .run()

  const sandboxOutput = {
    durationMs: 123,
    effectiveNetworkMode: 'open',
    failure: {
      code: 'SANDBOX_VALIDATION_TOP_LEVEL_RETURN',
      exitCode: 1,
      hint: 'Do not use top-level `return` in inline script mode.',
      message:
        'Sandbox script execution failed with exit code 1. Do not use top-level `return` in inline script mode.',
      nextAction:
        'Do not use top-level `return` in inline script mode. Use top-level await for the work, then print the final result with `console.log(JSON.stringify(result))`.',
      origin: 'guest',
      phase: 'script_execution',
      retryable: true,
      runner: 'local_dev',
      signal: null,
      stderrPreview: 'SyntaxError: Illegal return statement',
      stdoutPreview: null,
      summary:
        'Sandbox script execution failed with exit code 1. Do not use top-level `return` in inline script mode.',
    },
    files: [],
    outputDir: '/output',
    packages: [],
    presentationHint: 'No files were attached from this sandbox run.',
    sandboxExecutionId: 'sbx_execute_fail',
    status: 'failed',
    stderr: 'SyntaxError: Illegal return statement\n',
    stdout: null,
    writebacks: [],
  }

  const resolved = await resolveRunWait(
    createInternalCommandContext(
      {
        config,
        db: runtime.db,
        services: runtime.services,
      },
      scope,
    ),
    asRunId(graph.runId),
    {
      errorMessage: 'Sandbox script execution failed with exit code 1',
      output: sandboxOutput,
      waitId: 'wte_execute_fail',
    },
  )

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.equal(resolved.value.kind, 'ready_to_resume')

  const toolExecution = runtime.db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.id, 'call_execute_fail'))
    .get()

  assert.deepEqual(toolExecution?.outcomeJson, {
    details: sandboxOutput,
    error: {
      message:
        'Sandbox script execution failed with exit code 1. Do not use top-level `return` in inline script mode.',
      type: 'conflict',
    },
    ok: false,
  })
  assert.equal(toolExecution?.errorText, 'Sandbox script execution failed with exit code 1')
})

test('approving execute MCP confirmation queues the sandbox with one-shot approved runtime names', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    runId: 'run_execute_confirm_once',
    sessionId: 'ses_execute_confirm_once',
    tenantId,
    threadId: 'thr_execute_confirm_once',
  })
  const fixture = installExecuteMcpConfirmationFixture({
    accountId,
    callId: 'call_execute_confirm_once',
    graph,
    runtime,
    tenantId,
    waitId: 'wte_execute_confirm_once',
  })

  try {
    const resolved = await resolveRunWait(
      createInternalCommandContext(
        {
          config,
          db: runtime.db,
          services: runtime.services,
        },
        scope,
      ),
      asRunId(graph.runId),
      {
        approve: true,
        rememberApproval: false,
        waitId: 'wte_execute_confirm_once',
      },
    )

    assert.equal(resolved.ok, true)
    if (!resolved.ok) {
      throw new Error(resolved.error.message)
    }

    assert.equal(resolved.value.kind, 'waiting')
    if (resolved.value.kind !== 'waiting') {
      throw new Error('expected execute approval to stay waiting on the queued sandbox')
    }

    assert.equal(resolved.value.output.pendingWaits.length, 1)
    assert.equal(resolved.value.output.pendingWaits[0]?.requiresApproval, false)
    assert.equal(resolved.value.output.pendingWaits[0]?.targetKind, 'external')
    assert.match(
      String(resolved.value.output.pendingWaits[0]?.targetRef),
      /^sandbox_execution:sbx_/,
    )

    const waits = runtime.db.select().from(runDependencies).all()
    const originalWait = waits.find((wait) => wait.id === 'wte_execute_confirm_once')
    const followUpWait = waits.find((wait) => wait.id !== 'wte_execute_confirm_once')
    const execution = runtime.db
      .select()
      .from(toolExecutions)
      .where(eq(toolExecutions.id, 'call_execute_confirm_once'))
      .get()
    const queuedExecution = runtime.db.select().from(sandboxExecutions).all()[0]
    const assignment = runtime.db.select().from(mcpToolAssignments).all()[0]
    const eventTypes = runtime.db
      .select()
      .from(domainEvents)
      .all()
      .map((event) => event.type)
    const confirmationGrantedIndex = eventTypes.findIndex(
      (type) => type === 'tool.confirmation_granted',
    )
    const toolWaitingIndex = eventTypes.findIndex((type) => type === 'tool.waiting')

    assert.equal(originalWait?.status, 'resolved')
    assert.deepEqual(originalWait?.resolutionJson, {
      approved: true,
      fingerprint: 'fp_spotify_control_execute_confirm',
      remembered: false,
      runtimeName: 'spotify__spotify_control',
    })
    assert.equal(followUpWait?.status, 'pending')
    assert.equal(followUpWait?.targetKind, 'external')
    assert.match(String(followUpWait?.targetRef), /^sandbox_execution:sbx_/)
    assert.equal(execution?.completedAt, null)
    assert.equal(execution?.outcomeJson, null)
    assert.deepEqual(assignment?.approvedFingerprint, null)
    assert.ok(queuedExecution)
    assert.deepEqual(queuedExecution?.requestJson.mcpCodeModeApprovedRuntimeNames, [
      'spotify__spotify_control',
    ])
    assert.ok(confirmationGrantedIndex >= 0)
    assert.ok(toolWaitingIndex >= 0)
    assert.ok(confirmationGrantedIndex < toolWaitingIndex)
    assert.equal(eventTypes.includes('tool.completed'), false)
    assert.equal(eventTypes.includes('tool.failed'), false)
  } finally {
    fixture.restore()
  }
})

test('trusting execute MCP confirmation remembers the approved fingerprint before queueing the sandbox', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    runId: 'run_execute_confirm_trust',
    sessionId: 'ses_execute_confirm_trust',
    tenantId,
    threadId: 'thr_execute_confirm_trust',
  })
  const fixture = installExecuteMcpConfirmationFixture({
    accountId,
    callId: 'call_execute_confirm_trust',
    graph,
    runtime,
    tenantId,
    waitId: 'wte_execute_confirm_trust',
  })

  try {
    const resolved = await resolveRunWait(
      createInternalCommandContext(
        {
          config,
          db: runtime.db,
          services: runtime.services,
        },
        scope,
      ),
      asRunId(graph.runId),
      {
        approve: true,
        rememberApproval: true,
        waitId: 'wte_execute_confirm_trust',
      },
    )

    assert.equal(resolved.ok, true)
    if (!resolved.ok) {
      throw new Error(resolved.error.message)
    }

    assert.equal(resolved.value.kind, 'waiting')

    const assignment = runtime.db.select().from(mcpToolAssignments).all()[0]
    const wait = runtime.db
      .select()
      .from(runDependencies)
      .where(eq(runDependencies.id, 'wte_execute_confirm_trust'))
      .get()
    const grantedEvent = runtime.db
      .select()
      .from(domainEvents)
      .all()
      .find((event) => event.type === 'tool.confirmation_granted')

    assert.equal(assignment?.approvedFingerprint, 'fp_spotify_control_execute_confirm')
    assert.deepEqual(wait?.resolutionJson, {
      approved: true,
      fingerprint: 'fp_spotify_control_execute_confirm',
      remembered: true,
      runtimeName: 'spotify__spotify_control',
    })
    assert.equal(grantedEvent?.payload && typeof grantedEvent.payload === 'object', true)
    assert.equal((grantedEvent?.payload as { remembered?: boolean } | undefined)?.remembered, true)
  } finally {
    fixture.restore()
  }
})

test('rejecting execute MCP confirmation fails the execute tool without queueing a sandbox', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    runId: 'run_execute_confirm_reject',
    sessionId: 'ses_execute_confirm_reject',
    tenantId,
    threadId: 'thr_execute_confirm_reject',
  })
  const fixture = installExecuteMcpConfirmationFixture({
    accountId,
    callId: 'call_execute_confirm_reject',
    graph,
    runtime,
    tenantId,
    waitId: 'wte_execute_confirm_reject',
  })

  try {
    const resolved = await resolveRunWait(
      createInternalCommandContext(
        {
          config,
          db: runtime.db,
          services: runtime.services,
        },
        scope,
      ),
      asRunId(graph.runId),
      {
        approve: false,
        waitId: 'wte_execute_confirm_reject',
      },
    )

    assert.equal(resolved.ok, true)
    if (!resolved.ok) {
      throw new Error(resolved.error.message)
    }

    assert.equal(resolved.value.kind, 'ready_to_resume')

    const wait = runtime.db
      .select()
      .from(runDependencies)
      .where(eq(runDependencies.id, 'wte_execute_confirm_reject'))
      .get()
    const execution = runtime.db
      .select()
      .from(toolExecutions)
      .where(eq(toolExecutions.id, 'call_execute_confirm_reject'))
      .get()
    const eventTypes = runtime.db
      .select()
      .from(domainEvents)
      .all()
      .map((event) => event.type)

    assert.equal(wait?.status, 'resolved')
    assert.deepEqual(wait?.resolutionJson, {
      approved: false,
      error: 'Execute script rejected because MCP tool confirmation was denied',
    })
    assert.equal(
      execution?.errorText,
      'Execute script rejected because MCP tool confirmation was denied',
    )
    assert.deepEqual(execution?.outcomeJson, {
      error: {
        message: 'Execute script rejected because MCP tool confirmation was denied',
        type: 'conflict',
      },
      ok: false,
    })
    assert.equal(runtime.db.select().from(sandboxExecutions).all().length, 0)
    assert.equal(eventTypes.includes('tool.confirmation_rejected'), true)
    assert.equal(eventTypes.includes('tool.failed'), true)
    assert.equal(eventTypes.includes('tool.waiting'), false)
  } finally {
    fixture.restore()
  }
})

test('approving execute delete confirmation queues the sandbox with the delete write-back pre-approved', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    runId: 'run_execute_delete_confirm_approve',
    sessionId: 'ses_execute_delete_confirm_approve',
    tenantId,
    threadId: 'thr_execute_delete_confirm_approve',
  })

  installExecuteDeleteConfirmationFixture({
    accountId,
    callId: 'call_execute_delete_confirm_approve',
    graph,
    runtime,
    targetVaultPath: '/vault/overment/music/obsolete.md',
    tenantId,
    waitId: 'wte_execute_delete_confirm_approve',
  })

  const resolved = await resolveRunWait(
    createInternalCommandContext(
      {
        config,
        db: runtime.db,
        services: runtime.services,
      },
      scope,
    ),
    asRunId(graph.runId),
    {
      approve: true,
      waitId: 'wte_execute_delete_confirm_approve',
    },
  )

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.equal(resolved.value.kind, 'waiting')
  if (resolved.value.kind !== 'waiting') {
    throw new Error('expected execute delete approval to stay waiting on the queued sandbox')
  }

  assert.equal(resolved.value.output.pendingWaits.length, 1)
  assert.equal(resolved.value.output.pendingWaits[0]?.requiresApproval, false)
  assert.equal(resolved.value.output.pendingWaits[0]?.targetKind, 'external')
  assert.match(String(resolved.value.output.pendingWaits[0]?.targetRef), /^sandbox_execution:sbx_/)

  const waits = runtime.db.select().from(runDependencies).all()
  const originalWait = waits.find((wait) => wait.id === 'wte_execute_delete_confirm_approve')
  const followUpWait = waits.find((wait) => wait.id !== 'wte_execute_delete_confirm_approve')
  const execution = runtime.db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.id, 'call_execute_delete_confirm_approve'))
    .get()
  const queuedExecution = runtime.db.select().from(sandboxExecutions).all()[0]
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)
  const confirmationGrantedIndex = eventTypes.findIndex(
    (type) => type === 'tool.confirmation_granted',
  )
  const toolWaitingIndex = eventTypes.findIndex((type) => type === 'tool.waiting')

  assert.equal(originalWait?.status, 'resolved')
  assert.deepEqual(originalWait?.resolutionJson, {
    approved: true,
  })
  assert.equal(followUpWait?.status, 'pending')
  assert.equal(followUpWait?.targetKind, 'external')
  assert.match(String(followUpWait?.targetRef), /^sandbox_execution:sbx_/)
  assert.equal(execution?.completedAt, null)
  assert.equal(execution?.outcomeJson, null)
  assert.ok(queuedExecution)
  assert.equal(queuedExecution?.toolExecutionId, 'call_execute_delete_confirm_approve')

  const writebacks = createSandboxWritebackRepository(runtime.db).listBySandboxExecutionId(
    scope,
    asSandboxExecutionId(queuedExecution!.id),
  )
  assert.equal(writebacks.ok, true)
  if (!writebacks.ok) {
    throw new Error(writebacks.error.message)
  }

  assert.equal(writebacks.value.length, 1)
  assert.equal(writebacks.value[0]?.operation, 'delete')
  assert.equal(writebacks.value[0]?.requiresApproval, false)
  assert.equal(writebacks.value[0]?.status, 'approved')
  assert.equal(writebacks.value[0]?.approvedAt, null)
  assert.equal(writebacks.value[0]?.targetVaultPath, '/vault/overment/music/obsolete.md')

  assert.ok(confirmationGrantedIndex >= 0)
  assert.ok(toolWaitingIndex >= 0)
  assert.ok(confirmationGrantedIndex < toolWaitingIndex)
  assert.equal(eventTypes.includes('tool.completed'), false)
  assert.equal(eventTypes.includes('tool.failed'), false)
})

test('rejecting execute delete confirmation fails the execute tool without queueing a sandbox', async () => {
  const { config, runtime } = createTestHarness()
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const scope = createScope({
    accountId,
    tenantId,
  })
  const graph = seedSandboxRunGraph(runtime, {
    accountId,
    runId: 'run_execute_delete_confirm_reject',
    sessionId: 'ses_execute_delete_confirm_reject',
    tenantId,
    threadId: 'thr_execute_delete_confirm_reject',
  })

  installExecuteDeleteConfirmationFixture({
    accountId,
    callId: 'call_execute_delete_confirm_reject',
    graph,
    runtime,
    targetVaultPath: '/vault/overment/music/obsolete.md',
    tenantId,
    waitId: 'wte_execute_delete_confirm_reject',
  })

  const resolved = await resolveRunWait(
    createInternalCommandContext(
      {
        config,
        db: runtime.db,
        services: runtime.services,
      },
      scope,
    ),
    asRunId(graph.runId),
    {
      approve: false,
      waitId: 'wte_execute_delete_confirm_reject',
    },
  )

  assert.equal(resolved.ok, true)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  assert.equal(resolved.value.kind, 'ready_to_resume')

  const wait = runtime.db
    .select()
    .from(runDependencies)
    .where(eq(runDependencies.id, 'wte_execute_delete_confirm_reject'))
    .get()
  const execution = runtime.db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.id, 'call_execute_delete_confirm_reject'))
    .get()
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(wait?.status, 'resolved')
  assert.deepEqual(wait?.resolutionJson, {
    approved: false,
    error: 'Execute rejected because delete write-back confirmation was denied',
  })
  assert.equal(
    execution?.errorText,
    'Execute rejected because delete write-back confirmation was denied',
  )
  assert.deepEqual(execution?.outcomeJson, {
    error: {
      message: 'Execute rejected because delete write-back confirmation was denied',
      type: 'conflict',
    },
    ok: false,
  })
  assert.equal(runtime.db.select().from(sandboxExecutions).all().length, 0)
  assert.equal(eventTypes.includes('tool.confirmation_rejected'), true)
  assert.equal(eventTypes.includes('tool.failed'), true)
  assert.equal(eventTypes.includes('tool.waiting'), false)
})
