import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { registerAgentNativeTools } from '../src/application/agents/register-agent-native-tools'
import { buildAttachmentRefDescriptors } from '../src/application/files/attachment-ref-context'
import { registerKernelNativeTools } from '../src/application/kernel/register-kernel-native-tools'
import {
  executeOneToolCall,
  prepareToolExecution,
} from '../src/application/runtime/execution/run-tool-execution'
import { registerSandboxNativeTools } from '../src/application/sandbox/register-sandbox-native-tools'
import { createToolRegistry, type ToolSpec } from '../src/application/tooling/tool-registry'
import {
  fileLinks,
  files,
  runs,
  sessionMessages,
  sessionThreads,
  workSessions,
} from '../src/db/schema'
import {
  asAccountId,
  asFileId,
  asRequestId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asTenantId,
  asTraceId,
  asWorkSessionId,
} from '../src/shared/ids'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'
import { grantNativeToolToDefaultAgent } from './helpers/grant-native-tool-agent'

const now = '2026-04-04T10:00:00.000Z'

test('buildAttachmentRefDescriptors respects persisted attachment order and marks sealed messages', () => {
  const descriptors = buildAttachmentRefDescriptors({
    apiBasePath: '/api',
    linkedFiles: [
      {
        file: {
          accessScope: 'session_local',
          checksumSha256: null,
          createdAt: '2026-04-04T10:00:02.000Z',
          createdByAccountId: asAccountId('acc_test'),
          createdByRunId: null,
          id: asFileId('fil_doc_1'),
          metadata: null,
          mimeType: 'text/markdown',
          originUploadId: null,
          originalFilename: 'notes.md',
          sizeBytes: 12,
          sourceKind: 'upload',
          status: 'ready',
          storageKey: 'workspaces/ten_test/acc_test/vault/attachments/2026/04/04/do/fil_doc_1.md',
          tenantId: asTenantId('ten_test'),
          title: null,
          updatedAt: '2026-04-04T10:00:02.000Z',
        },
        messageId: asSessionMessageId('msg_user'),
      },
      {
        file: {
          accessScope: 'session_local',
          checksumSha256: null,
          createdAt: '2026-04-04T10:00:01.000Z',
          createdByAccountId: asAccountId('acc_test'),
          createdByRunId: null,
          id: asFileId('fil_img_1'),
          metadata: null,
          mimeType: 'image/png',
          originUploadId: null,
          originalFilename: 'diagram.png',
          sizeBytes: 32,
          sourceKind: 'upload',
          status: 'ready',
          storageKey: 'workspaces/ten_test/acc_test/vault/attachments/2026/04/04/im/fil_img_1.png',
          tenantId: asTenantId('ten_test'),
          title: null,
          updatedAt: '2026-04-04T10:00:01.000Z',
        },
        messageId: asSessionMessageId('msg_user'),
      },
    ],
    liveMessageIds: new Set<ReturnType<typeof asSessionMessageId>>(),
    visibleMessages: [
      {
        authorAccountId: asAccountId('acc_test'),
        authorKind: 'user',
        content: [{ text: 'See attachments', type: 'text' }],
        createdAt: now,
        id: asSessionMessageId('msg_user'),
        metadata: {
          attachmentFileIds: ['fil_img_1', 'fil_doc_1'],
        },
        runId: null,
        sequence: 1,
        sessionId: asWorkSessionId('ses_test'),
        tenantId: asTenantId('ten_test'),
        threadId: asSessionThreadId('thr_test'),
      },
    ],
  })

  assert.deepEqual(
    descriptors.map((descriptor) => [descriptor.fileId, descriptor.indexInMessageAll]),
    [
      ['fil_img_1', 1],
      ['fil_doc_1', 2],
    ],
  )
  assert.equal(descriptors[0]?.ref, '{{attachment:msg_msg_user:kind:image:index:1}}')
  assert.equal(descriptors[1]?.ref, '{{attachment:msg_msg_user:kind:file:index:1}}')
  assert.equal(descriptors[0]?.internalPath, '/vault/attachments/2026/04/04/im/fil_img_1.png')
  assert.equal(descriptors[1]?.internalPath, '/vault/attachments/2026/04/04/do/fil_doc_1.md')
  assert.equal(descriptors[0]?.sourceMessageState, 'sealed')
})

test('executeOneToolCall resolves exact attachment refs to workspace paths before validation', async () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const granted = grantNativeToolToDefaultAgent(runtime, 'path_echo')

  assert.ok(granted)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_test',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Test Session',
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
      id: 'thr_test',
      parentThreadId: null,
      sessionId: 'ses_test',
      status: 'active',
      tenantId,
      title: 'Test Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(sessionMessages)
    .values({
      authorAccountId: accountId,
      authorKind: 'user',
      content: [{ text: 'Read the attached note', type: 'text' }],
      createdAt: now,
      id: 'msg_user',
      metadata: {
        attachmentFileIds: ['fil_doc_1'],
      },
      runId: null,
      sequence: 1,
      sessionId: 'ses_test',
      tenantId,
      threadId: 'thr_test',
    })
    .run()

  runtime.db
    .insert(files)
    .values({
      accessScope: 'session_local',
      checksumSha256: null,
      createdAt: now,
      createdByAccountId: accountId,
      createdByRunId: null,
      id: 'fil_doc_1',
      metadata: null,
      mimeType: 'text/markdown',
      originUploadId: null,
      originalFilename: 'notes.md',
      sizeBytes: 12,
      sourceKind: 'upload',
      status: 'ready',
      storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/2026/04/04/do/fil_doc_1.md`,
      tenantId,
      title: null,
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(fileLinks)
    .values({
      createdAt: now,
      fileId: 'fil_doc_1',
      id: 'flk_msg_1',
      linkType: 'message',
      targetId: 'msg_user',
      tenantId,
    })
    .run()

  const run = {
    agentId: granted.agentId,
    agentRevisionId: granted.revisionId,
    completedAt: null,
    configSnapshot: {},
    createdAt: now,
    errorJson: null,
    id: asRunId('run_test'),
    jobId: null,
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_test'),
    sessionId: asWorkSessionId('ses_test'),
    sourceCallId: null,
    startedAt: now,
    status: 'running' as const,
    task: 'Read the note',
    tenantId: asTenantId(tenantId),
    threadId: asSessionThreadId('thr_test'),
    toolProfileId: granted.toolProfileId,
    turnCount: 0,
    updatedAt: now,
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  }
  const pathEchoTool: ToolSpec<{ path: string }> = {
    attachmentRefResolutionPolicy: 'path_only',
    attachmentRefTargetKeys: ['path'],
    domain: 'native',
    execute: async (_context, args) =>
      ok({
        kind: 'immediate',
        output: args,
      }),
    inputSchema: {
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      type: 'object',
    },
    name: 'path_echo',
    validateArgs: (args) =>
      typeof (args as { path?: unknown } | null)?.path === 'string'
        ? ok(args as { path: string })
        : {
            error: {
              message: 'path is required',
              type: 'validation',
            },
            ok: false,
          },
  }

  const prepared = prepareToolExecution(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId: asAccountId(accountId),
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    {
      arguments: {
        path: '{{attachment:msg_msg_user:kind:file:index:1}}',
      },
      argumentsJson: '{"path":"{{attachment:msg_msg_user:kind:file:index:1}}"}',
      callId: 'call_1',
      name: 'path_echo',
    },
  )

  const result = await executeOneToolCall(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId: asAccountId(accountId),
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    run,
    {
      ...prepared,
      tool: pathEchoTool,
      toolName: pathEchoTool.name,
    },
  )

  assert.equal(result.error, undefined)
  assert.deepEqual(result.outcome, {
    kind: 'immediate',
    output: {
      path: '/vault/attachments/2026/04/04/do/fil_doc_1.md',
    },
  })
})

test('executeOneToolCall defaults generic tools to url-only for exact refs and inline content for embedded refs', async () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const granted = grantNativeToolToDefaultAgent(runtime, 'generic_echo')

  assert.ok(granted)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_test',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Test Session',
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
      id: 'thr_test',
      parentThreadId: null,
      sessionId: 'ses_test',
      status: 'active',
      tenantId,
      title: 'Test Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(sessionMessages)
    .values({
      authorAccountId: accountId,
      authorKind: 'user',
      content: [{ text: 'See attachments', type: 'text' }],
      createdAt: now,
      id: 'msg_user',
      metadata: {
        attachmentFileIds: ['fil_img_1', 'fil_doc_1'],
      },
      runId: null,
      sequence: 1,
      sessionId: 'ses_test',
      tenantId,
      threadId: 'thr_test',
    })
    .run()

  const noteStorageKey = `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/2026/04/04/do/fil_doc_1.md`
  const imageStorageKey = `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/2026/04/04/im/fil_img_1.png`

  const storedNote = await runtime.services.files.blobStore.put({
    data: Buffer.from('# Meeting Notes\n\n- finalize pricing\n- publish docs\n'),
    storageKey: noteStorageKey,
  })
  assert.equal(storedNote.ok, true)

  const storedImage = await runtime.services.files.blobStore.put({
    data: Buffer.from('png'),
    storageKey: imageStorageKey,
  })
  assert.equal(storedImage.ok, true)

  runtime.db
    .insert(files)
    .values([
      {
        accessScope: 'session_local',
        checksumSha256: null,
        createdAt: now,
        createdByAccountId: accountId,
        createdByRunId: null,
        id: 'fil_doc_1',
        metadata: null,
        mimeType: 'text/markdown',
        originUploadId: null,
        originalFilename: 'notes.md',
        sizeBytes: 48,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: noteStorageKey,
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
        id: 'fil_img_1',
        metadata: null,
        mimeType: 'image/png',
        originUploadId: null,
        originalFilename: 'diagram.png',
        sizeBytes: 3,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: imageStorageKey,
        tenantId,
        title: null,
        updatedAt: now,
      },
    ])
    .run()

  runtime.db
    .insert(fileLinks)
    .values([
      {
        createdAt: now,
        fileId: 'fil_doc_1',
        id: 'flk_doc',
        linkType: 'message',
        targetId: 'msg_user',
        tenantId,
      },
      {
        createdAt: now,
        fileId: 'fil_img_1',
        id: 'flk_img',
        linkType: 'message',
        targetId: 'msg_user',
        tenantId,
      },
    ])
    .run()

  const run = {
    agentId: granted.agentId,
    agentRevisionId: granted.revisionId,
    completedAt: null,
    configSnapshot: {},
    createdAt: now,
    errorJson: null,
    id: asRunId('run_test'),
    jobId: null,
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_test'),
    sessionId: asWorkSessionId('ses_test'),
    sourceCallId: null,
    startedAt: now,
    status: 'running' as const,
    task: 'Inspect attachments',
    tenantId: asTenantId(tenantId),
    threadId: asSessionThreadId('thr_test'),
    toolProfileId: granted.toolProfileId,
    turnCount: 0,
    updatedAt: now,
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  }
  const genericTool: ToolSpec<Record<string, unknown>> = {
    domain: 'native',
    execute: async (_context, args) =>
      ok({
        kind: 'immediate',
        output: args,
      }),
    inputSchema: {
      additionalProperties: true,
      type: 'object',
    },
    name: 'generic_echo',
    validateArgs: (args) => ok((args as Record<string, unknown>) ?? {}),
  }

  const prepared = prepareToolExecution(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId: asAccountId(accountId),
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    {
      arguments: {
        exactDocument: '{{attachment:msg_msg_user:kind:file:index:1}}',
        inlineDocument: 'Summarize this document:\n{{attachment:msg_msg_user:kind:file:index:1}}',
        inlineImage: 'Use this as hero: {{attachment:msg_msg_user:kind:image:index:1}}',
      },
      argumentsJson:
        '{"exactDocument":"{{attachment:msg_msg_user:kind:file:index:1}}","inlineDocument":"Summarize this document:\\n{{attachment:msg_msg_user:kind:file:index:1}}","inlineImage":"Use this as hero: {{attachment:msg_msg_user:kind:image:index:1}}"}',
      callId: 'call_1',
      name: 'generic_echo',
    },
  )

  const result = await executeOneToolCall(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId: asAccountId(accountId),
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    run,
    {
      ...prepared,
      tool: genericTool,
      toolName: genericTool.name,
    },
  )

  assert.equal(result.error, undefined)
  assert.deepEqual(result.outcome, {
    kind: 'immediate',
    output: {
      exactDocument: '/api/files/fil_doc_1/content',
      inlineDocument:
        'Summarize this document:\n# Meeting Notes\n\n- finalize pricing\n- publish docs\n',
      inlineImage: 'Use this as hero: ![diagram.png](/api/files/fil_img_1/content)',
    },
  })
})

test('registerAgentNativeTools marks delegation tools to resolve attachment refs as workspace paths', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const toolRegistry = createToolRegistry()

  registerAgentNativeTools(toolRegistry, {
    db: runtime.db,
    fileStorageRoot: runtime.config.files.storage.root,
  })

  assert.equal(toolRegistry.get('delegate_to_agent')?.attachmentRefResolutionPolicy, 'path_inline')
  assert.equal(
    toolRegistry.get('resume_delegated_run')?.attachmentRefResolutionPolicy,
    'path_inline',
  )
  assert.equal(toolRegistry.get('generate_image')?.attachmentRefResolutionPolicy, 'file_id_only')
  assert.deepEqual(toolRegistry.get('generate_image')?.attachmentRefTargetKeys, ['fileId'])
})

test('registerSandboxNativeTools resolves attachment refs to file ids for sandbox attachments', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const toolRegistry = createToolRegistry()

  registerSandboxNativeTools(toolRegistry, {
    db: runtime.db,
    sandbox: runtime.services.sandbox.executions,
    writeback: runtime.services.sandbox.writeback,
  })

  for (const toolName of ['execute'] as const) {
    const tool = toolRegistry.get(toolName)

    assert.equal(tool?.attachmentRefResolutionPolicy, 'file_id_only')
    assert.deepEqual(tool?.attachmentRefTargetKeys, ['fileId'])
  }
})

test('generate_image rejects workspace attachment paths with a tool-specific validation message', async () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const granted = grantNativeToolToDefaultAgent(runtime, 'generate_image')

  assert.ok(granted)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_generate_image_refs',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Generate Image Session',
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
      id: 'thr_generate_image_refs',
      parentThreadId: null,
      sessionId: 'ses_generate_image_refs',
      status: 'active',
      tenantId,
      title: 'Generate Image Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      actorAccountId: accountId,
      agentId: granted!.agentId,
      agentRevisionId: granted!.revisionId,
      completedAt: null,
      configSnapshot: {},
      createdAt: now,
      errorJson: null,
      id: 'run_generate_image_refs',
      jobId: null,
      lastProgressAt: now,
      parentRunId: null,
      resultJson: null,
      rootRunId: 'run_generate_image_refs',
      sessionId: 'ses_generate_image_refs',
      sourceCallId: null,
      startedAt: now,
      status: 'running',
      task: 'Edit image',
      targetKind: 'agent',
      tenantId,
      threadId: 'thr_generate_image_refs',
      toolProfileId: null,
      updatedAt: now,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  const run = runtime.db.select().from(runs).where(eq(runs.id, 'run_generate_image_refs')).get()

  assert.ok(run)

  const imageTool = runtime.services.tools.get('generate_image')
  assert.ok(imageTool)

  const prepared = prepareToolExecution(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_generate_image_refs'),
      services: runtime.services,
      tenantScope: {
        accountId: asAccountId(accountId),
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_generate_image_refs'),
    },
    {
      arguments: {
        prompt: 'Resize this image to 300px width',
        references: [
          {
            fileId: '/vault/attachments/2026/04/08/a6/fil_a6ed2a7780984a6082d29585ea99c9fc.png',
          },
        ],
      },
      argumentsJson:
        '{"prompt":"Resize this image to 300px width","references":[{"fileId":"/vault/attachments/2026/04/08/a6/fil_a6ed2a7780984a6082d29585ea99c9fc.png"}]}',
      callId: 'call_generate_image_refs',
      name: 'generate_image',
    },
  )

  const result = await executeOneToolCall(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_generate_image_refs'),
      services: runtime.services,
      tenantScope: {
        accountId: asAccountId(accountId),
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_generate_image_refs'),
    },
    run,
    {
      ...prepared,
      tool: imageTool,
      toolName: imageTool.name,
    },
  )

  assert.equal(result.outcome, undefined)
  assert.equal(result.error?.type, 'validation')
  assert.match(result.error?.message ?? '', /does not accept workspace paths/)
  assert.match(result.error?.message ?? '', /\{\{attachment:/)
})

test('registerKernelNativeTools uses the shared smart-default attachment ref policy', () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const toolRegistry = createToolRegistry()

  registerKernelNativeTools(toolRegistry, {
    browser: {
      runBrowserJob: async () =>
        ok({
          artifacts: [],
          consoleOutput: null,
          durationMs: 0,
          kernelSessionId: 'kse_test',
          page: {
            title: null,
            url: null,
          },
          result: null,
          status: 'completed' as const,
        }),
    } as Parameters<typeof registerKernelNativeTools>[1]['browser'],
    db: runtime.db,
  })

  assert.equal(toolRegistry.get('browse')?.attachmentRefResolutionPolicy, 'smart_default')
})

test('executeOneToolCall returns actionable error for shorthand attachment aliases in sandbox fileId fields', async () => {
  const { runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const granted = grantNativeToolToDefaultAgent(runtime, 'sandbox_like_tool')

  assert.ok(granted)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_test',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Test Session',
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
      id: 'thr_test',
      parentThreadId: null,
      sessionId: 'ses_test',
      status: 'active',
      tenantId,
      title: 'Test Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(sessionMessages)
    .values({
      authorAccountId: accountId,
      authorKind: 'user',
      content: [{ text: 'See attachment', type: 'text' }],
      createdAt: now,
      id: 'msg_user',
      metadata: {
        attachmentFileIds: ['fil_doc_1'],
      },
      runId: null,
      sequence: 1,
      sessionId: 'ses_test',
      tenantId,
      threadId: 'thr_test',
    })
    .run()

  runtime.db
    .insert(files)
    .values({
      accessScope: 'session_local',
      checksumSha256: null,
      createdAt: now,
      createdByAccountId: accountId,
      createdByRunId: null,
      id: 'fil_doc_1',
      metadata: null,
      mimeType: 'text/markdown',
      originUploadId: null,
      originalFilename: 'notes.md',
      sizeBytes: 12,
      sourceKind: 'upload',
      status: 'ready',
      storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/2026/04/04/do/fil_doc_1.md`,
      tenantId,
      title: null,
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(fileLinks)
    .values({
      createdAt: now,
      fileId: 'fil_doc_1',
      id: 'flk_msg_1',
      linkType: 'message',
      targetId: 'msg_user',
      tenantId,
    })
    .run()

  const run = {
    agentId: granted.agentId,
    agentRevisionId: granted.revisionId,
    completedAt: null,
    configSnapshot: {},
    createdAt: now,
    errorJson: null,
    id: asRunId('run_test'),
    jobId: null,
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_test'),
    sessionId: asWorkSessionId('ses_test'),
    sourceCallId: null,
    startedAt: now,
    status: 'running' as const,
    task: 'Read the note',
    tenantId: asTenantId(tenantId),
    threadId: asSessionThreadId('thr_test'),
    toolProfileId: granted.toolProfileId,
    turnCount: 0,
    updatedAt: now,
    version: 1,
    workspaceId: null,
    workspaceRef: null,
  }

  const sandboxTool: ToolSpec<{ attachments: Array<{ fileId: string }> }> = {
    attachmentRefResolutionPolicy: 'file_id_only',
    attachmentRefTargetKeys: ['fileId'],
    domain: 'native',
    execute: async (_context, args) =>
      ok({
        kind: 'immediate',
        output: args,
      }),
    inputSchema: {
      additionalProperties: false,
      properties: {
        attachments: {
          items: {
            additionalProperties: false,
            properties: {
              fileId: { type: 'string' },
            },
            required: ['fileId'],
            type: 'object',
          },
          type: 'array',
        },
      },
      required: ['attachments'],
      type: 'object',
    },
    name: 'sandbox_like_tool',
    validateArgs: (args) => ok(args as { attachments: Array<{ fileId: string }> }),
  }

  const prepared = prepareToolExecution(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId: asAccountId(accountId),
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    {
      arguments: {
        attachments: [{ fileId: 'attachment[1]' }],
      },
      argumentsJson: '{"attachments":[{"fileId":"attachment[1]"}]}',
      callId: 'call_1',
      name: 'sandbox_like_tool',
    },
  )

  const result = await executeOneToolCall(
    {
      config: runtime.config,
      db: runtime.db,
      requestId: asRequestId('req_test'),
      services: runtime.services,
      tenantScope: {
        accountId: asAccountId(accountId),
        role: 'admin',
        tenantId: asTenantId(tenantId),
      },
      traceId: asTraceId('trace_test'),
    },
    run,
    {
      ...prepared,
      tool: sandboxTool,
      toolName: sandboxTool.name,
    },
  )

  assert.equal(result.outcome, undefined)
  assert.equal(result.error?.type, 'validation')
  assert.match(
    result.error?.message ?? '',
    /Attachment shorthand "attachment\[1]" is only a prompt alias/,
  )
})

test('thread messages route resolves assistant attachment refs to markdown and sorts attachments by metadata order', async () => {
  const { app, runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_test',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Test Session',
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
      id: 'thr_test',
      parentThreadId: null,
      sessionId: 'ses_test',
      status: 'active',
      tenantId,
      title: 'Test Thread',
      titleSource: 'manual',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(sessionMessages)
    .values([
      {
        authorAccountId: accountId,
        authorKind: 'user',
        content: [{ text: 'See attachments', type: 'text' }],
        createdAt: now,
        id: 'msg_user',
        metadata: {
          attachmentFileIds: ['fil_img_1', 'fil_doc_1'],
        },
        runId: null,
        sequence: 1,
        sessionId: 'ses_test',
        tenantId,
        threadId: 'thr_test',
      },
      {
        authorAccountId: null,
        authorKind: 'assistant',
        content: [
          {
            text: 'Use these assets:\n{{attachment:msg_msg_user:kind:image:index:1}}\n{{attachment:msg_msg_user:kind:file:index:1}}',
            type: 'text',
          },
        ],
        createdAt: '2026-04-04T10:00:03.000Z',
        id: 'msg_assistant',
        metadata: null,
        runId: null,
        sequence: 2,
        sessionId: 'ses_test',
        tenantId,
        threadId: 'thr_test',
      },
    ])
    .run()

  runtime.db
    .insert(files)
    .values([
      {
        accessScope: 'session_local',
        checksumSha256: null,
        createdAt: '2026-04-04T10:00:02.000Z',
        createdByAccountId: accountId,
        createdByRunId: null,
        id: 'fil_doc_1',
        metadata: null,
        mimeType: 'text/markdown',
        originUploadId: null,
        originalFilename: 'notes.md',
        sizeBytes: 12,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/2026/04/04/do/fil_doc_1.md`,
        tenantId,
        title: null,
        updatedAt: '2026-04-04T10:00:02.000Z',
      },
      {
        accessScope: 'session_local',
        checksumSha256: null,
        createdAt: '2026-04-04T10:00:01.000Z',
        createdByAccountId: accountId,
        createdByRunId: null,
        id: 'fil_img_1',
        metadata: null,
        mimeType: 'image/png',
        originUploadId: null,
        originalFilename: 'diagram.png',
        sizeBytes: 32,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/2026/04/04/im/fil_img_1.png`,
        tenantId,
        title: null,
        updatedAt: '2026-04-04T10:00:01.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(fileLinks)
    .values([
      {
        createdAt: now,
        fileId: 'fil_doc_1',
        id: 'flk_doc',
        linkType: 'message',
        targetId: 'msg_user',
        tenantId,
      },
      {
        createdAt: now,
        fileId: 'fil_img_1',
        id: 'flk_img',
        linkType: 'message',
        targetId: 'msg_user',
        tenantId,
      },
    ])
    .run()

  const response = await app.request(`http://local/v1/threads/thr_test/messages`, {
    headers,
  })

  assert.equal(response.status, 200)
  const payload = await response.json()
  const messages = payload.data as Array<{
    content: Array<{ text: string; type: 'text' }>
    id: string
    metadata?: {
      attachments?: Array<{ id: string; url: string }>
    } | null
  }>

  const userMessage = messages.find((message) => message.id === 'msg_user')
  const assistantMessage = messages.find((message) => message.id === 'msg_assistant')

  assert.deepEqual(
    userMessage?.metadata?.attachments?.map((attachment) => attachment.id),
    ['fil_img_1', 'fil_doc_1'],
  )
  assert.match(
    assistantMessage?.content[0]?.text ?? '',
    /!\[diagram\.png]\(\/api\/files\/fil_img_1\/content\)/,
  )
  assert.match(
    assistantMessage?.content[0]?.text ?? '',
    /\[notes\.md]\(\/api\/files\/fil_doc_1\/content\)/,
  )
})
