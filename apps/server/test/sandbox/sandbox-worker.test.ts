import assert from 'node:assert/strict'
import { describe, expect, test, vi } from 'vitest'

import { createSandboxExecutionService } from '../../src/application/sandbox/sandbox-execution-service'
import { createSandboxWorker } from '../../src/application/sandbox/sandbox-worker'
import { runDependencies, runs, sessionThreads, workSessions } from '../../src/db/schema'
import { createJobRepository } from '../../src/adapters/persistence/sqlite/runtime/job-repository'
import { createRunDependencyRepository } from '../../src/adapters/persistence/sqlite/runtime/run-dependency-repository'
import { createToolExecutionRepository } from '../../src/adapters/persistence/sqlite/runtime/tool-execution-repository'
import { createSandboxExecutionRepository } from '../../src/adapters/persistence/sqlite/sandbox/sandbox-execution-repository'
import { createSandboxExecutionPackageRepository } from '../../src/adapters/persistence/sqlite/sandbox/sandbox-package-repository'
import type { SandboxRunner } from '../../src/domain/sandbox/sandbox-runner'
import {
  asAccountId,
  asJobId,
  asRunId,
  asSandboxExecutionId,
  asSandboxExecutionPackageId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
} from '../../src/shared/ids'
import { err, ok } from '../../src/shared/result'
import type { TenantScope } from '../../src/shared/scope'
import { seedApiKeyAuth } from '../helpers/api-key-auth'
import { createTestHarness } from '../helpers/create-test-app'

const now = '2026-04-04T10:00:00.000Z'

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
      task: 'Run sandbox job',
      targetKind: 'assistant',
      tenantId: input.tenantId,
      threadId,
      toolProfileId: null,
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  return {
    runId,
    sessionId,
    threadId,
  }
}

const createScope = (input: { accountId: string; tenantId: string }): TenantScope => ({
  accountId: asAccountId(input.accountId),
  role: 'admin',
  tenantId: asTenantId(input.tenantId),
})

describe('sandbox worker', () => {
  test('processes queued executions and persists installed packages', async () => {
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
    const executionId = asSandboxExecutionId('sbx_worker_complete')
    const jobId = asJobId('job_worker_complete')
    const packageId = asSandboxExecutionPackageId('sbp_worker_complete')
    const executionService = createSandboxExecutionService({
      db: runtime.db,
      provider: 'local_dev',
      supportedRuntimes: ['node'],
    })

    const queued = executionService.queueExecution(scope, {
      createdAt: now,
      executionId,
      jobId,
      policySnapshot: {
        enabled: true,
        network: {
          mode: 'off',
        },
        packages: {
          mode: 'allow_list',
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
          mode: 'read_only',
        },
      },
      request: {
        network: {
          mode: 'off',
        },
        packages: [
          {
            name: 'left-pad',
            version: '1.3.0',
          },
        ],
        runtime: 'node',
        source: {
          kind: 'inline_script',
          script: 'console.log("sandbox complete")',
        },
        task: 'Install package and run',
        vaultAccess: 'read_only',
      },
      requestedPackages: [
        {
          id: packageId,
          installScriptsAllowed: false,
          name: 'left-pad',
          registryHost: 'registry.npmjs.org',
          version: '1.3.0',
        },
      ],
      runId: asRunId(graph.runId),
      sessionId: asWorkSessionId(graph.sessionId),
      threadId: asSessionThreadId(graph.threadId),
      title: 'Sandbox execution',
      vaultAccessMode: 'read_only',
    })

    assert.equal(queued.ok, true)

    if (!queued.ok) {
      throw new Error('expected sandbox execution to queue')
    }

    const runner: SandboxRunner = {
      provider: 'local_dev',
      supportedRuntimes: ['node'],
      runExecution: vi.fn(async () =>
        ok({
          completedAt: '2026-04-04T10:00:05.000Z',
          durationMs: 5000,
          errorText: null,
          externalSandboxId: 'local_sbx_1',
          failure: null,
          networkMode: 'off',
          packages: [
            {
              errorText: null,
              id: packageId,
              name: 'left-pad',
              requestedVersion: '1.3.0',
              resolvedVersion: '1.3.0',
              status: 'installed',
            },
          ],
          provider: 'local_dev',
          runtime: 'node',
          startedAt: '2026-04-04T10:00:00.000Z',
          status: 'completed',
          stderrText: '',
          stdoutText: 'sandbox ok',
          vaultAccessMode: 'read_only',
        }),
      ),
    }

    const worker = createSandboxWorker({
      config,
      db: runtime.db,
      runner,
      services: runtime.services,
    })

    const processed = await worker.processQueuedExecutions()

    assert.equal(processed, 1)
    expect(runner.runExecution).toHaveBeenCalledTimes(1)

    const executionRepository = createSandboxExecutionRepository(runtime.db)
    const packageRepository = createSandboxExecutionPackageRepository(runtime.db)
    const jobRepository = createJobRepository(runtime.db)

    const execution = executionRepository.getById(scope, executionId)
    const packages = packageRepository.listBySandboxExecutionId(scope, executionId)
    const job = jobRepository.getById(scope, jobId)

    assert.equal(execution.ok, true)
    assert.equal(packages.ok, true)
    assert.equal(job.ok, true)

    if (!execution.ok || !packages.ok || !job.ok) {
      throw new Error('expected sandbox records to load after worker execution')
    }

    assert.equal(execution.value.status, 'completed')
    assert.equal(execution.value.stdoutText, 'sandbox ok')
    assert.equal(execution.value.externalSandboxId, 'local_sbx_1')
    assert.equal(packages.value[0]?.status, 'installed')
    assert.equal(packages.value[0]?.resolvedVersion, '1.3.0')
    assert.equal(job.value.status, 'completed')
  })

  test('stores standard resultJson for execute executions', async () => {
    const { config, runtime } = createTestHarness()
    const { accountId, tenantId } = seedApiKeyAuth(runtime, {
      accountId: 'acc_execute_worker',
    })
    const scope = createScope({
      accountId,
      tenantId,
    })
    const graph = seedSandboxRunGraph(runtime, {
      accountId,
      runId: 'run_execute_worker',
      sessionId: 'ses_execute_worker',
      tenantId,
      threadId: 'thr_execute_worker',
    })
    const executionId = asSandboxExecutionId('sbx_execute_worker')
    const jobId = asJobId('job_execute_worker')
    const toolExecutionId = 'tcl_execute_worker'
    const executionService = createSandboxExecutionService({
      db: runtime.db,
      provider: 'local_dev',
      supportedRuntimes: ['node'],
    })
    const toolExecutionRepository = createToolExecutionRepository(runtime.db)
    const createdToolExecution = toolExecutionRepository.create(scope, {
      argsJson: null,
      createdAt: now,
      domain: 'native',
      id: toolExecutionId,
      runId: asRunId(graph.runId),
      startedAt: now,
      tool: 'execute',
    })

    assert.equal(createdToolExecution.ok, true)

    const queued = executionService.queueExecution(scope, {
      createdAt: now,
      executionId,
      jobId,
      policySnapshot: {
        enabled: true,
        network: {
          mode: 'off',
        },
        packages: {
          mode: 'allow_list',
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
          mode: 'read_only',
        },
      },
      request: {
        network: {
          mode: 'off',
        },
        runtime: 'node',
        source: {
          kind: 'inline_script',
          script: 'console.log("hello")',
        },
        task: 'Execute script',
        vaultAccess: 'read_only',
      },
      requestedPackages: [],
      runId: asRunId(graph.runId),
      sessionId: asWorkSessionId(graph.sessionId),
      threadId: asSessionThreadId(graph.threadId),
      title: 'Execute code',
      toolExecutionId,
      vaultAccessMode: 'read_only',
    })

    assert.equal(queued.ok, true)

    if (!queued.ok) {
      throw new Error('expected execute sandbox execution to queue')
    }

    const runner: SandboxRunner = {
      provider: 'local_dev',
      supportedRuntimes: ['node'],
      runExecution: vi.fn(async () =>
        ok({
          completedAt: '2026-04-04T10:00:03.000Z',
          durationMs: 3000,
          errorText: null,
          externalSandboxId: 'local_execute',
          failure: null,
          networkMode: 'off',
          packages: [],
          provider: 'local_dev',
          runtime: 'node',
          startedAt: '2026-04-04T10:00:00.000Z',
          status: 'completed',
          stderrText: null,
          stdoutText: '{"ok":true}\n{"track":"Freyja"}\n',
          vaultAccessMode: 'read_only',
        }),
      ),
    }

    const worker = createSandboxWorker({
      config,
      db: runtime.db,
      runner,
      services: runtime.services,
    })

    const processed = await worker.processQueuedExecutions()

    assert.equal(processed, 1)

    const job = createJobRepository(runtime.db).getById(scope, jobId)

    assert.equal(job.ok, true)

    if (!job.ok) {
      throw new Error('expected execute job to load')
    }

    assert.deepEqual(job.value.resultJson, {
      durationMs: 3000,
      effectiveNetworkMode: 'off',
      failure: null,
      files: [],
      isolation: {
        cwd: '/work',
        effectiveNetworkMode: 'off',
        filesPersistAcrossCalls: false,
        freshSandboxPerCall: true,
        mountedInputs: [],
        networkEnforcement: 'best_effort',
        outputVisibleOnlyThisCall: true,
        packageInstallStrategy: 'none',
        packagesPersistAcrossCalls: false,
        requestedNetworkMode: 'off',
        stagedRoots: ['/input', '/work', '/output'],
      },
      kind: 'sandbox_result',
      outputDir: '/output',
      packages: [],
      presentationHint: 'No files were attached from this sandbox run.',
      provider: 'local_dev',
      runtime: 'node',
      sandboxExecutionId: executionId,
      stderr: null,
      status: 'completed',
      stdout: '{"ok":true}\n{"track":"Freyja"}\n',
      writebacks: [],
    })
  })

  test('resolves guest sandbox failures as normal execute outcomes instead of failed tool calls', async () => {
    const { config, runtime } = createTestHarness()
    const { accountId, tenantId } = seedApiKeyAuth(runtime, {
      accountId: 'acc_execute_failed_worker',
    })
    const scope = createScope({
      accountId,
      tenantId,
    })
    const graph = seedSandboxRunGraph(runtime, {
      accountId,
      runId: 'run_execute_failed_worker',
      sessionId: 'ses_execute_failed_worker',
      tenantId,
      threadId: 'thr_execute_failed_worker',
    })
    const executionId = asSandboxExecutionId('sbx_execute_failed_worker')
    const jobId = asJobId('job_execute_failed_worker')
    const toolExecutionId = 'tcl_execute_failed_worker'
    const executionService = createSandboxExecutionService({
      db: runtime.db,
      provider: 'local_dev',
      supportedRuntimes: ['node'],
    })
    const toolExecutionRepository = createToolExecutionRepository(runtime.db)
    const createdToolExecution = toolExecutionRepository.create(scope, {
      argsJson: { task: 'Execute failing script' },
      createdAt: now,
      domain: 'native',
      id: toolExecutionId,
      runId: asRunId(graph.runId),
      startedAt: now,
      tool: 'execute',
    })

    assert.equal(createdToolExecution.ok, true)

    runtime.db
      .insert(runDependencies)
      .values({
        callId: toolExecutionId,
        createdAt: now,
        description: 'Wait for execute sandbox job',
        id: 'wte_execute_failed_worker',
        resolutionJson: null,
        resolvedAt: null,
        runId: graph.runId,
        status: 'pending',
        targetKind: 'external',
        targetRef: `sandbox_execution:${executionId}`,
        targetRunId: null,
        tenantId,
        timeoutAt: null,
        type: 'tool',
      })
      .run()

    const queued = executionService.queueExecution(scope, {
      createdAt: now,
      executionId,
      jobId,
      policySnapshot: {
        enabled: true,
        network: {
          mode: 'off',
        },
        packages: {
          mode: 'allow_list',
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
          mode: 'read_only',
        },
      },
      request: {
        network: {
          mode: 'off',
        },
        runtime: 'node',
        source: {
          kind: 'inline_script',
          script: 'return 1',
        },
        task: 'Execute failing script',
        vaultAccess: 'read_only',
      },
      requestedPackages: [],
      runId: asRunId(graph.runId),
      sessionId: asWorkSessionId(graph.sessionId),
      threadId: asSessionThreadId(graph.threadId),
      title: 'Execute failing code',
      toolExecutionId,
      vaultAccessMode: 'read_only',
    })

    assert.equal(queued.ok, true)

    if (!queued.ok || !createdToolExecution.ok) {
      throw new Error('expected execute sandbox execution to queue')
    }

    const runner: SandboxRunner = {
      provider: 'local_dev',
      supportedRuntimes: ['node'],
      runExecution: vi.fn(async () =>
        ok({
          completedAt: '2026-04-04T10:00:03.000Z',
          durationMs: 3000,
          errorText: 'Sandbox script execution failed with exit code 1',
          externalSandboxId: 'local_execute_failed',
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
          networkMode: 'off',
          packages: [],
          provider: 'local_dev',
          runtime: 'node',
          startedAt: '2026-04-04T10:00:00.000Z',
          status: 'failed',
          stderrText: 'SyntaxError: Illegal return statement\n',
          stdoutText: null,
          vaultAccessMode: 'read_only',
        }),
      ),
    }

    const worker = createSandboxWorker({
      config,
      db: runtime.db,
      runner,
      services: runtime.services,
    })

    const processed = await worker.processQueuedExecutions()

    assert.equal(processed, 1)

    const toolExecution = toolExecutionRepository.getById(scope, toolExecutionId)
    const wait = createRunDependencyRepository(runtime.db).getById(
      scope,
      'wte_execute_failed_worker',
    )

    assert.equal(toolExecution.ok, true)
    assert.equal(wait.ok, true)

    if (!toolExecution.ok || !wait.ok) {
      throw new Error('expected failed execute wait artifacts to load')
    }

    assert.equal(toolExecution.value.errorText, null)
    assert.deepEqual(toolExecution.value.outcomeJson, {
      durationMs: 3000,
      effectiveNetworkMode: 'off',
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
      isolation: {
        cwd: '/work',
        effectiveNetworkMode: 'off',
        filesPersistAcrossCalls: false,
        freshSandboxPerCall: true,
        mountedInputs: [],
        networkEnforcement: 'best_effort',
        outputVisibleOnlyThisCall: true,
        packageInstallStrategy: 'none',
        packagesPersistAcrossCalls: false,
        requestedNetworkMode: 'off',
        stagedRoots: ['/input', '/work', '/output'],
      },
      kind: 'sandbox_result',
      outputDir: '/output',
      packages: [],
      presentationHint: 'No files were attached from this sandbox run.',
      provider: 'local_dev',
      runtime: 'node',
      sandboxExecutionId: executionId,
      status: 'failed',
      stderr: 'SyntaxError: Illegal return statement\n',
      stdout: null,
      writebacks: [],
    })
    assert.deepEqual(wait.value.resolutionJson, {
      output: toolExecution.value.outcomeJson,
    })
  })

  test('marks queued packages as failed when the runner errors', async () => {
    const { config, runtime } = createTestHarness()
    const { accountId, tenantId } = seedApiKeyAuth(runtime, {
      accountId: 'acc_sandbox_worker',
    })
    const scope = createScope({
      accountId,
      tenantId,
    })
    const graph = seedSandboxRunGraph(runtime, {
      accountId,
      runId: 'run_sandbox_failed',
      sessionId: 'ses_sandbox_failed',
      tenantId,
      threadId: 'thr_sandbox_failed',
    })
    const executionId = asSandboxExecutionId('sbx_worker_failed')
    const jobId = asJobId('job_worker_failed')
    const packageId = asSandboxExecutionPackageId('sbp_worker_failed')
    const executionService = createSandboxExecutionService({
      db: runtime.db,
      provider: 'local_dev',
      supportedRuntimes: ['node'],
    })

    const queued = executionService.queueExecution(scope, {
      createdAt: now,
      executionId,
      jobId,
      policySnapshot: {
        enabled: true,
        network: {
          mode: 'off',
        },
        packages: {
          mode: 'allow_list',
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
          mode: 'read_only',
        },
      },
      request: {
        network: {
          mode: 'off',
        },
        packages: [
          {
            name: 'kleur',
            version: '4.1.5',
          },
        ],
        runtime: 'node',
        source: {
          kind: 'inline_script',
          script: 'console.log("sandbox failed")',
        },
        task: 'Fail package install and run',
        vaultAccess: 'read_only',
      },
      requestedPackages: [
        {
          id: packageId,
          installScriptsAllowed: false,
          name: 'kleur',
          registryHost: 'registry.npmjs.org',
          version: '4.1.5',
        },
      ],
      runId: asRunId(graph.runId),
      sessionId: asWorkSessionId(graph.sessionId),
      threadId: asSessionThreadId(graph.threadId),
      title: 'Sandbox execution failure',
      vaultAccessMode: 'read_only',
    })

    assert.equal(queued.ok, true)

    if (!queued.ok) {
      throw new Error('expected sandbox execution to queue')
    }

    const runner: SandboxRunner = {
      provider: 'local_dev',
      supportedRuntimes: ['node'],
      runExecution: vi.fn(async () =>
        err({
          message: 'runner exploded',
          type: 'conflict',
        }),
      ),
    }

    const worker = createSandboxWorker({
      config,
      db: runtime.db,
      runner,
      services: runtime.services,
    })

    const processed = await worker.processQueuedExecutions()

    assert.equal(processed, 1)
    expect(runner.runExecution).toHaveBeenCalledTimes(1)

    const executionRepository = createSandboxExecutionRepository(runtime.db)
    const packageRepository = createSandboxExecutionPackageRepository(runtime.db)
    const jobRepository = createJobRepository(runtime.db)

    const execution = executionRepository.getById(scope, executionId)
    const packages = packageRepository.listBySandboxExecutionId(scope, executionId)
    const job = jobRepository.getById(scope, jobId)

    assert.equal(execution.ok, true)
    assert.equal(packages.ok, true)
    assert.equal(job.ok, true)

    if (!execution.ok || !packages.ok || !job.ok) {
      throw new Error('expected sandbox records to load after worker failure')
    }

    assert.equal(execution.value.status, 'failed')
    assert.equal(execution.value.errorText, 'runner exploded')
    assert.equal(packages.value[0]?.status, 'failed')
    assert.equal(packages.value[0]?.errorText, 'runner exploded')
    assert.equal(job.value.status, 'blocked')
  })
})
