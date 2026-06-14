import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { onTestFinished, test } from 'vitest'

import { closeAppRuntime } from '../src/app/runtime'
import {
  accounts,
  agentRevisions,
  agents,
  files,
  kernelSessionArtifacts,
  kernelSessions,
  runs,
  sessionThreads,
  tenantMemberships,
  tenants,
  workSessions,
} from '../src/db/schema'
import type { KernelAdapter } from '../src/domain/kernel/kernel-adapter'
import type { RunRecord } from '../src/domain/runtime/run-repository'
import type { ToolContext } from '../src/domain/tooling/tool-registry'
import { ok } from '../src/shared/result'
import { createAsyncTestHarness } from './helpers/create-test-app'

const now = '2026-04-07T00:00:00.000Z'

const seedBrowserToolFixture = (
  runtime: Awaited<ReturnType<typeof createAsyncTestHarness>>['runtime'],
) => {
  runtime.db
    .insert(accounts)
    .values({
      createdAt: now,
      email: 'browser@example.com',
      id: 'acc_browser',
      name: 'Browser Tester',
      preferences: null,
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(tenants)
    .values({
      createdAt: now,
      id: 'ten_browser',
      name: 'Browser Tenant',
      slug: 'browser-tenant',
      status: 'active',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(tenantMemberships)
    .values({
      accountId: 'acc_browser',
      createdAt: now,
      id: 'tml_browser',
      role: 'owner',
      tenantId: 'ten_browser',
    })
    .run()

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: 'agr_browser_v1',
      archivedAt: null,
      baseAgentId: null,
      createdAt: now,
      createdByAccountId: 'acc_browser',
      id: 'agt_browser',
      kind: 'primary',
      name: 'Browser Agent',
      ownerAccountId: 'acc_browser',
      slug: 'browser-agent',
      status: 'active',
      tenantId: 'ten_browser',
      updatedAt: now,
      visibility: 'account_private',
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId: 'agt_browser',
      checksumSha256: 'agr_browser_v1_checksum',
      createdAt: now,
      createdByAccountId: 'acc_browser',
      frontmatterJson: {
        agent_id: 'agt_browser',
        kind: 'primary',
        name: 'Browser Agent',
        revision_id: 'agr_browser_v1',
        schema: 'agent/v1',
        slug: 'browser-agent',
        visibility: 'account_private',
      },
      gardenFocusJson: {},
      id: 'agr_browser_v1',
      instructionsMd: 'Use the browser when needed.',
      kernelPolicyJson: {
        browser: {
          allowRecording: true,
          maxConcurrentSessions: 1,
          maxDurationSec: 90,
        },
        enabled: true,
        outputs: {
          allowCookies: true,
          allowHtml: true,
          allowPdf: true,
          allowRecording: true,
          allowScreenshot: true,
          maxOutputBytes: 1024 * 1024,
        },
      },
      memoryPolicyJson: {},
      modelConfigJson: {
        modelAlias: 'gpt-5.4',
        provider: 'openai',
      },
      resolvedConfigJson: {},
      sandboxPolicyJson: {},
      sourceMarkdown: '---\nname: Browser Agent\n---\nUse the browser when needed.\n',
      tenantId: 'ten_browser',
      toolPolicyJson: {
        native: ['browse'],
      },
      toolProfileId: null,
      version: 1,
      workspacePolicyJson: {},
    })
    .run()

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: 'acc_browser',
      deletedAt: null,
      id: 'ses_browser',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_browser',
      title: 'Browser Session',
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
      createdByAccountId: 'acc_browser',
      id: 'thr_browser',
      parentThreadId: null,
      sessionId: 'ses_browser',
      status: 'active',
      tenantId: 'ten_browser',
      title: 'Browser Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      actorAccountId: 'acc_browser',
      agentId: 'agt_browser',
      agentRevisionId: 'agr_browser_v1',
      completedAt: null,
      configSnapshot: {},
      createdAt: now,
      errorJson: null,
      id: 'run_browser',
      jobId: null,
      lastProgressAt: now,
      parentRunId: null,
      resultJson: null,
      rootRunId: 'run_browser',
      sessionId: 'ses_browser',
      sourceCallId: null,
      staleRecoveryCount: 0,
      startedAt: now,
      status: 'running',
      targetKind: 'agent',
      task: 'collect browser artifacts',
      tenantId: 'ten_browser',
      threadId: 'thr_browser',
      toolProfileId: null,
      turnCount: 0,
      updatedAt: now,
      version: 1,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .update(workSessions)
    .set({
      rootRunId: 'run_browser',
    })
    .where(eq(workSessions.id, 'ses_browser'))
    .run()
}

const createToolContext = (
  runtime: Awaited<ReturnType<typeof createAsyncTestHarness>>['runtime'],
): ToolContext => ({
  config: runtime.config,
  createId: runtime.services.ids.create,
  db: runtime.db,
  nowIso: () => now,
  requestId: 'req_kernel_browser' as ToolContext['requestId'],
  run: {
    actorAccountId: 'acc_browser' as RunRecord['actorAccountId'],
    agentId: 'agt_browser' as RunRecord['agentId'],
    agentRevisionId: 'agr_browser_v1' as RunRecord['agentRevisionId'],
    completedAt: null,
    configSnapshot: {},
    createdAt: now,
    errorJson: null,
    id: 'run_browser' as RunRecord['id'],
    jobId: null,
    lastProgressAt: now,
    parentRunId: null,
    resultJson: null,
    rootRunId: 'run_browser' as RunRecord['rootRunId'],
    sessionId: 'ses_browser' as RunRecord['sessionId'],
    sourceCallId: null,
    staleRecoveryCount: 0,
    startedAt: now,
    status: 'running',
    targetKind: 'agent',
    task: 'collect browser artifacts',
    tenantId: 'ten_browser' as RunRecord['tenantId'],
    threadId: 'thr_browser' as RunRecord['threadId'],
    toolProfileId: null,
    turnCount: 0,
    updatedAt: now,
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  },
  services: runtime.services,
  tenantScope: {
    accountId: 'acc_browser' as ToolContext['tenantScope']['accountId'],
    role: 'owner',
    tenantId: 'ten_browser' as ToolContext['tenantScope']['tenantId'],
  },
  toolCallId: null,
  traceId: 'trace_kernel_browser' as ToolContext['traceId'],
})

test('browse persists kernel sessions and browser artifacts', async () => {
  const { runtime } = await createAsyncTestHarness()
  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  seedBrowserToolFixture(runtime)

  let startedRecordingId: string | null = null
  let stoppedRecordingId: string | null = null
  let executedTimeout: number | undefined
  const fakeAdapter: KernelAdapter = {
    close: async () => {},
    describeEndpoint: () => 'http://127.0.0.1:10001/',
    downloadRecording: async (recordingId) =>
      ok({
        body: new TextEncoder().encode(`video:${recordingId}`),
        contentType: 'video/mp4',
      }),
    executePlaywright: async (input) => {
      executedTimeout = input.timeoutSec

      return ok({
        result: {
          artifacts: {
            cookies: {
              filename: 'browser-cookies.json',
              mimeType: 'application/json',
              text: '[{"name":"session"}]',
            },
            html: {
              filename: 'browser-dom.html',
              mimeType: 'text/html',
              text: '<html><body>ok</body></html>',
            },
            screenshot: {
              base64Data: Buffer.from('png-bytes').toString('base64'),
              filename: 'browser-screenshot.png',
              mimeType: 'image/png',
            },
          },
          consoleMessages: ['[log] step 1', '[page:info] done'],
          page: {
            title: 'Example Domain',
            url: 'https://example.com/',
          },
          userResult: {
            ok: true,
            title: 'Example Domain',
          },
        },
      })
    },
    healthCheck: async () =>
      ok({
        detail: 'ready',
        endpoint: 'http://127.0.0.1:10001/',
      }),
    provider: 'local',
    startRecording: async (input) => {
      startedRecordingId = input.id
      return ok(null)
    },
    stopRecording: async (recordingId) => {
      stoppedRecordingId = recordingId
      return ok(null)
    },
    supportsBrowserJobs: true,
  }

  runtime.services.kernel.getAdapter = () => fakeAdapter
  runtime.services.kernel.getAvailability = () => ({
    available: true,
    checkedAt: now,
    detail: 'ready',
    enabled: true,
    endpoint: 'http://127.0.0.1:10001/',
    provider: 'local',
    status: 'ready',
  })

  const context = createToolContext(runtime)
  const activeToolNames = runtime.services.tools.list(context).map((tool) => tool.name)
  const tool = runtime.services.tools.get('browse')

  assert(activeToolNames.includes('browse'))
  assert(tool)

  const result = await tool.execute(context, {
    outputs: {
      console: true,
      cookies: true,
      html: true,
      recording: true,
      screenshot: true,
    },
    script: 'return { ok: true }',
    task: 'capture browser outputs',
    timeoutSec: 45,
    url: 'https://example.com',
  })

  assert(result.ok)
  assert.equal(result.value.kind, 'immediate')
  assert.equal(result.value.output.status, 'completed')
  assert.equal(result.value.output.page.title, 'Example Domain')
  assert.equal(result.value.output.result.ok, true)
  assert.equal(result.value.output.durationMs, 0)
  assert.equal(result.value.output.artifacts.length, 4)
  assert.equal(executedTimeout, 45)
  assert.match(String(startedRecordingId), /^session-kse_/)
  assert.equal(startedRecordingId, stoppedRecordingId)

  const sessionRows = runtime.db.select().from(kernelSessions).all()
  const artifactRows = runtime.db.select().from(kernelSessionArtifacts).all()
  const fileRows = runtime.db.select().from(files).all()

  assert.equal(sessionRows.length, 1)
  assert.equal(sessionRows[0]?.status, 'completed')
  assert.equal(sessionRows[0]?.provider, 'local')
  assert.equal(artifactRows.length, 4)
  assert.equal(fileRows.length, 4)
  assert.deepEqual(artifactRows.map((row) => row.kind).sort(), [
    'cookies',
    'html',
    'recording',
    'screenshot',
  ])
})
