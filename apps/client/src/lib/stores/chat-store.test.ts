import {
  asEventId,
  asFileId,
  asMessageId,
  asRunId,
  asSessionId,
  asThreadId,
  asToolProfileId,
  BACKEND_DEFAULT_MODEL,
  type BackendEvent,
  type BackendModelsCatalog,
  type BackendRun,
  type BackendSession,
  type BackendThread,
  type BackendThreadMessage,
  type MessageAttachment,
  type RunId,
  type ThreadId,
} from '@wonderlands/contracts/chat'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { appendLargeTextPasteHiddenMetadata } from '../prompt-editor/large-paste'
import { materializeBlocks } from '../runtime/materialize'
import { setApiTenantId } from '../services/backend'

const at = '2026-03-29T12:00:00.000Z'
const STORAGE_KEY = '05_04_ui.active-thread'
const storageKeyForTenant = (tenantId: string): string => `${STORAGE_KEY}:${tenantId}`

import { createChatStore } from './chat-store.svelte.ts'
import { typewriterPlayback } from './typewriter-playback.svelte'

const originalFetch = globalThis.fetch
const createStorage = () => {
  const values = new Map<string, string>()

  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

const createEmptySseResponse = (): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.close()
      },
    }),
    {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    },
  )

beforeEach(() => {
  setApiTenantId(null)
  globalThis.fetch = (async () => createEmptySseResponse()) as typeof fetch
})

afterEach(() => {
  setApiTenantId(null)
  globalThis.fetch = originalFetch
})

const thread = (): BackendThread => ({
  createdAt: at,
  createdByAccountId: 'acc_adam_overment',
  id: asThreadId('thr_1'),
  parentThreadId: null,
  sessionId: asSessionId('ses_1'),
  status: 'active',
  tenantId: 'ten_overment',
  title: 'Backend thread',
  updatedAt: at,
})

const threadWith = (overrides: Partial<BackendThread> = {}): BackendThread => ({
  ...thread(),
  ...overrides,
})

const session = (): BackendSession => ({
  archivedAt: null,
  createdAt: at,
  createdByAccountId: 'acc_adam_overment',
  deletedAt: null,
  id: asSessionId('ses_1'),
  metadata: null,
  rootRunId: null,
  status: 'active',
  tenantId: 'ten_overment',
  title: null,
  updatedAt: at,
  workspaceId: null,
  workspaceRef: null,
})

const sessionWith = (overrides: Partial<BackendSession> = {}): BackendSession => ({
  ...session(),
  ...overrides,
})

const userMessage = (): BackendThreadMessage => ({
  authorAccountId: 'acc_adam_overment',
  authorKind: 'user',
  content: [{ text: 'Hello', type: 'text' }],
  createdAt: at,
  id: asMessageId('msg_user'),
  metadata: null,
  runId: null,
  sequence: 1,
  sessionId: asSessionId('ses_1'),
  tenantId: 'ten_overment',
  threadId: asThreadId('thr_1'),
})

const userMessageWith = (overrides: Partial<BackendThreadMessage> = {}): BackendThreadMessage => ({
  ...userMessage(),
  ...overrides,
})

const assistantMessage = (text: string, runId = asRunId('run_1')): BackendThreadMessage => ({
  authorAccountId: null,
  authorKind: 'assistant',
  content: [{ text, type: 'text' }],
  createdAt: at,
  id: asMessageId('msg_assistant'),
  metadata: null,
  runId,
  sequence: 2,
  sessionId: asSessionId('ses_1'),
  tenantId: 'ten_overment',
  threadId: asThreadId('thr_1'),
})

const assistantMessageWithMetadata = (
  text: string,
  metadata: unknown,
  runId = asRunId('run_1'),
): BackendThreadMessage => ({
  ...assistantMessage(text, runId),
  metadata,
})

const persistedToolTranscript = (remembered: boolean | null = false) => ({
  transcript: {
    toolBlocks: [
      {
        approval: {
          description: 'Confirmation required before running mcp.echo',
          remembered,
          status: remembered === null ? 'rejected' : 'approved',
          targetRef: 'mcp.echo',
          waitId: 'wte_1',
        },
        args: { value: 'hello' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:call_waiting_1',
        name: 'mcp.echo',
        output:
          remembered === null
            ? { error: { message: 'Tool call rejected by user', type: 'conflict' }, ok: false }
            : { echoed: 'hello' },
        status: remembered === null ? 'error' : 'complete',
        toolCallId: 'call_waiting_1',
        type: 'tool_interaction',
      },
    ],
    version: 1 as const,
  },
})

const persistedReasoningWaitingTranscript = () => ({
  transcript: {
    blocks: [
      {
        content: 'Need approval before calling the tool.',
        createdAt: at,
        id: 'thinking:rs_reasoning_waiting_1',
        status: 'done' as const,
        title: 'reasoning',
        type: 'thinking' as const,
      },
      {
        args: { value: 'hello' },
        confirmation: {
          description: 'Confirmation required before running mcp.echo',
          targetRef: 'mcp.echo',
          waitId: 'wte_1',
        },
        createdAt: at,
        id: 'tool:call_waiting_1',
        name: 'mcp.echo',
        status: 'awaiting_confirmation' as const,
        toolCallId: 'call_waiting_1',
        type: 'tool_interaction' as const,
      },
    ],
    toolBlocks: [],
    version: 2 as const,
    webSearchBlocks: [],
  },
})

const pendingConfirmationWait = () => ({
  args: { value: 'hello' },
  callId: 'call_waiting_1',
  createdAt: at,
  description: 'Confirmation required before running mcp.echo',
  requiresApproval: true,
  targetKind: 'human_response',
  targetRef: 'mcp.echo',
  tool: 'mcp.echo',
  type: 'human',
  waitId: 'wte_1',
})

const buildRun = (
  status: BackendRun['status'],
  overrides: Partial<BackendRun> = {},
): BackendRun => ({
  completedAt: status === 'completed' ? at : null,
  configSnapshot: {},
  createdAt: at,
  errorJson: null,
  id: asRunId('run_1'),
  lastProgressAt: at,
  parentRunId: null,
  resultJson:
    status === 'waiting' ? { pendingWaits: [pendingConfirmationWait()], waitIds: ['wte_1'] } : null,
  rootRunId: asRunId('run_1'),
  sessionId: asSessionId('ses_1'),
  sourceCallId: null,
  startedAt: at,
  status,
  task: 'Test run',
  tenantId: 'ten_overment',
  threadId: asThreadId('thr_1'),
  turnCount: 1,
  updatedAt: at,
  version: 2,
  workspaceRef: null,
  ...overrides,
})

const runEvent = (eventNo: number, type: BackendEvent['type'], payload: BackendEvent['payload']) =>
  ({
    aggregateId: 'run_1',
    aggregateType: 'run',
    createdAt: at,
    eventNo,
    id: asEventId(`evt_${eventNo}`),
    payload,
    type,
  }) as BackendEvent

const persistedRunTranscript = (
  runId: RunId,
  blocks: ReturnType<typeof materializeBlocks>,
  overrides: {
    attachments?: MessageAttachment[]
    createdAt?: string
    finishReason?: 'waiting' | 'stop' | 'cancelled' | 'error' | null
    messageId?: ReturnType<typeof asMessageId> | null
    sequence?: number | null
    status?: 'streaming' | 'waiting' | 'complete' | 'error'
    text?: string
  } = {},
) => ({
  attachments: overrides.attachments ?? [],
  blocks,
  createdAt: overrides.createdAt ?? at,
  finishReason: overrides.finishReason ?? null,
  messageId: overrides.messageId ?? asMessageId(`live:${runId}`),
  runId,
  sequence: overrides.sequence ?? null,
  status: overrides.status ?? 'streaming',
  text: overrides.text ?? '',
})

const completedInteraction = (overrides: Record<string, unknown> = {}) => ({
  assistantItemId: 'itm_interaction',
  assistantMessageId: asMessageId('msg_assistant'),
  attachedFileIds: [],
  inputMessageId: asMessageId('msg_user'),
  model: 'gpt-5.4',
  outputText: 'Interaction completed.',
  provider: 'openai',
  responseId: 'resp_interaction',
  runId: asRunId('run_interaction'),
  sessionId: asSessionId('ses_1'),
  status: 'completed' as const,
  threadId: asThreadId('thr_1'),
  usage: null,
  ...overrides,
})

describe('createChatStore', () => {
  test('hydrates available models from the backend catalog and prefers explicit defaults', async () => {
    const catalog: BackendModelsCatalog = {
      aliases: [
        {
          alias: 'default',
          configured: true,
          isDefault: true,
          model: 'gemini-2.5-flash',
          provider: 'google',
          reasoningModes: ['none'],
          supportsReasoning: true,
        },
        {
          alias: 'google_default',
          configured: true,
          isDefault: false,
          model: 'gemini-2.5-flash',
          provider: 'google',
          reasoningModes: ['none'],
          supportsReasoning: true,
        },
        {
          alias: 'openai_default',
          configured: true,
          isDefault: false,
          model: 'gpt-5.4',
          provider: 'openai',
          reasoningModes: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
          supportsReasoning: true,
        },
      ],
      defaultAlias: 'default',
      defaultModel: 'gemini-2.5-flash',
      defaultProvider: 'google',
      providers: {
        google: {
          configured: true,
          defaultModel: 'gemini-2.5-flash',
        },
        openai: {
          configured: true,
          defaultModel: 'gpt-5.4',
        },
      },
      reasoningModes: [
        { effort: 'none', label: 'No reasoning' },
        { effort: 'minimal', label: 'Minimal' },
        { effort: 'low', label: 'Low' },
        { effort: 'medium', label: 'Medium' },
        { effort: 'high', label: 'High' },
        { effort: 'xhigh', label: 'Very high' },
      ],
    }

    const store = createChatStore({
      getSupportedModels: async () => catalog,
      storage: createStorage(),
    })

    await store.hydrate()

    expect(store.availableModels).toEqual([BACKEND_DEFAULT_MODEL, 'gemini-2.5-flash', 'gpt-5.4'])
    expect(store.chatModel).toBe('gpt-5.4')
    expect(store.chatReasoningMode).toBe('medium')
    expect(store.availableReasoningModes).toEqual([
      { id: 'default', label: 'default' },
      { id: 'none', label: 'No reasoning' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'Very high' },
    ])
  })

  test('falls back to a concrete catalog model when gpt-5.4 is unavailable', async () => {
    const catalog: BackendModelsCatalog = {
      aliases: [
        {
          alias: 'default',
          configured: true,
          isDefault: true,
          model: 'gemini-2.5-flash',
          provider: 'google',
          reasoningModes: ['none'],
          supportsReasoning: true,
        },
      ],
      defaultAlias: 'default',
      defaultModel: 'gemini-2.5-flash',
      defaultProvider: 'google',
      providers: {
        google: {
          configured: true,
          defaultModel: 'gemini-2.5-flash',
        },
        openai: {
          configured: false,
          defaultModel: 'gpt-5.4',
        },
      },
      reasoningModes: [
        { effort: 'none', label: 'No reasoning' },
        { effort: 'medium', label: 'Medium' },
        { effort: 'high', label: 'High' },
      ],
    }

    const store = createChatStore({
      getSupportedModels: async () => catalog,
      storage: createStorage(),
    })

    await store.hydrate()

    expect(store.chatModel).toBe('gemini-2.5-flash')
    expect(store.chatReasoningMode).toBe('default')
    expect(store.availableReasoningModes).toEqual([
      { id: 'default', label: 'default' },
      { id: 'none', label: 'No reasoning' },
    ])
  })

  test('primeFromPersistedState restores an active run before hydrate starts', () => {
    const storage = createStorage()
    const runId = asRunId('run_prime')
    const threadId = asThreadId('thr_1')

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 7,
        activeRunTranscript: persistedRunTranscript(
          runId,
          materializeBlocks([
            runEvent(7, 'stream.delta', {
              delta: 'restored before auth finishes',
              runId,
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId,
              turn: 1,
            }),
          ]),
        ),
        runId: 'run_prime',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      storage,
    })

    store.primeFromPersistedState()

    expect(store.threadId).toBe(threadId)
    expect(store.runId).toBe(runId)
    expect(store.canCancel).toBe(true)
    expect(store.isStreaming).toBe(true)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'restored before auth finishes',
      streaming: true,
    })
  })

  test('primeFromPersistedState uses the active tenant storage scope', () => {
    const storage = createStorage()
    const scopedRunId = asRunId('run_scoped')
    const scopedThreadId = asThreadId('thr_scoped')

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 3,
        runId: 'run_legacy',
        sessionId: 'ses_legacy',
        threadId: 'thr_legacy',
      }),
    )
    storage.setItem(
      storageKeyForTenant('ten_scoped'),
      JSON.stringify({
        eventCursor: 11,
        activeRunTranscript: persistedRunTranscript(
          scopedRunId,
          materializeBlocks([
            runEvent(11, 'stream.delta', {
              delta: 'scoped restore',
              runId: scopedRunId,
              sessionId: asSessionId('ses_scoped'),
              status: 'running',
              threadId: scopedThreadId,
              turn: 1,
            }),
          ]),
        ),
        runId: 'run_scoped',
        sessionId: 'ses_scoped',
        threadId: 'thr_scoped',
      }),
    )

    setApiTenantId('ten_scoped')

    const store = createChatStore({
      storage,
    })

    store.primeFromPersistedState()

    expect(store.threadId).toBe(scopedThreadId)
    expect(store.runId).toBe(scopedRunId)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'scoped restore',
      streaming: true,
    })
  })

  test('hydrate restores a persisted active run without waiting for models or preferences', async () => {
    const storage = createStorage()
    const runId = asRunId('run_unblocked_restore')
    const threadId = asThreadId('thr_1')

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 9,
        activeRunTranscript: persistedRunTranscript(
          runId,
          materializeBlocks([
            runEvent(9, 'stream.delta', {
              delta: 'available immediately',
              runId,
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId,
              turn: 1,
            }),
          ]),
          {
            messageId: asMessageId('live:run_unblocked_restore'),
          },
        ),
        runId: 'run_unblocked_restore',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getAccountPreferences: async () => new Promise<BackendAccountPreferences>(() => {}),
      getRun: async () =>
        buildRun('running', {
          id: runId,
          rootRunId: runId,
          threadId,
        }),
      getSupportedModels: async () => new Promise<BackendModelsCatalog>(() => {}),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      replayRunEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(9, 'stream.delta', {
            delta: 'available immediately',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId,
            turn: 1,
          }),
        ])
      },
      storage,
      streamThreadEvents: async () => undefined,
    })

    const hydratePromise = store.hydrate()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.runId).toBe(runId)
    expect(store.canCancel).toBe(true)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'available immediately',
      streaming: true,
    })

    await hydratePromise

    expect(store.isLoading).toBe(false)
  })

  test('hydrates durable thread history from stored backend ids', async () => {
    const storage = createStorage()
    const persistedAttachment: MessageAttachment = {
      id: 'fil_1',
      kind: 'image',
      mime: 'image/png',
      name: 'preview.png',
      size: 1024,
      thumbnailUrl: '/v1/files/fil_1/content',
      url: '/v1/files/fil_1/content',
    }
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        attachmentsByMessageId: {
          msg_user: [persistedAttachment],
        },
        eventCursor: 18,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage(), assistantMessage('Hydrated answer')],
      storage,
    })

    await store.hydrate()

    expect(store.sessionId).toBe('ses_1')
    expect(store.threadId).toBe('thr_1')
    expect(store.title).toBe('Backend thread')
    expect(store.messages).toHaveLength(2)
    expect(store.messages[0]?.attachments).toEqual([persistedAttachment])
    expect(store.messages[1]?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Hydrated answer',
      streaming: false,
    })
  })

  test('hydrates persisted tool approval history from assistant metadata', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 18,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => [
        userMessage(),
        assistantMessageWithMetadata('Hydrated tool answer.', persistedToolTranscript(false)),
      ],
      storage,
    })

    await store.hydrate()

    expect(store.messages[1]?.blocks).toMatchObject([
      {
        approval: {
          remembered: false,
          status: 'approved',
          waitId: 'wte_1',
        },
        args: { value: 'hello' },
        name: 'mcp.echo',
        output: { echoed: 'hello' },
        status: 'complete',
        type: 'tool_interaction',
      },
      {
        content: 'Hydrated tool answer.',
        type: 'text',
      },
    ])
  })

  test('hydrates cancelled assistant finish reason from persisted metadata after refresh', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 18,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const cancelledTranscript = persistedReasoningWaitingTranscript().transcript

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => [
        userMessage(),
        assistantMessageWithMetadata('Need approval before I can finish.', {
          finishReason: 'cancelled',
          transcript: cancelledTranscript,
        }),
      ],
      storage,
    })

    await store.hydrate()

    expect(store.messages[1]?.finishReason).toBe('cancelled')
    expect(store.messages[1]?.blocks).toMatchObject([
      {
        content: 'Need approval before calling the tool.',
        status: 'done',
        type: 'thinking',
      },
      {
        confirmation: undefined,
        name: 'mcp.echo',
        status: 'error',
        type: 'tool_interaction',
      },
      {
        content: 'Need approval before I can finish.',
        streaming: false,
        type: 'text',
      },
    ])
  })

  test('hydrates the last persisted thread budget when reopening an existing thread', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 18,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getThread: async () => thread(),
      getThreadBudget: async () => ({
        actualInputTokens: 3_900,
        actualOutputTokens: 640,
        actualTotalTokens: 4_540,
        cachedInputTokens: 120,
        contextWindow: 128_000,
        estimatedInputTokens: 4_096,
        measuredAt: '2026-03-30T12:00:00.000Z',
        model: 'gpt-5.4',
        provider: 'openai',
        reasoningTokens: 32,
        reservedOutputTokens: 2_048,
        stablePrefixTokens: 3_072,
        turn: 3,
        volatileSuffixTokens: 1_024,
      }),
      listThreadMessages: async () => [userMessage(), assistantMessage('Hydrated answer')],
      storage,
    })

    await store.hydrate()

    expect(store.contextBudget).toEqual({
      actualInputTokens: 3_900,
      actualOutputTokens: 640,
      actualTotalTokens: 4_540,
      cachedInputTokens: 120,
      contextWindow: 128_000,
      estimatedInputTokens: 4_096,
      liveOutputTokens: 0,
      liveOutputText: '',
      measuredAt: '2026-03-30T12:00:00.000Z',
      model: 'gpt-5.4',
      provider: 'openai',
      reasoningTokens: 32,
      reservedOutputTokens: 2_048,
      stablePrefixTokens: 3_072,
      turn: 3,
      volatileSuffixTokens: 1_024,
    })
    expect(store.contextWindow).toBe(128_000)
  })

  test('switches to another thread and persists the active thread selection', async () => {
    const storage = createStorage()
    const targetThread = threadWith({
      id: asThreadId('thr_2'),
      sessionId: asSessionId('ses_2'),
      title: 'Second thread',
    })

    const store = createChatStore({
      listThreadMessages: async (threadId) =>
        threadId === asThreadId('thr_2')
          ? [
              userMessageWith({
                id: asMessageId('msg_thr_2'),
                sessionId: asSessionId('ses_2'),
                threadId: asThreadId('thr_2'),
              }),
            ]
          : [userMessage()],
      storage,
    })

    await store.switchToThread(targetThread)

    expect(store.sessionId).toBe('ses_2')
    expect(store.threadId).toBe('thr_2')
    expect(store.title).toBe('Second thread')
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]?.id).toBe(asMessageId('msg_thr_2'))

    const persisted = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as {
      sessionId?: string
      threadId?: string
    }
    expect(persisted.sessionId).toBe('ses_2')
    expect(persisted.threadId).toBe('thr_2')
  })

  test('switching threads clears stale context budget when the next thread has no persisted snapshot', async () => {
    const store = createChatStore({
      getThreadBudget: async (threadId) =>
        threadId === asThreadId('thr_1')
          ? {
              actualInputTokens: 1_980,
              actualOutputTokens: 320,
              actualTotalTokens: 2_300,
              cachedInputTokens: 40,
              contextWindow: 128_000,
              estimatedInputTokens: 2_048,
              measuredAt: '2026-03-30T12:00:00.000Z',
              model: 'gpt-5.4',
              provider: 'openai',
              reasoningTokens: 16,
              reservedOutputTokens: 1_024,
              stablePrefixTokens: 1_536,
              turn: 2,
              volatileSuffixTokens: 512,
            }
          : null,
      listThreadMessages: async () => [userMessage()],
      storage: createStorage(),
    })

    await store.switchToThread(thread())
    expect(store.contextBudget?.estimatedInputTokens).toBe(2_048)

    await store.switchToThread(
      threadWith({
        id: asThreadId('thr_2'),
        sessionId: asSessionId('ses_2'),
        title: 'Second thread',
      }),
    )

    expect(store.contextBudget).toBeNull()
  })

  test('switchToThread ignores delayed message loads from a thread that is no longer active', async () => {
    let resolveThread1Messages!: (messages: BackendThreadMessage[]) => void
    const thread1Messages = new Promise<BackendThreadMessage[]>((resolve) => {
      resolveThread1Messages = resolve
    })

    const store = createChatStore({
      listThreadMessages: async (threadId) =>
        threadId === asThreadId('thr_1')
          ? thread1Messages
          : [
              userMessageWith({
                id: asMessageId('msg_thr_2'),
                sessionId: asSessionId('ses_2'),
                threadId: asThreadId('thr_2'),
              }),
            ],
      storage: createStorage(),
    })

    const staleSwitch = store.switchToThread(thread())
    await Promise.resolve()

    await store.switchToThread(
      threadWith({
        id: asThreadId('thr_2'),
        sessionId: asSessionId('ses_2'),
        title: 'Second thread',
      }),
    )

    resolveThread1Messages([
      userMessageWith({
        id: asMessageId('msg_thr_1_delayed'),
        sessionId: asSessionId('ses_1'),
        threadId: asThreadId('thr_1'),
      }),
    ])
    await staleSwitch

    expect(store.threadId).toBe('thr_2')
    expect(store.title).toBe('Second thread')
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]?.id).toBe(asMessageId('msg_thr_2'))
  })

  test('switchToThread hydrates an active root run and blocks message edits until it settles', async () => {
    const targetThreadId = asThreadId('thr_2')
    const targetSessionId = asSessionId('ses_2')
    const targetRunId = asRunId('run_thr_2_active')
    const streamCalls: ThreadId[] = []

    const store = createChatStore({
      getRun: async (runId) =>
        buildRun('running', {
          id: runId,
          rootRunId: runId,
          sessionId: targetSessionId,
          threadId: targetThreadId,
        }),
      listThreadMessages: async (threadId) =>
        threadId === targetThreadId
          ? [
              userMessageWith({
                id: asMessageId('msg_thr_2_user'),
                runId: targetRunId,
                sessionId: targetSessionId,
                threadId: targetThreadId,
              }),
            ]
          : [userMessage()],
      storage: createStorage(),
      streamThreadEvents: async ({ threadId }) => {
        streamCalls.push(threadId)
      },
    })

    await store.switchToThread(
      threadWith({
        id: targetThreadId,
        rootJob: {
          currentRunId: targetRunId,
          id: 'job_thr_2_root',
          status: 'running',
        },
        sessionId: targetSessionId,
        title: 'Active thread',
      }),
    )
    await Promise.resolve()

    expect(store.runId).toBe(targetRunId)
    expect(store.isStreaming).toBe(true)
    expect(store.beginMessageEdit(asMessageId('msg_thr_2_user'))).toBe(false)
    expect(streamCalls).toEqual([targetThreadId])
  })

  test('a stale submit cannot overwrite the thread selected after switching away', async () => {
    let resolveInteraction!: (value: ReturnType<typeof completedInteraction>) => void
    const interactionPromise = new Promise<ReturnType<typeof completedInteraction>>((resolve) => {
      resolveInteraction = resolve
    })

    const createdThread = threadWith({
      id: asThreadId('thr_created'),
      sessionId: asSessionId('ses_created'),
      title: 'Created thread',
    })
    const switchedThread = threadWith({
      id: asThreadId('thr_switched'),
      sessionId: asSessionId('ses_switched'),
      title: 'Switched thread',
    })

    const threadMessages = new Map<ThreadId, BackendThreadMessage[]>([
      [
        asThreadId('thr_created'),
        [
          userMessageWith({
            content: [{ text: 'Old question', type: 'text' }],
            id: asMessageId('msg_created_user'),
            sessionId: asSessionId('ses_created'),
            threadId: asThreadId('thr_created'),
          }),
          {
            ...assistantMessage('Old reply.', asRunId('run_created')),
            id: asMessageId('msg_created_assistant'),
            sessionId: asSessionId('ses_created'),
            threadId: asThreadId('thr_created'),
          },
        ],
      ],
      [
        asThreadId('thr_switched'),
        [
          userMessageWith({
            content: [{ text: 'Current thread message', type: 'text' }],
            id: asMessageId('msg_switched_user'),
            sessionId: asSessionId('ses_switched'),
            threadId: asThreadId('thr_switched'),
          }),
        ],
      ],
    ])

    const store = createChatStore({
      createSession: async () => sessionWith({ id: asSessionId('ses_created') }),
      createSessionThread: async (sessionId) => threadWith({ ...createdThread, sessionId }),
      getThread: async (threadId) =>
        threadId === asThreadId('thr_switched') ? switchedThread : createdThread,
      listThreadMessages: async (threadId) => threadMessages.get(threadId) ?? [],
      startThreadInteraction: async () => interactionPromise,
      storage: createStorage(),
      streamThreadEvents: async ({ signal }) => {
        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    const staleSubmit = store.submit('Old question')
    await Promise.resolve()
    await Promise.resolve()

    await store.switchToThread(switchedThread)

    resolveInteraction(
      completedInteraction({
        assistantMessageId: asMessageId('msg_created_assistant'),
        inputMessageId: asMessageId('msg_created_user'),
        outputText: 'Old reply.',
        runId: asRunId('run_created'),
        sessionId: asSessionId('ses_created'),
        threadId: asThreadId('thr_created'),
      }),
    )

    await staleSubmit

    expect(store.threadId).toBe('thr_switched')
    expect(store.sessionId).toBe('ses_switched')
    expect(store.title).toBe('Switched thread')
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]?.id).toBe(asMessageId('msg_switched_user'))
  })

  test('context budget tracks streamed output estimates and reconciles to refreshed thread state', async () => {
    const snapshots: Array<Record<string, unknown> | null> = []
    let store: ReturnType<typeof createChatStore>

    store = createChatStore({
      createSession: async () => sessionWith({ id: asSessionId('ses_1') }),
      createSessionThread: async (sessionId) => threadWith({ id: asThreadId('thr_1'), sessionId }),
      startThreadInteraction: async () =>
        completedInteraction({
          model: 'gpt-5.4',
          outputText: 'Hello world',
          runId: asRunId('run_1'),
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
          usage: {
            cachedTokens: 100,
            inputTokens: 4_100,
            outputTokens: 7,
            reasoningTokens: 2,
            totalTokens: 4_107,
          },
        }),
      getThread: async () => thread(),
      getThreadBudget: async () => ({
        actualInputTokens: 4_100,
        actualOutputTokens: 7,
        actualTotalTokens: 4_107,
        cachedInputTokens: 100,
        contextWindow: 128_000,
        estimatedInputTokens: 1_800,
        measuredAt: '2026-03-30T12:05:00.000Z',
        model: 'gpt-5.4',
        provider: 'openai',
        reasoningTokens: 2,
        reservedOutputTokens: 2_048,
        stablePrefixTokens: 1_100,
        turn: 2,
        volatileSuffixTokens: 700,
      }),
      listThreadMessages: async () => [userMessage(), assistantMessage('Hello world')],
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(3, 'turn.started', {
            estimatedInputTokens: 4_000,
            observationCount: 0,
            pendingWaitCount: 0,
            reservedOutputTokens: 2_048,
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            stablePrefixTokens: 3_000,
            summaryId: null,
            threadId: asThreadId('thr_1'),
            turn: 1,
            volatileSuffixTokens: 1_000,
          }),
        ])
        snapshots.push(store.contextBudget ? JSON.parse(JSON.stringify(store.contextBudget)) : null)

        onEvents([
          runEvent(4, 'stream.delta', {
            delta: 'Hello world',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
        ])
        snapshots.push(store.contextBudget ? JSON.parse(JSON.stringify(store.contextBudget)) : null)

        onEvents([
          runEvent(5, 'generation.completed', {
            model: 'gpt-5.4',
            outputItemCount: 1,
            outputText: 'Hello world',
            provider: 'openai',
            providerRequestId: null,
            responseId: 'resp_1',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
            toolCallCount: 0,
            turn: 1,
            usage: {
              cachedTokens: 100,
              inputTokens: 4_100,
              outputTokens: 7,
              reasoningTokens: 2,
              totalTokens: 4_107,
            },
          }),
        ])
        snapshots.push(store.contextBudget ? JSON.parse(JSON.stringify(store.contextBudget)) : null)

        onEvents([
          runEvent(6, 'run.completed', {
            outputText: 'Hello world',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.submit('Plan the next step')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(snapshots[0]).toMatchObject({
      actualInputTokens: null,
      actualOutputTokens: null,
      estimatedInputTokens: 4_000,
      liveOutputTokens: 0,
      liveOutputText: '',
    })
    expect(snapshots[1]).toMatchObject({
      estimatedInputTokens: 4_000,
      liveOutputTokens: 3,
      liveOutputText: 'Hello world',
    })
    expect(snapshots[2]).toMatchObject({
      actualInputTokens: 4_100,
      actualOutputTokens: 7,
      cachedInputTokens: 100,
      liveOutputTokens: 7,
      liveOutputText: 'Hello world',
    })
    expect(store.contextBudget).toEqual({
      actualInputTokens: 4_100,
      actualOutputTokens: 7,
      actualTotalTokens: 4_107,
      cachedInputTokens: 100,
      contextWindow: 128_000,
      estimatedInputTokens: 1_800,
      liveOutputTokens: 0,
      liveOutputText: '',
      measuredAt: '2026-03-30T12:05:00.000Z',
      model: 'gpt-5.4',
      provider: 'openai',
      reasoningTokens: 2,
      reservedOutputTokens: 2_048,
      stablePrefixTokens: 1_100,
      turn: 2,
      volatileSuffixTokens: 700,
    })
  })

  test('renameCurrentThread updates the local title from the backend response', async () => {
    const store = createChatStore({
      listThreadMessages: async () => [userMessage()],
      renameThread: async (_threadId, title) =>
        threadWith({
          title,
          updatedAt: '2026-03-30T13:00:00.000Z',
        }),
      storage: createStorage(),
    })

    await store.switchToThread(thread())
    await store.renameCurrentThread('Renamed thread')

    expect(store.title).toBe('Renamed thread')
  })

  test('thread.naming.completed applies the title immediately when it arrives before thread.updated', async () => {
    const runId = asRunId('run_thread_naming')
    const inputId = asMessageId('msg_thread_naming_input')
    let backendThreadTitle: string | null = null
    let titleAfterNamingCompleted: string | null = null
    let namingAfterNamingCompleted: boolean | null = null
    let store!: ReturnType<typeof createChatStore>

    store = createChatStore({
      getThread: async () => threadWith({ title: backendThreadTitle }),
      listThreadMessages: async () => [userMessage()],
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        provider: 'openai',
        responseId: null,
        runId,
        sessionId: asSessionId('ses_1'),
        status: 'completed',
        threadId: asThreadId('thr_1'),
        usage: null,
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId,
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          {
            aggregateId: 'thr_1',
            aggregateType: 'session_thread',
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_thread_naming_requested'),
            payload: {
              requestId: 'tnr_1',
              requestedAt: at,
              sessionId: asSessionId('ses_1'),
              sourceRunId: runId,
              threadId: asThreadId('thr_1'),
              trigger: 'auto_first_message',
            },
            type: 'thread.naming.requested',
          } satisfies BackendEvent,
          {
            aggregateId: 'thr_1',
            aggregateType: 'session_thread',
            createdAt: at,
            eventNo: 4,
            id: asEventId('evt_thread_naming_completed'),
            payload: {
              applied: true,
              requestId: 'tnr_1',
              sessionId: asSessionId('ses_1'),
              sourceRunId: runId,
              threadId: asThreadId('thr_1'),
              title: 'Named before update',
              titleSource: 'auto_first_message',
              trigger: 'auto_first_message',
            },
            type: 'thread.naming.completed',
          } satisfies BackendEvent,
        ])

        titleAfterNamingCompleted = store.currentThreadTitle
        namingAfterNamingCompleted = store.isThreadNaming
        backendThreadTitle = 'Named before update'

        onEvents([
          {
            aggregateId: 'thr_1',
            aggregateType: 'session_thread',
            createdAt: at,
            eventNo: 5,
            id: asEventId('evt_thread_updated'),
            payload: {
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              title: 'Named before update',
              titleSource: 'auto_first_message',
              updatedAt: at,
            },
            type: 'thread.updated',
          } satisfies BackendEvent,
          runEvent(6, 'run.completed', {
            outputText: '',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.switchToThread(threadWith({ title: null }))
    await store.submit('Name this thread')

    expect(titleAfterNamingCompleted).toBe('Named before update')
    expect(namingAfterNamingCompleted).toBe(false)
    expect(store.currentThreadTitle).toBe('Named before update')
  })

  test('deleteCurrentThread clears the active thread after backend deletion', async () => {
    const storage = createStorage()
    const deletedThreadIds: string[] = []

    const store = createChatStore({
      deleteThread: async (threadId) => {
        deletedThreadIds.push(threadId)
      },
      listThreadMessages: async () => [userMessage()],
      storage,
    })

    await store.switchToThread(thread())
    await store.deleteCurrentThread()

    expect(deletedThreadIds).toEqual(['thr_1'])
    expect(store.threadId).toBe(null)
    expect(store.sessionId).toBe(null)
    expect(store.messages).toEqual([])
    expect(store.title).toBe('Streaming Agent UI')
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  test('beginMessageEdit rehydrates a user message with persisted attachments into an isolated draft', async () => {
    const storage = createStorage()
    const persistedAttachment: MessageAttachment = {
      id: 'fil_edit_1',
      kind: 'image',
      mime: 'image/png',
      name: 'edit-preview.png',
      size: 2_048,
      thumbnailUrl: '/v1/files/fil_edit_1/content',
      url: '/v1/files/fil_edit_1/content',
    }
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        attachmentsByMessageId: {
          msg_user: [persistedAttachment],
        },
        eventCursor: 0,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage(), assistantMessage('Hydrated answer')],
      storage,
    })

    await store.hydrate()

    expect(store.beginMessageEdit(asMessageId('msg_assistant'))).toBe(false)
    expect(store.beginMessageEdit(asMessageId('msg_user'))).toBe(true)
    expect(store.messageEditDraft).toMatchObject({
      attachments: [persistedAttachment],
      messageId: asMessageId('msg_user'),
      text: 'Hello',
    })

    const mutatedDraft = store.messageEditDraft
    expect(mutatedDraft).not.toBeNull()
    if (!mutatedDraft) {
      throw new Error('Expected an active message edit draft.')
    }
    mutatedDraft.text = 'Changed'
    mutatedDraft.attachments[0]!.name = 'changed.png'

    expect(store.messageEditDraft).toMatchObject({
      attachments: [persistedAttachment],
      messageId: asMessageId('msg_user'),
      text: 'Hello',
    })

    store.cancelMessageEdit()

    expect(store.messageEditDraft).toBeNull()
  })

  test('successful submit clears the active message edit draft', async () => {
    const editedPayloads: Array<Record<string, unknown>> = []
    const interactionPayloads: Array<Record<string, unknown>> = []
    let messages: BackendThreadMessage[] = [userMessage()]

    const store = createChatStore({
      editThreadMessage: async (threadId, messageId, input) => {
        editedPayloads.push({
          fileIds: input.fileIds,
          messageId,
          text: input.text,
          threadId,
        })

        messages = [
          userMessageWith({
            content: [{ text: input.text ?? '', type: 'text' }],
            id: asMessageId('msg_user'),
            runId: null,
            sequence: 1,
          }),
        ]

        return {
          attachedFileIds: [],
          messageId: asMessageId('msg_user'),
          sessionId: asSessionId('ses_1'),
          threadId,
        }
      },
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId, input) => {
        interactionPayloads.push({
          messageId: input.messageId,
          threadId,
        })
        messages = [
          userMessageWith({
            content: [{ text: 'Edited hello', type: 'text' }],
            id: asMessageId('msg_user'),
            runId: asRunId('run_edit'),
            sequence: 1,
          }),
          {
            ...assistantMessage('Edited answer', asRunId('run_edit')),
            id: asMessageId('msg_edited_assistant'),
            sequence: 2,
          },
        ]

        return {
          assistantItemId: 'itm_edit',
          assistantMessageId: asMessageId('msg_edited_assistant'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_edited_user'),
          model: 'gpt-5.4',
          outputText: 'Edited answer',
          provider: 'openai',
          responseId: 'resp_edit',
          runId: asRunId('run_edit'),
          sessionId: asSessionId('ses_1'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage: createStorage(),
      streamThreadEvents: async () => {
        await Promise.resolve()
      },
    })

    await store.switchToThread(thread())

    expect(store.beginMessageEdit(asMessageId('msg_user'))).toBe(true)
    expect(await store.submit('Edited hello')).toBe(true)
    expect(editedPayloads).toEqual([
      {
        fileIds: [],
        messageId: asMessageId('msg_user'),
        text: 'Edited hello',
        threadId: asThreadId('thr_1'),
      },
    ])
    expect(interactionPayloads).toEqual([
      {
        messageId: asMessageId('msg_user'),
        threadId: asThreadId('thr_1'),
      },
    ])
    expect(store.messageEditDraft).toBeNull()
  })

  test('failed submit preserves the active message edit draft', async () => {
    const store = createChatStore({
      editThreadMessage: async (threadId, messageId, input) => ({
        attachedFileIds: input.fileIds.map((fileId) => asFileId(String(fileId))),
        messageId,
        sessionId: asSessionId('ses_1'),
        threadId,
      }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      startThreadInteraction: async () => {
        throw new Error('socket hang up')
      },
      storage: createStorage(),
      streamThreadEvents: async () => {
        await Promise.resolve()
      },
    })

    await store.switchToThread(thread())

    expect(store.beginMessageEdit(asMessageId('msg_user'))).toBe(true)
    const activeDraft = store.messageEditDraft

    expect(await store.submit('Edited hello')).toBe(false)
    expect(store.error).toBe('socket hang up')
    expect(store.messageEditDraft).toMatchObject({
      attachments: [],
      messageId: asMessageId('msg_user'),
      text: 'Edited hello',
    })
    expect(store.messageEditDraft?.activationId).toBe(activeDraft?.activationId)
  })

  test('failed submit on an existing thread removes the still-pending optimistic user row after refresh', async () => {
    const submittedText = 'Play Nora En Pure - Memories'
    const durableUser = userMessageWith({
      content: [{ text: submittedText, type: 'text' }],
      id: asMessageId('msg_existing_user'),
    })

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => [durableUser],
      startThreadInteraction: async () => {
        throw new Error(`thread ${thread().id} already has an active run`)
      },
      storage: createStorage(),
      streamThreadEvents: async () => {
        await Promise.resolve()
      },
    })

    await store.switchToThread(thread())

    expect(await store.submit(submittedText)).toBe(false)
    expect(store.error).toBe(`thread ${thread().id} already has an active run`)
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0]).toMatchObject({
      id: asMessageId('msg_existing_user'),
      role: 'user',
      text: submittedText,
    })
  })

  test('edit submit allows attachment-only reruns for an existing message', async () => {
    const attachment: MessageAttachment = {
      id: 'fil_attachment_only',
      kind: 'file',
      mime: 'text/plain',
      name: 'attachment-only.txt',
      size: 128,
      url: '/v1/files/fil_attachment_only/content',
    }
    const editedPayloads: Array<Record<string, unknown>> = []
    const interactionPayloads: Array<Record<string, unknown>> = []

    const store = createChatStore({
      editThreadMessage: async (threadId, messageId, input) => {
        editedPayloads.push({
          fileIds: input.fileIds,
          messageId,
          text: input.text,
          threadId,
        })

        return {
          attachedFileIds: [asFileId('fil_attachment_only')],
          messageId,
          sessionId: asSessionId('ses_1'),
          threadId,
        }
      },
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      startThreadInteraction: async (threadId, input) => {
        interactionPayloads.push({
          messageId: input.messageId,
          text: input.text,
          threadId,
        })

        return completedInteraction({
          inputMessageId: asMessageId('msg_user'),
          runId: asRunId('run_attachment_only'),
          threadId,
        })
      },
      storage: createStorage(),
      streamThreadEvents: async () => {
        await Promise.resolve()
      },
    })

    await store.switchToThread(thread())

    expect(store.beginMessageEdit(asMessageId('msg_user'))).toBe(true)
    expect(await store.submit('', [attachment])).toBe(true)
    expect(editedPayloads).toEqual([
      {
        fileIds: ['fil_attachment_only'],
        messageId: asMessageId('msg_user'),
        text: undefined,
        threadId: asThreadId('thr_1'),
      },
    ])
    expect(interactionPayloads).toEqual([
      {
        messageId: asMessageId('msg_user'),
        text: undefined,
        threadId: asThreadId('thr_1'),
      },
    ])
  })

  test('first submit creates a session and thread, defers model choice to the backend, and reconciles durable history', async () => {
    const storage = createStorage()
    const createSessionCalls: Array<Record<string, unknown>> = []
    const createThreadCalls: Array<Record<string, unknown>> = []
    const interactionCalls: Array<Record<string, unknown>> = []
    let listCalls = 0

    const store = createChatStore({
      createSession: async (input) => {
        createSessionCalls.push(input)
        return sessionWith({ id: asSessionId('ses_1') })
      },
      createSessionThread: async (sessionId, input) => {
        createThreadCalls.push({ input, sessionId })
        return threadWith({ id: asThreadId('thr_1'), sessionId })
      },
      startThreadInteraction: async (threadId, input) => {
        interactionCalls.push({ input, threadId })
        return completedInteraction({
          model: 'gpt-5.4',
          outputText: 'Start with SSE replay.',
          runId: asRunId('run_1'),
          sessionId: asSessionId('ses_1'),
          threadId,
        })
      },
      getThread: async () => thread(),
      listThreadMessages: async () => {
        listCalls += 1
        return [userMessage(), assistantMessage('Start with SSE replay.')]
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(3, 'stream.delta', {
            delta: 'Start with SSE replay.',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(4, 'stream.done', {
            model: 'gpt-5.4',
            provider: 'openai',
            responseId: 'resp_1',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            text: 'Start with SSE replay.',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(5, 'message.posted', {
            messageId: asMessageId('msg_assistant'),
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(6, 'run.completed', {
            outputText: 'Start with SSE replay.',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    expect(store.chatModel).toBe(BACKEND_DEFAULT_MODEL)

    await store.submit('Plan the next step')

    expect(createSessionCalls).toEqual([{}])
    expect(createThreadCalls).toEqual([
      {
        input: {},
        sessionId: asSessionId('ses_1'),
      },
    ])
    expect(interactionCalls).toEqual([
      {
        input: {
          text: 'Plan the next step',
        },
        threadId: asThreadId('thr_1'),
      },
    ])
    expect(store.sessionId).toBe('ses_1')
    expect(store.threadId).toBe('thr_1')
    expect(store.runId).toBe(null)
    expect(store.error).toBe(null)
    expect(store.messages).toHaveLength(2)
    expect(store.messages[1]?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Start with SSE replay.',
    })
    expect(listCalls).toBeGreaterThan(0)
  })

  test('first submit mounts a live assistant row before the first interaction resolves and replaces it with the durable assistant message', async () => {
    const storage = createStorage()
    let resolveInteraction!: (value: ReturnType<typeof completedInteraction>) => void
    const interactionPromise = new Promise<ReturnType<typeof completedInteraction>>((resolve) => {
      resolveInteraction = resolve
    })

    const store = createChatStore({
      completedResponseStreamDrainMs: 25,
      createSession: async () => sessionWith({ id: asSessionId('ses_1') }),
      createSessionThread: async (sessionId) => threadWith({ id: asThreadId('thr_1'), sessionId }),
      startThreadInteraction: async () => interactionPromise,
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage(), assistantMessage('Start with SSE replay.')],
      storage,
      streamThreadEvents: async ({ signal }) => {
        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    const submitPromise = store.submit('Plan the next step')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const liveAssistant = store.messages.find((message) => message.role === 'assistant')
    expect(liveAssistant?.status).toBe('streaming')
    expect(liveAssistant?.blocks).toEqual([])
    expect(liveAssistant?.uiKey).toBeTruthy()
    const liveUiKey = liveAssistant?.uiKey

    resolveInteraction(
      completedInteraction({
        model: 'gpt-5.4',
        outputText: 'Start with SSE replay.',
        runId: asRunId('run_1'),
        sessionId: asSessionId('ses_1'),
        threadId: asThreadId('thr_1'),
      }),
    )

    await submitPromise

    const durableAssistant = store.messages.find((message) => message.role === 'assistant')
    expect(durableAssistant?.id).toBe(asMessageId('msg_assistant'))
    expect(durableAssistant?.uiKey).toBe(liveUiKey)
    expect(durableAssistant?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Start with SSE replay.',
    })
  })

  test('first submit keeps the empty live assistant row mounted when the user message posts before the interaction resolves', async () => {
    const storage = createStorage()
    let resolveInteraction!: (value: ReturnType<typeof completedInteraction>) => void
    const interactionPromise = new Promise<ReturnType<typeof completedInteraction>>((resolve) => {
      resolveInteraction = resolve
    })
    const persistedUserMessage = userMessageWith({
      id: asMessageId('msg_live_user'),
      sessionId: asSessionId('ses_1'),
      threadId: asThreadId('thr_1'),
    })
    let messages: BackendThreadMessage[] = []

    const store = createChatStore({
      createSession: async () => sessionWith({ id: asSessionId('ses_1') }),
      createSessionThread: async (sessionId) => threadWith({ id: asThreadId('thr_1'), sessionId }),
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async () => interactionPromise,
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        messages = [persistedUserMessage]
        onEvents([
          {
            aggregateId: 'msg_live_user',
            aggregateType: 'session_message',
            createdAt: at,
            eventNo: 1,
            id: asEventId('evt_live_user_only'),
            payload: {
              messageId: asMessageId('msg_live_user'),
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
            },
            type: 'message.posted',
          } as BackendEvent,
        ])
      },
    })

    const submitPromise = store.submit('Plan the next step')
    await Promise.resolve()
    await Promise.resolve()

    expect(store.messages).toHaveLength(2)
    expect(store.messages[0]?.id).toBe(asMessageId('msg_live_user'))
    expect(store.messages[1]).toMatchObject({
      role: 'assistant',
      status: 'streaming',
      text: '',
    })

    messages = [
      persistedUserMessage,
      {
        ...assistantMessage('Start with SSE replay.', asRunId('run_1')),
        id: asMessageId('msg_assistant_live'),
        sessionId: asSessionId('ses_1'),
        threadId: asThreadId('thr_1'),
      },
    ]
    resolveInteraction(
      completedInteraction({
        outputText: 'Start with SSE replay.',
        runId: asRunId('run_1'),
        sessionId: asSessionId('ses_1'),
        threadId: asThreadId('thr_1'),
      }),
    )

    await submitPromise
  })

  test('first submit preserves a short drain window so delayed first-turn follow events can land', async () => {
    let emittedBeforeAbort = false

    const store = createChatStore({
      completedResponseStreamDrainMs: 25,
      createSession: async () => sessionWith({ id: asSessionId('ses_1') }),
      createSessionThread: async (sessionId) => threadWith({ id: asThreadId('thr_1'), sessionId }),
      startThreadInteraction: async () =>
        completedInteraction({
          model: 'gpt-5.4',
          outputText: 'Delivered after bootstrap catch-up.',
          runId: asRunId('run_1'),
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => [
        userMessage(),
        assistantMessage('Delivered after bootstrap catch-up.'),
      ],
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents, signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 10))

        if (signal?.aborted) {
          throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
        }

        emittedBeforeAbort = true
        onEvents([
          runEvent(1, 'run.created', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(3, 'stream.delta', {
            delta: 'Delivered after bootstrap catch-up.',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(4, 'run.completed', {
            outputText: 'Delivered after bootstrap catch-up.',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.submit('Plan the next step')

    expect(emittedBeforeAbort).toBe(true)
    expect(store.error).toBe(null)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Delivered after bootstrap catch-up.',
    })
  })

  test('submit handles a waiting first-turn interaction response without a follow-up execute request', async () => {
    const store = createChatStore({
      createSession: async () => sessionWith({ id: asSessionId('ses_1') }),
      createSessionThread: async (sessionId) => threadWith({ id: asThreadId('thr_1'), sessionId }),
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: asMessageId('msg_user'),
        model: 'gpt-5.4',
        outputText: '',
        pendingWaits: [pendingConfirmationWait()],
        provider: 'openai',
        responseId: 'resp_waiting_bootstrap',
        runId: asRunId('run_1'),
        sessionId: asSessionId('ses_1'),
        status: 'waiting',
        threadId: asThreadId('thr_1'),
        usage: null,
        waitIds: ['wte_1'],
      }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      runReconcileDelayMs: 0,
      storage: createStorage(),
      streamThreadEvents: async () => {
        await Promise.resolve()
      },
    })

    await store.submit('Plan the next step')

    expect(store.error).toBe(null)
    expect(store.isStreaming).toBe(false)
    expect(store.isWaiting).toBe(true)
    expect(store.runId).toBe(asRunId('run_1'))
    expect(store.waitIds).toEqual(['wte_1'])
    expect(store.pendingToolConfirmation).toMatchObject({
      tool: 'mcp.echo',
      waitId: 'wte_1',
    })
    expect(store.messages).toHaveLength(2)
    expect(store.messages[1]?.blocks).toMatchObject([
      {
        name: 'mcp.echo',
        status: 'awaiting_confirmation',
        type: 'tool_interaction',
      },
    ])
  })

  test('submit surfaces first-turn session creation failures cleanly', async () => {
    let streamCalls = 0

    const store = createChatStore({
      createSession: async () => {
        throw new Error('socket hang up')
      },
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      storage: createStorage(),
      streamThreadEvents: async () => {
        streamCalls += 1
      },
    })

    await store.submit('Plan the next step')

    expect(store.error).toBe('socket hang up')
    expect(store.isStreaming).toBe(false)
    expect(store.isWaiting).toBe(false)
    expect(store.runId).toBe(null)
    expect(store.messages).toHaveLength(0)
    expect(streamCalls).toBe(0)
  })

  test('submit settles immediately when the interaction response is already completed', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let abortCount = 0
    let messages = [userMessage(), assistantMessage('Hydrated answer')]

    const store = createChatStore({
      completedResponseStreamDrainMs: 0,
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId) => {
        messages = [
          userMessage(),
          assistantMessage('Hydrated answer'),
          {
            ...userMessage(),
            content: [{ text: 'Fast finish', type: 'text' }],
            id: asMessageId('msg_fast_user'),
            runId: asRunId('run_fast'),
            sequence: 3,
          },
          assistantMessage('Finished from HTTP response.', asRunId('run_fast')),
        ]

        return {
          assistantItemId: 'itm_fast',
          assistantMessageId: asMessageId('msg_fast_assistant'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_fast_user'),
          model: 'gpt-5.4',
          outputText: 'Finished from HTTP response.',
          provider: 'openai',
          responseId: 'resp_fast',
          runId: asRunId('run_fast'),
          sessionId: asSessionId('ses_1'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async ({ signal }) => {
        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              abortCount += 1
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    await store.hydrate()
    await store.submit('Fast finish')

    expect(store.isStreaming).toBe(false)
    expect(store.isWaiting).toBe(false)
    expect(store.runId).toBe(null)
    expect(store.error).toBe(null)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Finished from HTTP response.',
    })
    expect(abortCount).toBe(1)
  })

  test('submit preserves a short drain window so delayed follow events can land before a completed HTTP response settles the run', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let emittedBeforeAbort = false
    let messages = [userMessage(), assistantMessage('Hydrated answer')]

    const store = createChatStore({
      completedResponseStreamDrainMs: 25,
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId) => {
        messages = [
          userMessage(),
          assistantMessage('Hydrated answer'),
          {
            ...userMessage(),
            content: [{ text: 'Drain the stream first', type: 'text' }],
            id: asMessageId('msg_drain_user'),
            runId: asRunId('run_drain'),
            sequence: 3,
          },
          assistantMessage('Delivered after a short drain.', asRunId('run_drain')),
        ]

        return {
          assistantItemId: 'itm_drain',
          assistantMessageId: asMessageId('msg_drain_assistant'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_drain_user'),
          model: 'gpt-5.4',
          outputText: 'Delivered after a short drain.',
          provider: 'openai',
          responseId: 'resp_drain',
          runId: asRunId('run_drain'),
          sessionId: asSessionId('ses_1'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents, signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 0))

        if (signal?.aborted) {
          throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
        }

        emittedBeforeAbort = true
        onEvents([
          runEvent(5, 'run.started', {
            runId: asRunId('run_drain'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(6, 'stream.delta', {
            delta: 'Delivered after a short drain.',
            runId: asRunId('run_drain'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(7, 'run.completed', {
            outputText: 'Delivered after a short drain.',
            runId: asRunId('run_drain'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.hydrate()
    await store.submit('Drain the stream first')

    expect(emittedBeforeAbort).toBe(true)
    expect(store.error).toBe(null)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Delivered after a short drain.',
    })
  })

  test('hydrate reconciles a completed run after the stream follow path ends early', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_recover',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let runReads = 0
    let messages = [userMessage()]

    const store = createChatStore({
      getRun: async () => {
        runReads += 1
        if (runReads === 1) {
          return buildRun('running', {
            id: asRunId('run_recover'),
            rootRunId: asRunId('run_recover'),
            threadId: asThreadId('thr_1'),
          })
        }

        messages = [
          userMessage(),
          assistantMessage('Recovered after reconnect.', asRunId('run_recover')),
        ]
        return buildRun('completed', {
          id: asRunId('run_recover'),
          rootRunId: asRunId('run_recover'),
          threadId: asThreadId('thr_1'),
        })
      },
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      now: () => Date.parse(at) + 1_000,
      storage,
      streamThreadEvents: async () => {
        throw new Error('Streaming response ended before completion.')
      },
    })

    await store.hydrate()

    expect(runReads).toBe(2)
    expect(store.runId).toBe(null)
    expect(store.isStreaming).toBe(false)
    expect(store.isWaiting).toBe(false)
    expect(store.error).toBe(null)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Recovered after reconnect.',
    })
  })

  test('hydrate bootstraps the active run transcript from backend replay before tail deltas arrive', async () => {
    const storage = createStorage()
    const runId = asRunId('run_refresh')
    const threadId = asThreadId('thr_1')
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        activeRunTranscript: persistedRunTranscript(
          runId,
          materializeBlocks([
            runEvent(11, 'stream.delta', {
              delta: 'stale local transcript\n',
              runId,
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId,
              turn: 1,
            }),
          ]),
          {
            messageId: asMessageId('live:run_refresh'),
          },
        ),
        runId: 'run_refresh',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getRun: async () =>
        buildRun('running', {
          id: runId,
          rootRunId: runId,
          threadId,
          updatedAt: at,
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      now: () => Date.parse(at) + 1_000,
      replayRunEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(11, 'stream.delta', {
            delta: '1. alpha\n2. beta\n',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId,
            turn: 1,
          }),
        ])
      },
      storage,
      streamThreadEvents: async ({ onEvents, signal }) => {
        onEvents([
          runEvent(12, 'stream.delta', {
            delta: '3. gamma',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId,
            turn: 1,
          }),
        ])

        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () =>
              reject(
                Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
              ),
            { once: true },
          )
        })
      },
    })

    const hydratePromise = store.hydrate()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: '1. alpha\n2. beta\n3. gamma',
      streaming: true,
    })

    store.dispose()
    await hydratePromise
  })

  test('hydrate re-anchors a persisted private child run to the root thread run', async () => {
    const storage = createStorage()
    const rootRunId = asRunId('run_root')
    const childRunId = asRunId('run_child')
    const threadId = asThreadId('thr_1')
    const runReads: RunId[] = []

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        activeRunTranscript: persistedRunTranscript(
          childRunId,
          materializeBlocks([
            {
              aggregateId: childRunId,
              aggregateType: 'run',
              createdAt: at,
              eventNo: 11,
              id: asEventId('evt_child_tool_called_restore'),
              payload: {
                args: { query: 'Nora En Pure - Memories' },
                callId: 'call_child_restore',
                runId: childRunId,
                sessionId: asSessionId('ses_1'),
                threadId,
                tool: 'spotify__search_catalog',
              },
              type: 'tool.called',
            } satisfies BackendEvent,
          ]),
          {
            messageId: asMessageId('live:run_child'),
          },
        ),
        runId: childRunId,
        sessionId: 'ses_1',
        threadId,
      }),
    )

    const store = createChatStore({
      getRun: async (runId) => {
        runReads.push(runId)

        if (runId === childRunId) {
          return buildRun('completed', {
            id: childRunId,
            parentRunId: rootRunId,
            rootRunId,
            threadId: null,
          })
        }

        return buildRun('completed', {
          id: rootRunId,
          rootRunId,
          threadId,
        })
      },
      getThread: async () => thread(),
      listThreadMessages: async () => [
        userMessage(),
        assistantMessage('Done — "Memories" is now playing.', rootRunId),
      ],
      storage,
    })

    await store.hydrate()

    expect(runReads).toEqual([childRunId, rootRunId])
    expect(store.runId).toBe(null)
    expect(store.messages).toHaveLength(2)
    expect(store.messages.some((message) => message.runId === childRunId)).toBe(false)
    expect(store.messages.at(-1)).toMatchObject({
      role: 'assistant',
      runId: rootRunId,
      text: 'Done — "Memories" is now playing.',
    })
  })

  test('hydrate resumes thread follow from the backend replay cursor instead of stale local storage', async () => {
    const storage = createStorage()
    const runId = asRunId('run_stale_active')
    const threadId = asThreadId('thr_1')
    const persistedCursor = 30
    const streamCalls: Array<{ cursor: number; threadId: ThreadId }> = []

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: persistedCursor,
        activeRunTranscript: persistedRunTranscript(
          runId,
          materializeBlocks([
            runEvent(11, 'stream.delta', {
              delta: '1. alpha\n2. beta\n',
              runId,
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId,
              turn: 1,
            }),
          ]),
          {
            messageId: asMessageId('live:run_stale_active'),
          },
        ),
        runId: 'run_stale_active',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getRun: async () =>
        buildRun('running', {
          id: runId,
          rootRunId: runId,
          threadId,
          updatedAt: at,
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      now: () => Date.parse(at) + 31_000,
      replayRunEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(11, 'stream.delta', {
            delta: '1. alpha\n2. beta\n',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId,
            turn: 1,
          }),
        ])
      },
      storage,
      streamThreadEvents: async ({ cursor, threadId }) => {
        streamCalls.push({ cursor, threadId })
      },
    })

    await store.hydrate()

    expect(streamCalls).toEqual([{ cursor: 11, threadId }])
    expect(store.runId).toBe(runId)
    expect(store.isStreaming).toBe(true)
    expect(store.error).toBe(null)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: '1. alpha\n2. beta\n',
      streaming: true,
    })

    store.dispose()
  })

  test('hydrate ignores replayed current-run transcript older than the run snapshot', async () => {
    const storage = createStorage()
    const runId = asRunId('run_replay_guard')
    const threadId = asThreadId('thr_1')
    const oldAt = '2026-03-29T12:00:00.000Z'
    const snapshotAt = '2026-03-29T12:00:05.000Z'
    const newAt = '2026-03-29T12:00:10.000Z'

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 0,
        activeRunTranscript: persistedRunTranscript(
          runId,
          materializeBlocks([
            {
              aggregateId: String(runId),
              aggregateType: 'run',
              createdAt: oldAt,
              eventNo: 1,
              id: asEventId('evt_recovered_delta'),
              payload: {
                delta: '1. alpha\n2. beta\n',
                runId,
                sessionId: asSessionId('ses_1'),
                status: 'running',
                threadId,
                turn: 1,
              },
              type: 'stream.delta',
            } satisfies BackendEvent,
          ]),
          {
            createdAt: oldAt,
            messageId: asMessageId('live:run_replay_guard'),
          },
        ),
        runId,
        sessionId: 'ses_1',
        threadEventCursors: {
          thr_1: 0,
        },
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getRun: async () =>
        buildRun('running', {
          id: runId,
          rootRunId: runId,
          threadId,
          updatedAt: snapshotAt,
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          {
            aggregateId: String(runId),
            aggregateType: 'run',
            createdAt: oldAt,
            eventNo: 1,
            id: asEventId('evt_replayed_delta'),
            payload: {
              delta: '1. alpha\n2. beta\n',
              runId,
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId,
              turn: 1,
            },
            type: 'stream.delta',
          } satisfies BackendEvent,
          {
            aggregateId: String(runId),
            aggregateType: 'run',
            createdAt: newAt,
            eventNo: 2,
            id: asEventId('evt_fresh_delta'),
            payload: {
              delta: '3. gamma\n',
              runId,
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId,
              turn: 1,
            },
            type: 'stream.delta',
          } satisfies BackendEvent,
        ])
      },
    })

    await store.hydrate()

    const assistant = store.messages.find((message) => message.role === 'assistant')
    const textBlock = assistant?.blocks.find((block) => block.type === 'text')
    expect(textBlock && 'content' in textBlock ? textBlock.content : '').toBe(
      '1. alpha\n2. beta\n3. gamma\n',
    )
  })

  test('hydrate still accepts late tool settlement events slightly older than the run snapshot', async () => {
    const storage = createStorage()
    const runId = asRunId('run_replay_tool')
    const threadId = asThreadId('thr_1')
    const toolCalledAt = '2026-03-29T12:00:01.000Z'
    const toolCompletedAt = '2026-03-29T12:00:04.000Z'
    const snapshotAt = '2026-03-29T12:00:05.000Z'

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 0,
        activeRunTranscript: persistedRunTranscript(
          runId,
          materializeBlocks([
            {
              aggregateId: 'call_replay_tool',
              aggregateType: 'tool_execution',
              createdAt: toolCalledAt,
              eventNo: 1,
              id: asEventId('evt_replay_tool_called'),
              payload: {
                args: { task: 'resize' },
                callId: 'call_replay_tool',
                runId,
                sessionId: asSessionId('ses_1'),
                threadId,
                tool: 'execute',
              },
              type: 'tool.called',
            } satisfies BackendEvent,
          ]),
          {
            createdAt: toolCalledAt,
            messageId: asMessageId('live:run_replay_tool'),
          },
        ),
        runId,
        sessionId: 'ses_1',
        threadEventCursors: {
          thr_1: 0,
        },
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getRun: async () =>
        buildRun('running', {
          id: runId,
          rootRunId: runId,
          threadId,
          updatedAt: snapshotAt,
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      replayRunEvents: async ({ onEvents }) => {
        onEvents([
          {
            aggregateId: 'call_replay_tool',
            aggregateType: 'tool_execution',
            createdAt: toolCalledAt,
            eventNo: 1,
            id: asEventId('evt_replay_tool_called'),
            payload: {
              args: { task: 'resize' },
              callId: 'call_replay_tool',
              runId,
              sessionId: asSessionId('ses_1'),
              threadId,
              tool: 'execute',
            },
            type: 'tool.called',
          } satisfies BackendEvent,
        ])
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          {
            aggregateId: 'call_replay_tool',
            aggregateType: 'tool_execution',
            createdAt: toolCompletedAt,
            eventNo: 2,
            id: asEventId('evt_replay_tool_completed'),
            payload: {
              callId: 'call_replay_tool',
              outcome: {
                files: [],
                status: 'completed',
              },
              runId,
              sessionId: asSessionId('ses_1'),
              threadId,
              tool: 'execute',
            },
            type: 'tool.completed',
          } satisfies BackendEvent,
        ])
      },
    })

    await store.hydrate()

    const assistant = store.messages.find((message) => message.role === 'assistant')
    const toolBlock = assistant?.blocks.find(
      (block) => block.type === 'tool_interaction' && block.toolCallId === 'call_replay_tool',
    )

    expect(toolBlock).toMatchObject({
      finishedAt: toolCompletedAt,
      status: 'complete',
      type: 'tool_interaction',
    })
  })

  test('switchToThread restores the remembered cursor for the target thread before reconnecting', async () => {
    const storage = createStorage()
    const seenThread = threadWith({
      id: asThreadId('thr_seen'),
      sessionId: asSessionId('ses_seen'),
    })
    const otherThread = threadWith({
      id: asThreadId('thr_other'),
      sessionId: asSessionId('ses_other'),
    })
    const streamCalls: Array<{ cursor: number; threadId: ThreadId }> = []

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 18,
        runId: null,
        sessionId: 'ses_seen',
        threadEventCursors: {
          thr_other: 33,
          thr_seen: 18,
        },
        threadId: 'thr_seen',
      }),
    )

    const store = createChatStore({
      getThread: async (threadId) => (threadId === otherThread.id ? otherThread : seenThread),
      listThreadMessages: async () => [],
      startThreadInteraction: async (threadId) =>
        completedInteraction({
          assistantMessageId: asMessageId('msg_other_assistant'),
          inputMessageId: asMessageId('msg_other_user'),
          outputText: 'Cursor replay stayed anchored.',
          runId: asRunId('run_other'),
          sessionId: asSessionId('ses_other'),
          threadId,
        }),
      storage,
      streamThreadEvents: async ({ cursor, threadId }) => {
        streamCalls.push({ cursor, threadId })
      },
    })

    await store.hydrate()
    await store.switchToThread(otherThread)
    await store.submit('Reconnect from the remembered cursor.')

    expect(streamCalls.at(-1)).toEqual({
      cursor: 33,
      threadId: otherThread.id,
    })
  })

  test('waiting runs converge from backend state when no terminal event arrives', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let runReads = 0
    let messages = [userMessage()]

    const store = createChatStore({
      getRun: async () => {
        runReads += 1
        if (runReads === 1) {
          return buildRun('waiting', {
            id: asRunId('run_waiting'),
            rootRunId: asRunId('run_waiting'),
            threadId: asThreadId('thr_1'),
          })
        }

        messages = [userMessage(), assistantMessage('Polled completion.', asRunId('run_waiting'))]
        return buildRun('completed', {
          id: asRunId('run_waiting'),
          rootRunId: asRunId('run_waiting'),
          threadId: asThreadId('thr_1'),
        })
      },
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      runReconcileDelayMs: 0,
      storage,
    })

    await store.hydrate()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runReads).toBe(2)
    expect(store.runId).toBe(null)
    expect(store.isWaiting).toBe(false)
    expect(store.error).toBe(null)
    expect(store.messages.at(-1)?.text).toBe('Polled completion.')
  })

  test('first submit forwards the selected model provider and hydrated reasoning default', async () => {
    const interactionCalls: Array<Record<string, unknown>> = []
    const catalog: BackendModelsCatalog = {
      aliases: [
        {
          alias: 'default',
          configured: true,
          isDefault: true,
          model: 'gpt-5.4',
          provider: 'openai',
          reasoningModes: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
          supportsReasoning: true,
        },
        {
          alias: 'openai_default',
          configured: true,
          isDefault: false,
          model: 'gpt-5.4',
          provider: 'openai',
          reasoningModes: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
          supportsReasoning: true,
        },
        {
          alias: 'google_default',
          configured: true,
          isDefault: false,
          model: 'gemini-2.5-flash',
          provider: 'google',
          reasoningModes: ['none'],
          supportsReasoning: true,
        },
      ],
      defaultAlias: 'default',
      defaultModel: 'gpt-5.4',
      defaultProvider: 'openai',
      providers: {
        google: {
          configured: true,
          defaultModel: 'gemini-2.5-flash',
        },
        openai: {
          configured: true,
          defaultModel: 'gpt-5.4',
        },
      },
      reasoningModes: [
        { effort: 'none', label: 'No reasoning' },
        { effort: 'minimal', label: 'Minimal' },
        { effort: 'low', label: 'Low' },
        { effort: 'medium', label: 'Medium' },
        { effort: 'high', label: 'High' },
        { effort: 'xhigh', label: 'Very high' },
      ],
    }

    const store = createChatStore({
      createSession: async () => sessionWith({ id: asSessionId('ses_1') }),
      createSessionThread: async (sessionId) => threadWith({ id: asThreadId('thr_1'), sessionId }),
      startThreadInteraction: async (_threadId, input) => {
        interactionCalls.push(input)
        return completedInteraction({
          model: 'gemini-2.5-flash',
          outputText: 'Use the Google provider.',
          provider: 'google',
          responseId: 'resp_google_1',
          runId: asRunId('run_1'),
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
        })
      },
      getSupportedModels: async () => catalog,
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage(), assistantMessage('Use the Google provider.')],
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(3, 'run.completed', {
            outputText: 'Use the Google provider.',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.hydrate()
    store.setChatModel('gemini-2.5-flash')
    await store.submit('Plan the next step')

    expect(interactionCalls).toEqual([
      {
        model: 'gemini-2.5-flash',
        provider: 'google',
        text: 'Plan the next step',
      },
    ])
  })

  test('submit forwards the selected reasoning mode to the backend', async () => {
    const interactionCalls: Array<Record<string, unknown>> = []

    const store = createChatStore({
      createSession: async () => sessionWith({ id: asSessionId('ses_1') }),
      createSessionThread: async (sessionId) => threadWith({ id: asThreadId('thr_1'), sessionId }),
      startThreadInteraction: async (_threadId, input) => {
        interactionCalls.push(input)
        return completedInteraction({
          model: 'gpt-5.4',
          outputText: 'Start with SSE replay.',
          runId: asRunId('run_1'),
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
        })
      },
      getSupportedModels: async () => ({
        aliases: [
          {
            alias: 'default',
            configured: true,
            isDefault: true,
            model: 'gpt-5.4',
            provider: 'openai',
            reasoningModes: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
            supportsReasoning: true,
          },
        ],
        defaultAlias: 'default',
        defaultModel: 'gpt-5.4',
        defaultProvider: 'openai',
        providers: {
          google: {
            configured: false,
            defaultModel: 'gemini-2.5-flash',
          },
          openai: {
            configured: true,
            defaultModel: 'gpt-5.4',
          },
        },
        reasoningModes: [
          { effort: 'none', label: 'No reasoning' },
          { effort: 'minimal', label: 'Minimal' },
          { effort: 'low', label: 'Low' },
          { effort: 'medium', label: 'Medium' },
          { effort: 'high', label: 'High' },
          { effort: 'xhigh', label: 'Very high' },
        ],
      }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage(), assistantMessage('Start with SSE replay.')],
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(3, 'run.completed', {
            outputText: 'Start with SSE replay.',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.hydrate()
    store.setChatReasoningMode('high')
    await store.submit('Plan the next step')

    expect(interactionCalls).toEqual([
      {
        model: 'gpt-5.4',
        provider: 'openai',
        reasoning: {
          effort: 'high',
        },
        text: 'Plan the next step',
      },
    ])
  })

  test('subsequent submit uses the existing thread interaction route', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const interactionCalls: Array<Record<string, unknown>> = []
    let messages = [userMessage(), assistantMessage('Hydrated answer')]

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId, input) => {
        interactionCalls.push({ input, threadId })
        messages = [
          userMessage(),
          assistantMessage('Hydrated answer'),
          {
            ...userMessage(),
            content: [{ text: 'What should come after that?', type: 'text' }],
            id: asMessageId('msg_follow_up'),
            runId: asRunId('run_2'),
            sequence: 3,
          },
          assistantMessage('After SSE, wire cursor replay.', asRunId('run_2')),
        ]

        return {
          assistantItemId: 'itm_2',
          assistantMessageId: asMessageId('msg_assistant_2'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_follow_up'),
          model: 'gpt-5.4',
          outputText: 'After SSE, wire cursor replay.',
          provider: 'openai',
          responseId: 'resp_2',
          runId: asRunId('run_2'),
          sessionId: asSessionId('ses_1'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        await Promise.resolve()

        onEvents([
          runEvent(5, 'run.started', {
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(6, 'stream.delta', {
            delta: 'After SSE, wire cursor replay.',
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(7, 'message.posted', {
            messageId: asMessageId('msg_assistant_2'),
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(8, 'run.completed', {
            outputText: 'After SSE, wire cursor replay.',
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.hydrate()
    await store.submit('What should come after that?')

    expect(interactionCalls).toEqual([
      {
        input: { text: 'What should come after that?' },
        threadId: asThreadId('thr_1'),
      },
    ])
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'After SSE, wire cursor replay.',
    })
  })

  test('message.posted skips the eager durable refresh when live blocks already exist for the run', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let releaseCompletion = () => {}
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })
    let releaseInteractionStarted = () => {}
    const interactionStarted = new Promise<void>((resolve) => {
      releaseInteractionStarted = resolve
    })
    let listThreadMessagesCallCount = 0

    let messages = [userMessage(), assistantMessage('Hydrated answer')]

    const store = createChatStore({
      completedResponseStreamDrainMs: 10_000,
      getThread: async () => thread(),
      listThreadMessages: async () => {
        listThreadMessagesCallCount += 1
        return messages
      },
      startThreadInteraction: async (threadId) => {
        messages = [
          userMessage(),
          assistantMessage('Hydrated answer'),
          {
            ...userMessage(),
            content: [{ text: 'What should come after that?', type: 'text' }],
            id: asMessageId('msg_follow_up'),
            runId: asRunId('run_2'),
            sequence: 3,
          },
          {
            ...assistantMessage('After SSE, wire cursor replay.', asRunId('run_2')),
            id: asMessageId('msg_assistant_2'),
            sequence: 4,
          },
        ]

        releaseInteractionStarted()

        return {
          assistantItemId: 'itm_2',
          assistantMessageId: asMessageId('msg_assistant_2'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_follow_up'),
          model: 'gpt-5.4',
          outputText: 'After SSE, wire cursor replay.',
          provider: 'openai',
          responseId: 'resp_2',
          runId: asRunId('run_2'),
          sessionId: asSessionId('ses_1'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        await interactionStarted

        onEvents([
          runEvent(5, 'run.started', {
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(6, 'stream.delta', {
            delta: 'After SSE, wire cursor replay.',
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(7, 'message.posted', {
            messageId: asMessageId('msg_assistant_2'),
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
        ])

        await completionGate

        onEvents([
          runEvent(8, 'run.completed', {
            outputText: 'After SSE, wire cursor replay.',
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.hydrate()

    const submitPromise = store.submit('What should come after that?')

    await interactionStarted
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(listThreadMessagesCallCount).toBe(1)
    expect(store.messages.at(-1)?.id.startsWith('live:')).toBe(true)
    expect(store.messages.at(-1)?.uiKey?.startsWith('live:')).toBe(true)
    expect(store.messages.at(-1)).toMatchObject({
      status: 'streaming',
      runId: asRunId('run_2'),
    })
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'After SSE, wire cursor replay.',
      streaming: true,
    })

    releaseCompletion()
    await submitPromise

    expect(store.messages.at(-1)).toMatchObject({
      id: asMessageId('msg_assistant_2'),
      status: 'complete',
      runId: asRunId('run_2'),
    })
    expect(listThreadMessagesCallCount).toBe(2)
    expect(store.messages.at(-1)?.uiKey?.startsWith('live:')).toBe(true)
  })

  test('terminal durable handoff prefers durable plain-text content and clears pending playback', async () => {
    typewriterPlayback.clearAll()

    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let releaseCompletion = () => {}
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })
    let listThreadMessagesCallCount = 0

    let messages = [userMessage(), assistantMessage('Hydrated answer')]

    const store = createChatStore({
      completedResponseStreamDrainMs: 10_000,
      getThread: async () => thread(),
      listThreadMessages: async () => {
        listThreadMessagesCallCount += 1
        return messages
      },
      startThreadInteraction: async (threadId) => {
        messages = [
          userMessage(),
          assistantMessage('Hydrated answer'),
          {
            ...userMessage(),
            content: [{ text: 'Finish durable handoff', type: 'text' }],
            id: asMessageId('msg_follow_up'),
            runId: asRunId('run_2'),
            sequence: 3,
          },
          {
            ...assistantMessage('Full durable answer.', asRunId('run_2')),
            id: asMessageId('msg_assistant_2'),
            sequence: 4,
          },
        ]

        return {
          assistantItemId: 'itm_2',
          assistantMessageId: asMessageId('msg_assistant_2'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_follow_up'),
          model: 'gpt-5.4',
          outputText: 'Full durable answer.',
          provider: 'openai',
          responseId: 'resp_2',
          runId: asRunId('run_2'),
          sessionId: asSessionId('ses_1'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(5, 'run.started', {
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(6, 'stream.delta', {
            delta: 'Partial live',
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(7, 'message.posted', {
            messageId: asMessageId('msg_assistant_2'),
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
        ])

        await completionGate

        onEvents([
          runEvent(8, 'run.completed', {
            outputText: 'Full durable answer.',
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.hydrate()

    const submitPromise = store.submit('Finish durable handoff')

    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(listThreadMessagesCallCount).toBe(1)
    const liveUiKey = store.messages.at(-1)?.uiKey
    expect(liveUiKey?.startsWith('live:')).toBe(true)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Partial live',
      streaming: true,
    })

    if (liveUiKey) {
      typewriterPlayback.setPending(liveUiKey, true)
      expect(typewriterPlayback.hasPendingKey(liveUiKey)).toBe(true)
    }

    releaseCompletion()
    await submitPromise

    expect(listThreadMessagesCallCount).toBe(2)
    expect(store.messages.at(-1)).toMatchObject({
      id: asMessageId('msg_assistant_2'),
      status: 'complete',
      runId: asRunId('run_2'),
    })
    expect(store.messages.at(-1)?.uiKey?.startsWith('live:')).toBe(true)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Full durable answer.',
      streaming: false,
    })

    // Pending playback is cleared by the BlockRenderer's $effect lifecycle,
    // not by the store — the store no longer eagerly clears it so that the
    // typewriter animation can finish naturally before the handoff.
    typewriterPlayback.clearAll()
  })

  test('completed run keeps the empty live assistant shell mounted until the durable assistant message lands', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let releaseCompletion = () => {}
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })

    let messages = [userMessage(), assistantMessage('Hydrated answer')]

    const store = createChatStore({
      completedResponseStreamDrainMs: 10_000,
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId) => {
        messages = [
          userMessage(),
          assistantMessage('Hydrated answer'),
          {
            ...userMessage(),
            content: [{ text: 'Finish cleanly', type: 'text' }],
            id: asMessageId('msg_finish_user'),
            runId: asRunId('run_finish_cleanly'),
            sequence: 3,
          },
          {
            ...assistantMessage('Finished cleanly.', asRunId('run_finish_cleanly')),
            id: asMessageId('msg_finish_assistant'),
            sequence: 4,
          },
        ]

        return {
          assistantItemId: 'itm_finish_cleanly',
          assistantMessageId: asMessageId('msg_finish_assistant'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_finish_user'),
          model: 'gpt-5.4',
          outputText: 'Finished cleanly.',
          provider: 'openai',
          responseId: 'resp_finish_cleanly',
          runId: asRunId('run_finish_cleanly'),
          sessionId: asSessionId('ses_1'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(5, 'run.started', {
            runId: asRunId('run_finish_cleanly'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(6, 'run.completed', {
            outputText: 'Finished cleanly.',
            runId: asRunId('run_finish_cleanly'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])

        await completionGate
      },
    })

    await store.hydrate()

    const submitPromise = store.submit('Finish cleanly')

    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.messages.at(-1)?.id.startsWith('live:')).toBe(true)
    expect(store.messages.at(-1)).toMatchObject({
      role: 'assistant',
      runId: asRunId('run_finish_cleanly'),
      status: 'complete',
    })

    releaseCompletion()
    await submitPromise

    expect(store.messages.at(-1)).toMatchObject({
      id: asMessageId('msg_finish_assistant'),
      runId: asRunId('run_finish_cleanly'),
      status: 'complete',
    })
  })

  test('submit on an existing thread mounts a fresh live assistant row instead of reusing the previous assistant message', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let resolveInteraction!: (value: ReturnType<typeof completedInteraction>) => void
    const interactionPromise = new Promise<ReturnType<typeof completedInteraction>>((resolve) => {
      resolveInteraction = resolve
    })

    let messages = [userMessage(), assistantMessage('Hydrated answer')]

    const store = createChatStore({
      completedResponseStreamDrainMs: 25,
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (_threadId) => {
        messages = [
          userMessage(),
          assistantMessage('Hydrated answer'),
          {
            ...userMessage(),
            content: [{ text: 'What should come after that?', type: 'text' }],
            id: asMessageId('msg_follow_up'),
            runId: asRunId('run_2'),
            sequence: 3,
          },
          {
            ...assistantMessage('After SSE, wire cursor replay.', asRunId('run_2')),
            id: asMessageId('msg_assistant_2'),
            sequence: 4,
          },
        ]

        return interactionPromise
      },
      storage,
      streamThreadEvents: async ({ signal }) => {
        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    await store.hydrate()

    const previousAssistant = store.messages.find(
      (message) => message.role === 'assistant' && message.runId === asRunId('run_1'),
    )

    const submitPromise = store.submit('What should come after that?')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(previousAssistant).toMatchObject({
      id: asMessageId('msg_assistant'),
      runId: asRunId('run_1'),
      status: 'complete',
    })

    expect(store.messages.at(-1)?.id.startsWith('live:')).toBe(true)
    expect(store.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'streaming',
      runId: null,
    })

    resolveInteraction(
      completedInteraction({
        assistantMessageId: asMessageId('msg_assistant_2'),
        inputMessageId: asMessageId('msg_follow_up'),
        outputText: 'After SSE, wire cursor replay.',
        runId: asRunId('run_2'),
      }),
    )

    await submitPromise

    expect(
      store.messages.find((message) => message.id === asMessageId('msg_assistant')),
    ).toMatchObject({
      runId: asRunId('run_1'),
      status: 'complete',
    })
  })

  test('a restored live-only completed assistant stays visible while the next run starts', async () => {
    const storage = createStorage()
    const oldRunId = asRunId('run_restored')
    const newRunId = asRunId('run_follow_up')
    const threadId = asThreadId('thr_1')

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeRunTranscript: persistedRunTranscript(
          oldRunId,
          materializeBlocks([
            runEvent(9, 'stream.delta', {
              delta: 'Recovered answer.',
              runId: oldRunId,
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId,
              turn: 1,
            }),
          ]),
          {
            messageId: asMessageId('live:run_restored'),
            text: 'Recovered answer.',
          },
        ),
        eventCursor: 9,
        runId: 'run_restored',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let streamConnectionCount = 0
    let releaseNewRunCompletion = () => {}
    const newRunCompletion = new Promise<void>((resolve) => {
      releaseNewRunCompletion = resolve
    })

    let messages = [userMessage()]

    const store = createChatStore({
      getRun: async () =>
        buildRun('running', {
          id: oldRunId,
          rootRunId: oldRunId,
          threadId,
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      replayRunEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(9, 'stream.delta', {
            delta: 'Recovered answer.',
            runId: oldRunId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId,
            turn: 1,
          }),
        ])
      },
      startThreadInteraction: async () => ({
        attachedFileIds: [],
        inputMessageId: asMessageId('msg_follow_up'),
        runId: newRunId,
        sessionId: asSessionId('ses_1'),
        status: 'accepted' as const,
        threadId,
      }),
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        streamConnectionCount += 1

        if (streamConnectionCount === 1) {
          onEvents([
            runEvent(10, 'message.posted', {
              messageId: asMessageId('msg_restored_assistant'),
              runId: oldRunId,
              sessionId: asSessionId('ses_1'),
              threadId,
            }),
            runEvent(11, 'run.completed', {
              outputText: 'Recovered answer.',
              runId: oldRunId,
              sessionId: asSessionId('ses_1'),
              status: 'completed',
              threadId,
            }),
          ])
          return
        }

        onEvents([
          runEvent(12, 'run.created', {
            runId: newRunId,
            sessionId: asSessionId('ses_1'),
            threadId,
          }),
          runEvent(13, 'run.started', {
            runId: newRunId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId,
          }),
        ])

        await newRunCompletion

        onEvents([
          runEvent(14, 'stream.delta', {
            delta: 'Fresh answer.',
            runId: newRunId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId,
            turn: 1,
          }),
          runEvent(15, 'run.completed', {
            outputText: 'Fresh answer.',
            runId: newRunId,
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId,
          }),
        ])
      },
    })

    await store.hydrate()

    const restoredAssistant = store.messages.find(
      (message) => message.role === 'assistant' && message.runId === oldRunId,
    )

    expect(restoredAssistant).toMatchObject({
      id: asMessageId('live:run_restored'),
      runId: oldRunId,
      status: 'complete',
    })
    expect(restoredAssistant?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Recovered answer.',
      streaming: false,
    })

    const submitPromise = store.submit('Next question')
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(
      store.messages.find((message) => message.role === 'assistant' && message.runId === oldRunId),
    ).toMatchObject({
      id: asMessageId('live:run_restored'),
      runId: oldRunId,
      status: 'complete',
    })
    expect(store.messages.find((message) => message.runId === newRunId)).toMatchObject({
      role: 'assistant',
      runId: newRunId,
      status: 'streaming',
    })

    messages = [
      userMessage(),
      {
        ...assistantMessage('Recovered answer.', oldRunId),
        id: asMessageId('msg_restored_assistant'),
      },
      userMessageWith({
        content: [{ text: 'Next question', type: 'text' }],
        id: asMessageId('msg_follow_up'),
        runId: newRunId,
        sequence: 3,
      }),
      {
        ...assistantMessage('Fresh answer.', newRunId),
        id: asMessageId('msg_follow_up_assistant'),
        sequence: 4,
      },
    ]

    releaseNewRunCompletion()
    await submitPromise

    expect(
      store.messages.find((message) => message.id === asMessageId('msg_restored_assistant')),
    ).toMatchObject({
      runId: oldRunId,
      status: 'complete',
    })
    expect(
      store.messages.find((message) => message.id === asMessageId('msg_follow_up_assistant')),
    ).toMatchObject({
      runId: newRunId,
      status: 'complete',
    })
  })

  test('confirming an optimistic user message preserves its render key through tmp to durable replacement', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let resolveInteraction!: (value: ReturnType<typeof completedInteraction>) => void
    const interactionPromise = new Promise<ReturnType<typeof completedInteraction>>((resolve) => {
      resolveInteraction = resolve
    })

    let messages = [userMessage(), assistantMessage('Hydrated answer')]

    const store = createChatStore({
      completedResponseStreamDrainMs: 25,
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async () => interactionPromise,
      storage,
      streamThreadEvents: async ({ signal }) => {
        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    await store.hydrate()

    const submitPromise = store.submit('Keep the same bubble')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const optimisticUser = store.messages.find(
      (message) => message.role === 'user' && message.sequence === null,
    )
    expect(optimisticUser?.id.startsWith('tmp:')).toBe(true)
    const optimisticUiKey = optimisticUser?.uiKey

    messages = [
      userMessage(),
      assistantMessage('Hydrated answer'),
      userMessageWith({
        content: [{ text: 'Keep the same bubble', type: 'text' }],
        id: asMessageId('msg_follow_up_stable'),
        sequence: 3,
      }),
      assistantMessage('Confirmed.', asRunId('run_stable')),
    ]

    resolveInteraction(
      completedInteraction({
        assistantMessageId: asMessageId('msg_assistant_stable'),
        inputMessageId: asMessageId('msg_follow_up_stable'),
        outputText: 'Confirmed.',
        runId: asRunId('run_stable'),
      }),
    )

    await submitPromise

    const durableUser = store.messages.find(
      (message) => message.id === asMessageId('msg_follow_up_stable'),
    )
    expect(durableUser).toMatchObject({
      role: 'user',
      text: 'Keep the same bubble',
    })
    expect(durableUser?.uiKey).toBe(optimisticUiKey)
  })

  test('late terminal events from the previous run do not tear down the next live assistant lane', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 4,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let resolveInteraction!: (value: ReturnType<typeof completedInteraction>) => void
    const interactionPromise = new Promise<ReturnType<typeof completedInteraction>>((resolve) => {
      resolveInteraction = resolve
    })

    let messages = [userMessage(), assistantMessage('Previous answer', asRunId('run_1'))]

    const store = createChatStore({
      completedResponseStreamDrainMs: 25,
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async () => interactionPromise,
      storage,
      streamThreadEvents: async ({ onEvents, signal }) => {
        onEvents([
          runEvent(5, 'run.completed', {
            outputText: 'Previous answer',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])

        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    await store.hydrate()

    const submitPromise = store.submit('New request should keep streaming')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.isStreaming).toBe(true)
    expect(store.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'streaming',
    })
    expect(store.messages.at(-1)?.id.startsWith('live:')).toBe(true)

    messages = [
      userMessage(),
      assistantMessage('Previous answer', asRunId('run_1')),
      userMessageWith({
        content: [{ text: 'New request should keep streaming', type: 'text' }],
        id: asMessageId('msg_new_request'),
        sequence: 3,
      }),
      {
        ...assistantMessage('New reply.', asRunId('run_2')),
        id: asMessageId('msg_new_reply'),
        sequence: 4,
      },
    ]

    resolveInteraction(
      completedInteraction({
        assistantMessageId: asMessageId('msg_new_reply'),
        inputMessageId: asMessageId('msg_new_request'),
        outputText: 'New reply.',
        runId: asRunId('run_2'),
      }),
    )

    await submitPromise

    expect(store.messages.at(-1)).toMatchObject({
      id: asMessageId('msg_new_reply'),
      runId: asRunId('run_2'),
      status: 'complete',
    })
  })

  test('replayed assistant message.posted for a completed previous run does not hijack the next live lane', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 20,
        runId: null,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let resolveInteraction!: (value: ReturnType<typeof completedInteraction>) => void
    const interactionPromise = new Promise<ReturnType<typeof completedInteraction>>((resolve) => {
      resolveInteraction = resolve
    })

    let messages = [userMessage(), assistantMessage('Previous reply.', asRunId('run_1'))]

    const store = createChatStore({
      completedResponseStreamDrainMs: 25,
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async () => interactionPromise,
      storage,
      streamThreadEvents: async ({ onEvents, signal }) => {
        onEvents([
          runEvent(21, 'message.posted', {
            messageId: asMessageId('msg_assistant'),
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(22, 'run.completed', {
            outputText: 'Previous reply.',
            runId: asRunId('run_1'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])

        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    await store.hydrate()

    const submitPromise = store.submit('Second run should own the lane')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.messages.at(-1)?.id.startsWith('live:')).toBe(true)
    expect(store.messages.at(-1)).toMatchObject({
      role: 'assistant',
      runId: null,
      status: 'streaming',
    })

    messages = [
      userMessage(),
      assistantMessage('Previous reply.', asRunId('run_1')),
      userMessageWith({
        content: [{ text: 'Second run should own the lane', type: 'text' }],
        id: asMessageId('msg_second_request'),
        sequence: 3,
      }),
      {
        ...assistantMessage('Second reply.', asRunId('run_2')),
        id: asMessageId('msg_second_reply'),
        sequence: 4,
      },
    ]

    resolveInteraction(
      completedInteraction({
        assistantMessageId: asMessageId('msg_second_reply'),
        inputMessageId: asMessageId('msg_second_request'),
        outputText: 'Second reply.',
        runId: asRunId('run_2'),
      }),
    )

    await submitPromise

    expect(store.messages.at(-1)).toMatchObject({
      id: asMessageId('msg_second_reply'),
      runId: asRunId('run_2'),
      status: 'complete',
    })
  })

  test('first submit with uploaded attachments creates a session and forwards file ids to the interaction route', async () => {
    const storage = createStorage()
    const attachment: MessageAttachment = {
      id: 'fil_image_1',
      kind: 'image',
      mime: 'image/png',
      name: 'preview.png',
      size: 1024,
      thumbnailUrl: '/v1/files/fil_image_1/content',
      url: '/v1/files/fil_image_1/content',
    }
    const createSessionCalls: Array<Record<string, unknown>> = []
    const createThreadCalls: Array<Record<string, unknown>> = []
    const interactionCalls: Array<Record<string, unknown>> = []
    let messages: BackendThreadMessage[] = []

    const store = createChatStore({
      createSession: async (input) => {
        createSessionCalls.push(input)
        return {
          archivedAt: null,
          createdAt: at,
          createdByAccountId: 'acc_adam_overment',
          deletedAt: null,
          id: asSessionId('ses_upload'),
          metadata: null,
          rootRunId: null,
          status: 'active',
          tenantId: 'ten_overment',
          title: 'Describe this image',
          updatedAt: at,
          workspaceRef: null,
        }
      },
      createSessionThread: async (sessionId, input) => {
        createThreadCalls.push({ input, sessionId })
        return {
          createdAt: at,
          createdByAccountId: 'acc_adam_overment',
          id: asThreadId('thr_upload'),
          parentThreadId: null,
          sessionId,
          status: 'active',
          tenantId: 'ten_overment',
          title: 'Describe this image',
          updatedAt: at,
        }
      },
      getThread: async () => ({
        createdAt: at,
        createdByAccountId: 'acc_adam_overment',
        id: asThreadId('thr_upload'),
        parentThreadId: null,
        sessionId: asSessionId('ses_upload'),
        status: 'active',
        tenantId: 'ten_overment',
        title: 'Describe this image',
        updatedAt: at,
      }),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId, input) => {
        interactionCalls.push({ input, threadId })
        messages = [
          {
            authorAccountId: 'acc_adam_overment',
            authorKind: 'user',
            content: [{ text: 'Describe this image', type: 'text' }],
            createdAt: at,
            id: asMessageId('msg_upload'),
            metadata: null,
            runId: asRunId('run_upload'),
            sequence: 1,
            sessionId: asSessionId('ses_upload'),
            tenantId: 'ten_overment',
            threadId,
          },
          {
            authorAccountId: null,
            authorKind: 'assistant',
            content: [{ text: 'It is a test image.', type: 'text' }],
            createdAt: at,
            id: asMessageId('msg_upload_assistant'),
            metadata: null,
            runId: asRunId('run_upload'),
            sequence: 2,
            sessionId: asSessionId('ses_upload'),
            tenantId: 'ten_overment',
            threadId,
          },
        ]

        return {
          assistantItemId: 'itm_upload',
          assistantMessageId: asMessageId('msg_upload_assistant'),
          attachedFileIds: ['fil_image_1'],
          inputMessageId: asMessageId('msg_upload'),
          model: 'gpt-5.4',
          outputText: 'It is a test image.',
          provider: 'openai',
          responseId: 'resp_upload',
          runId: asRunId('run_upload'),
          sessionId: asSessionId('ses_upload'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          {
            aggregateId: 'run_upload',
            aggregateType: 'run',
            createdAt: at,
            eventNo: 1,
            id: asEventId('evt_upload_1'),
            payload: {
              runId: asRunId('run_upload'),
              sessionId: asSessionId('ses_upload'),
              status: 'running',
              threadId: asThreadId('thr_upload'),
            },
            type: 'run.started',
          } as BackendEvent,
          {
            aggregateId: 'msg_upload_assistant',
            aggregateType: 'session_message',
            createdAt: at,
            eventNo: 2,
            id: asEventId('evt_upload_2'),
            payload: {
              messageId: asMessageId('msg_upload_assistant'),
              runId: asRunId('run_upload'),
              sessionId: asSessionId('ses_upload'),
              threadId: asThreadId('thr_upload'),
            },
            type: 'message.posted',
          } as BackendEvent,
          {
            aggregateId: 'run_upload',
            aggregateType: 'run',
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_upload_3'),
            payload: {
              outputText: 'It is a test image.',
              runId: asRunId('run_upload'),
              sessionId: asSessionId('ses_upload'),
              status: 'completed',
              threadId: asThreadId('thr_upload'),
            },
            type: 'run.completed',
          } as BackendEvent,
        ])
      },
    })

    await store.submit('Describe this image', [attachment])

    expect(createSessionCalls).toEqual([{}])
    expect(createThreadCalls).toEqual([
      {
        input: {},
        sessionId: asSessionId('ses_upload'),
      },
    ])
    expect(interactionCalls).toEqual([
      {
        input: {
          fileIds: ['fil_image_1'],
          metadata: { attachments: [attachment] },
          text: 'Describe this image',
        },
        threadId: asThreadId('thr_upload'),
      },
    ])
    expect(store.sessionId).toBe('ses_upload')
    expect(store.threadId).toBe('thr_upload')
    expect(store.messages[0]?.attachments).toEqual([attachment])
  })

  test('large pasted text metadata reaches the interaction route without leaking into visible user messages', async () => {
    const attachment: MessageAttachment = {
      id: 'fil_large_text',
      kind: 'file',
      mime: 'text/plain',
      name: 'pasted-text-20260330-171506000.txt',
      size: 220_940,
      url: '/v1/files/fil_large_text/content',
    }
    const submittedPrompt = appendLargeTextPasteHiddenMetadata('', [
      {
        characterCount: 220_940,
        fileId: attachment.id,
        fileName: attachment.name,
      },
    ])
    const createSessionCalls: Array<Record<string, unknown>> = []
    const createThreadCalls: Array<Record<string, unknown>> = []
    const interactionCalls: Array<Record<string, unknown>> = []
    let messages: BackendThreadMessage[] = []

    const store = createChatStore({
      createSession: async (input) => {
        createSessionCalls.push(input)
        return {
          archivedAt: null,
          createdAt: at,
          createdByAccountId: 'acc_adam_overment',
          deletedAt: null,
          id: asSessionId('ses_large_text'),
          metadata: null,
          rootRunId: null,
          status: 'active',
          tenantId: 'ten_overment',
          title: attachment.name,
          updatedAt: at,
          workspaceRef: null,
        }
      },
      createSessionThread: async (sessionId, input) => {
        createThreadCalls.push({ input, sessionId })
        return {
          createdAt: at,
          createdByAccountId: 'acc_adam_overment',
          id: asThreadId('thr_large_text'),
          parentThreadId: null,
          sessionId,
          status: 'active',
          tenantId: 'ten_overment',
          title: attachment.name,
          updatedAt: at,
        }
      },
      getThread: async () => ({
        createdAt: at,
        createdByAccountId: 'acc_adam_overment',
        id: asThreadId('thr_large_text'),
        parentThreadId: null,
        sessionId: asSessionId('ses_large_text'),
        status: 'active',
        tenantId: 'ten_overment',
        title: attachment.name,
        updatedAt: at,
      }),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId, input) => {
        interactionCalls.push({ input, threadId })
        messages = [
          userMessageWith({
            content: [{ text: submittedPrompt, type: 'text' }],
            id: asMessageId('msg_large_text'),
            runId: asRunId('run_large_text'),
            sessionId: asSessionId('ses_large_text'),
            threadId,
          }),
          assistantMessage('Use the attached file.', asRunId('run_large_text')),
        ]

        return {
          assistantItemId: 'itm_large_text',
          assistantMessageId: asMessageId('msg_large_text_assistant'),
          attachedFileIds: [attachment.id],
          inputMessageId: asMessageId('msg_large_text'),
          model: 'gpt-5.4',
          outputText: 'Use the attached file.',
          provider: 'openai',
          responseId: 'resp_large_text',
          runId: asRunId('run_large_text'),
          sessionId: asSessionId('ses_large_text'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      streamThreadEvents: async () => {},
    })

    await store.submit(submittedPrompt, [attachment])

    expect(createSessionCalls).toEqual([{}])
    expect(createThreadCalls).toEqual([
      {
        input: {},
        sessionId: asSessionId('ses_large_text'),
      },
    ])
    expect(interactionCalls).toEqual([
      {
        input: {
          fileIds: [attachment.id],
          metadata: { attachments: [attachment] },
          text: submittedPrompt,
        },
        threadId: asThreadId('thr_large_text'),
      },
    ])
    expect(store.messages[0]?.text).toBe('')
    expect(store.messages[0]?.attachments).toEqual([attachment])
  })

  test('submit forwards referenced file ids without adding optimistic attachment chips', async () => {
    let messages: BackendThreadMessage[] = []
    const interactionCalls: Array<Record<string, unknown>> = []
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 0,
        runId: null,
        sessionId: 'ses_refs',
        threadId: 'thr_refs',
      }),
    )

    const store = createChatStore({
      getThread: async () => ({
        createdAt: at,
        createdByAccountId: 'acc_adam_overment',
        id: asThreadId('thr_refs'),
        parentThreadId: null,
        sessionId: asSessionId('ses_refs'),
        status: 'active',
        tenantId: 'ten_overment',
        title: 'Referenced files',
        updatedAt: at,
      }),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId, input) => {
        interactionCalls.push({ input, threadId })
        messages = [
          {
            authorAccountId: 'acc_adam_overment',
            authorKind: 'user',
            content: [{ text: 'Review `#architecture.md`', type: 'text' }],
            createdAt: at,
            id: asMessageId('msg_refs'),
            metadata: null,
            runId: asRunId('run_refs'),
            sequence: 1,
            sessionId: asSessionId('ses_refs'),
            tenantId: 'ten_overment',
            threadId,
          },
        ]

        return {
          assistantItemId: 'itm_refs',
          assistantMessageId: asMessageId('msg_refs_assistant'),
          attachedFileIds: ['fil_architecture'],
          inputMessageId: asMessageId('msg_refs'),
          model: 'gpt-5.4',
          outputText: '',
          provider: 'openai',
          responseId: 'resp_refs',
          runId: asRunId('run_refs'),
          sessionId: asSessionId('ses_refs'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async () => {},
    })

    await store.hydrate()
    await store.submit('Review `#architecture.md`', [], ['fil_architecture', 'fil_architecture'])

    expect(interactionCalls).toEqual([
      {
        input: {
          fileIds: ['fil_architecture'],
          text: 'Review `#architecture.md`',
        },
        threadId: asThreadId('thr_refs'),
      },
    ])
    expect(store.messages[0]?.attachments).toEqual([])
  })

  test('submit forwards the selected agent as an explicit conversation target without persisting thread state', async () => {
    const interactionCalls: Array<Record<string, unknown>> = []
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 0,
        runId: null,
        sessionId: 'ses_agent',
        threadId: 'thr_agent',
      }),
    )

    const store = createChatStore({
      getThread: async () =>
        threadWith({
          id: asThreadId('thr_agent'),
          sessionId: asSessionId('ses_agent'),
          title: 'Agent thread',
        }),
      listThreadMessages: async () => [],
      startThreadInteraction: async (threadId, input) => {
        interactionCalls.push({ input, threadId })

        return {
          assistantItemId: 'itm_agent',
          assistantMessageId: asMessageId('msg_agent_assistant'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_agent'),
          model: 'gpt-5.4',
          outputText: '',
          provider: 'openai',
          responseId: 'resp_agent',
          runId: asRunId('run_agent'),
          sessionId: asSessionId('ses_agent'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async () => {},
    })

    await store.hydrate()
    await store.submit('Use the specialist for this.', [], [], {
      agentId: 'agt_specialist',
      agentName: 'Specialist',
    })

    expect(interactionCalls).toEqual([
      {
        input: {
          target: {
            agentId: 'agt_specialist',
            kind: 'agent',
          },
          text: 'Use the specialist for this.',
        },
        threadId: asThreadId('thr_agent'),
      },
    ])
    expect(store.activeAgentId).toBe('agt_specialist')
    expect(store.activeAgentName).toBe('Specialist')
    expect(store.targetMode).toBe('agent')
  })

  test('submit forwards assistant as an explicit conversation target when selected in the composer state', async () => {
    const interactionCalls: Array<Record<string, unknown>> = []
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 0,
        runId: null,
        sessionId: 'ses_assistant',
        threadId: 'thr_assistant',
      }),
    )

    const store = createChatStore({
      getThread: async () =>
        threadWith({
          id: asThreadId('thr_assistant'),
          sessionId: asSessionId('ses_assistant'),
          title: 'Assistant thread',
        }),
      listThreadMessages: async () => [],
      startThreadInteraction: async (threadId, input) => {
        interactionCalls.push({ input, threadId })

        return {
          assistantItemId: 'itm_assistant',
          assistantMessageId: asMessageId('msg_assistant_reply'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_assistant_user'),
          model: 'gpt-5.4',
          outputText: '',
          provider: 'openai',
          responseId: 'resp_assistant',
          runId: asRunId('run_assistant'),
          sessionId: asSessionId('ses_assistant'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async () => {},
    })

    await store.hydrate()
    store.setTargetMode('assistant')
    await store.submit('Use plain assistant.', [], [])

    expect(interactionCalls).toEqual([
      {
        input: {
          target: {
            kind: 'assistant',
          },
          text: 'Use plain assistant.',
        },
        threadId: asThreadId('thr_assistant'),
      },
    ])
    expect(store.targetMode).toBe('assistant')
  })

  test('hydrate loads account default target and keeps default-mode submits implicit', async () => {
    const interactionCalls: Array<Record<string, unknown>> = []
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 0,
        runId: null,
        sessionId: 'ses_default_target',
        threadId: 'thr_default_target',
      }),
    )

    const store = createChatStore({
      getAccountPreferences: async () => ({
        accountId: 'acc_adam_overment',
        assistantToolProfileId: asToolProfileId('tp_assistant_empty'),
        defaultTarget: {
          agentId: 'agt_default',
          kind: 'agent',
        },
        shortcutBindings: {},
        updatedAt: at,
      }),
      getAgent: async () => ({
        activeRevision: null,
        activeRevisionId: 'agr_default',
        activeRevisionVersion: 1,
        createdAt: at,
        description: 'Default delegation target.',
        id: 'agt_default',
        isDefaultForAccount: true,
        kind: 'primary',
        name: 'Alice',
        ownerAccountId: 'acc_adam_overment',
        slug: 'alice',
        status: 'active',
        subagents: [],
        updatedAt: at,
        visibility: 'account_private',
      }),
      getThread: async () =>
        threadWith({
          id: asThreadId('thr_default_target'),
          sessionId: asSessionId('ses_default_target'),
          title: 'Default target thread',
        }),
      listThreadMessages: async () => [],
      startThreadInteraction: async (threadId, input) => {
        interactionCalls.push({ input, threadId })

        return {
          assistantItemId: 'itm_default_target',
          assistantMessageId: asMessageId('msg_default_target_assistant'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_default_target_user'),
          model: 'gpt-5.4',
          outputText: '',
          provider: 'openai',
          responseId: 'resp_default_target',
          runId: asRunId('run_default_target'),
          sessionId: asSessionId('ses_default_target'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async () => {},
    })

    await store.hydrate()
    await store.submit('Use the account default target.', [], [])

    expect(store.defaultTarget).toEqual({
      agentId: 'agt_default',
      kind: 'agent',
    })
    expect(store.defaultTargetAgentName).toBe('Alice')
    expect(store.targetMode).toBe('default')
    expect(interactionCalls).toEqual([
      {
        input: {
          text: 'Use the account default target.',
        },
        threadId: asThreadId('thr_default_target'),
      },
    ])
  })

  test('shows uploaded attachments on the durable user message as soon as message.posted arrives', async () => {
    const attachment: MessageAttachment = {
      id: 'fil_image_live',
      kind: 'image',
      mime: 'image/png',
      name: 'preview.png',
      size: 1024,
      thumbnailUrl: '/v1/files/fil_image_live/content',
      url: '/v1/files/fil_image_live/content',
    }
    let resolveInteraction!: (value: {
      assistantItemId: string
      assistantMessageId: ReturnType<typeof asMessageId>
      attachedFileIds: string[]
      inputMessageId: ReturnType<typeof asMessageId>
      model: string
      outputText: string
      provider: 'openai'
      responseId: string
      runId: ReturnType<typeof asRunId>
      sessionId: ReturnType<typeof asSessionId>
      status: 'completed'
      threadId: ReturnType<typeof asThreadId>
      usage: null
    }) => void
    const interactionPromise = new Promise<
      Awaited<
        ReturnType<NonNullable<Parameters<typeof createChatStore>[0]['startThreadInteraction']>>
      >
    >((resolve) => {
      resolveInteraction = resolve
    })
    let messages: BackendThreadMessage[] = []

    const store = createChatStore({
      createSession: async () => ({
        archivedAt: null,
        createdAt: at,
        createdByAccountId: 'acc_adam_overment',
        deletedAt: null,
        id: asSessionId('ses_live'),
        metadata: null,
        rootRunId: null,
        status: 'active',
        tenantId: 'ten_overment',
        title: 'Describe this image',
        updatedAt: at,
        workspaceRef: null,
      }),
      createSessionThread: async (sessionId) => ({
        createdAt: at,
        createdByAccountId: 'acc_adam_overment',
        id: asThreadId('thr_live'),
        parentThreadId: null,
        sessionId,
        status: 'active',
        tenantId: 'ten_overment',
        title: 'Describe this image',
        updatedAt: at,
      }),
      getThread: async () => ({
        createdAt: at,
        createdByAccountId: 'acc_adam_overment',
        id: asThreadId('thr_live'),
        parentThreadId: null,
        sessionId: asSessionId('ses_live'),
        status: 'active',
        tenantId: 'ten_overment',
        title: 'Describe this image',
        updatedAt: at,
      }),
      listThreadMessages: async () => messages,
      startThreadInteraction: async () => interactionPromise,
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        messages = [
          {
            authorAccountId: 'acc_adam_overment',
            authorKind: 'user',
            content: [{ text: 'Describe this image', type: 'text' }],
            createdAt: at,
            id: asMessageId('msg_live_user'),
            metadata: null,
            runId: asRunId('run_live'),
            sequence: 1,
            sessionId: asSessionId('ses_live'),
            tenantId: 'ten_overment',
            threadId: asThreadId('thr_live'),
          },
        ]

        onEvents([
          {
            aggregateId: 'msg_live_user',
            aggregateType: 'session_message',
            createdAt: at,
            eventNo: 1,
            id: asEventId('evt_live_user_posted'),
            payload: {
              messageId: asMessageId('msg_live_user'),
              sessionId: asSessionId('ses_live'),
              threadId: asThreadId('thr_live'),
            },
            type: 'message.posted',
          } as BackendEvent,
        ])
      },
    })

    const submitPromise = store.submit('Describe this image', [attachment])
    await Promise.resolve()
    await Promise.resolve()

    expect(store.messages[0]).toMatchObject({
      id: asMessageId('msg_live_user'),
      text: 'Describe this image',
      attachments: [attachment],
    })

    messages = [
      messages[0]!,
      {
        authorAccountId: null,
        authorKind: 'assistant',
        content: [{ text: 'It is visible now.', type: 'text' }],
        createdAt: at,
        id: asMessageId('msg_live_assistant'),
        metadata: null,
        runId: asRunId('run_live'),
        sequence: 2,
        sessionId: asSessionId('ses_live'),
        tenantId: 'ten_overment',
        threadId: asThreadId('thr_live'),
      },
    ]

    resolveInteraction({
      assistantItemId: 'itm_live',
      assistantMessageId: asMessageId('msg_live_assistant'),
      attachedFileIds: ['fil_image_live'],
      inputMessageId: asMessageId('msg_live_user'),
      model: 'gpt-5.4',
      outputText: 'It is visible now.',
      provider: 'openai',
      responseId: 'resp_live',
      runId: asRunId('run_live'),
      sessionId: asSessionId('ses_live'),
      status: 'completed',
      threadId: asThreadId('thr_live'),
      usage: null,
    })

    await submitPromise
  })

  test('submit keeps streamed assistant text after run.failed when no assistant message is persisted', async () => {
    const inputId = asMessageId('msg_fail_in')
    let threadMessages: BackendThreadMessage[] = []

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        provider: 'openai',
        responseId: null,
        runId: asRunId('run_fail'),
        sessionId: asSessionId('ses_1'),
        status: 'completed',
        threadId: asThreadId('thr_1'),
        usage: null,
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: asRunId('run_fail'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: asRunId('run_fail'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(3, 'stream.delta', {
            delta: 'Partial output',
            runId: asRunId('run_fail'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(4, 'run.failed', {
            error: { message: 'Provider error', type: 'provider_error' },
            runId: asRunId('run_fail'),
            sessionId: asSessionId('ses_1'),
            status: 'failed',
            threadId: asThreadId('thr_1'),
          }),
        ])
        threadMessages = [
          userMessageWith({
            id: inputId,
            content: [{ text: 'Question', type: 'text' }],
          }),
        ]
      },
    })

    await store.switchToThread(thread())
    await store.submit('Question')

    const assistant = store.messages.filter((m) => m.role === 'assistant')
    expect(assistant.length).toBeGreaterThan(0)
    const textBlock = assistant[0]?.blocks.find((b) => b.type === 'text')
    expect(textBlock && 'content' in textBlock ? textBlock.content : '').toContain('Partial output')
    expect(assistant[0]?.status).toBe('error')
  })

  test('submit keeps an empty cancelled assistant message visible when the run is cancelled before any output', async () => {
    const inputId = asMessageId('msg_cancel_early_in')
    let threadMessages: BackendThreadMessage[] = []

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        provider: 'openai',
        responseId: null,
        runId: asRunId('run_cancel_early'),
        sessionId: asSessionId('ses_1'),
        status: 'completed',
        threadId: asThreadId('thr_1'),
        usage: null,
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: asRunId('run_cancel_early'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: asRunId('run_cancel_early'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(3, 'run.cancelled', {
            runId: asRunId('run_cancel_early'),
            sessionId: asSessionId('ses_1'),
            status: 'cancelled',
            threadId: asThreadId('thr_1'),
          }),
        ])
        threadMessages = [
          userMessageWith({
            id: inputId,
            content: [{ text: 'Question', type: 'text' }],
          }),
        ]
      },
    })

    await store.switchToThread(thread())
    await store.submit('Question')

    const assistant = store.messages.find((message) => message.role === 'assistant')

    expect(assistant).toMatchObject({
      finishReason: 'cancelled',
      role: 'assistant',
      status: 'complete',
    })
    expect(assistant?.blocks).toEqual([])
  })

  test('submit reconciles failed runs from the backend snapshot so stale delegation blocks do not stay running', async () => {
    const inputId = asMessageId('msg_fail_tool_in')
    const runId = asRunId('run_fail_tool')
    let threadMessages: BackendThreadMessage[] = []

    const store = createChatStore({
      getRun: async () =>
        buildRun('failed', {
          id: runId,
          rootRunId: runId,
          threadId: asThreadId('thr_1'),
          updatedAt: at,
          resultJson: {
            outputText: '',
            transcript: {
              blocks: [
                {
                  args: { agentAlias: 'jenny', task: 'Ask Jenny how she is' },
                  createdAt: at,
                  finishedAt: at,
                  id: 'tool:call_delegate_1',
                  name: 'delegate_to_agent',
                  output: { kind: 'completed', summary: 'Doing well.' },
                  status: 'complete',
                  toolCallId: 'call_delegate_1',
                  type: 'tool_interaction',
                },
              ],
              toolBlocks: [
                {
                  args: { agentAlias: 'jenny', task: 'Ask Jenny how she is' },
                  createdAt: at,
                  finishedAt: at,
                  id: 'tool:call_delegate_1',
                  name: 'delegate_to_agent',
                  output: { kind: 'completed', summary: 'Doing well.' },
                  status: 'complete',
                  toolCallId: 'call_delegate_1',
                  type: 'tool_interaction',
                },
              ],
              version: 2,
              webSearchBlocks: [],
            },
          },
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        provider: 'openai',
        responseId: null,
        runId,
        sessionId: asSessionId('ses_1'),
        status: 'completed',
        threadId: asThreadId('thr_1'),
        usage: null,
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId,
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          {
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_3'),
            payload: {
              args: { agentAlias: 'jenny', task: 'Ask Jenny how she is' },
              callId: 'call_delegate_1',
              runId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'delegate_to_agent',
            },
            type: 'tool.called',
          },
          {
            createdAt: at,
            eventNo: 4,
            id: asEventId('evt_4'),
            payload: {
              args: { agentAlias: 'jenny', task: 'Ask Jenny how she is' },
              callId: 'call_delegate_1',
              description: 'Waiting for delegated child agent "jenny"',
              runId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'delegate_to_agent',
              waitId: 'wte_delegate_1',
              waitTargetKind: 'run',
              waitTargetRef: 'jenny:run_child_1',
              waitTargetRunId: 'run_child_1',
              waitType: 'agent',
            },
            type: 'tool.waiting',
          },
          runEvent(5, 'run.failed', {
            error: { message: 'Provider error', type: 'provider_error' },
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'failed',
            threadId: asThreadId('thr_1'),
          }),
        ])
        threadMessages = [
          userMessageWith({
            id: inputId,
            content: [{ text: 'Ask Jenny how she is', type: 'text' }],
          }),
        ]
      },
    })

    await store.switchToThread(thread())
    await store.submit('Ask Jenny how she is')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const assistant = store.messages.find((message) => message.role === 'assistant')
    expect(assistant?.status).toBe('error')
    expect(assistant?.blocks).toMatchObject([
      {
        name: 'delegate_to_agent',
        status: 'complete',
        toolCallId: 'call_delegate_1',
        type: 'tool_interaction',
      },
    ])
  })

  test('hydrates a failed run transcript snapshot when no durable assistant message exists', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_failed',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getRun: async () =>
        buildRun('failed', {
          errorJson: {
            message: 'Provider error',
            type: 'provider',
          },
          id: asRunId('run_failed'),
          resultJson: {
            outputText: 'Partial answer before failure.',
            transcript: {
              blocks: [
                {
                  content: 'Need one more source before answering.',
                  createdAt: at,
                  id: 'thinking:rs_failed_1',
                  status: 'done',
                  title: 'reasoning',
                  type: 'thinking',
                },
              ],
              toolBlocks: [],
              version: 2,
              webSearchBlocks: [],
            },
          },
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      storage,
    })

    await store.hydrate()

    const assistant = store.messages.find((message) => message.role === 'assistant')
    expect(assistant?.status).toBe('error')
    expect(assistant?.blocks).toMatchObject([
      {
        content: 'Need one more source before answering.',
        id: 'thinking:rs_failed_1',
        type: 'thinking',
      },
      {
        content: 'Partial answer before failure.',
        type: 'text',
      },
    ])
  })

  test('ignores late child transcript events after the root run completes', async () => {
    const rootRunId = asRunId('run_root_complete')
    const childRunId = asRunId('run_child_late')
    const inputId = asMessageId('msg_input_late_child')
    let threadMessages: BackendThreadMessage[] = [userMessage()]

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      startThreadInteraction: async () => ({
        assistantItemId: 'itm_root_complete',
        assistantMessageId: asMessageId('msg_assistant_root_complete'),
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: 'Done — root completed.',
        provider: 'openai',
        responseId: 'resp_root_complete',
        runId: rootRunId,
        sessionId: asSessionId('ses_1'),
        status: 'completed',
        threadId: asThreadId('thr_1'),
        usage: null,
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.completed', {
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
          {
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_child_tool_called_after_root_complete'),
            payload: {
              args: { query: 'Nora En Pure - Memories' },
              callId: 'call_child_after_complete',
              runId: childRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'spotify__search_catalog',
            },
            type: 'tool.called',
          } satisfies BackendEvent,
        ])
      },
    })

    await store.switchToThread(thread())
    threadMessages = [
      userMessageWith({
        content: [{ text: 'Play Memories.', type: 'text' }],
        id: inputId,
      }),
      assistantMessage('Done — root completed.', rootRunId),
    ]

    const ok = await store.submit('Play Memories.')

    expect(ok).toBe(true)
    expect(store.runId).toBe(null)
    expect(store.messages).toHaveLength(2)
    expect(store.messages.some((message) => message.runId === childRunId)).toBe(false)
  })

  test('keeps delegated child activity and confirmation requests in the live transcript', async () => {
    const rootRunId = asRunId('run_root')
    const childRunId = asRunId('run_child')
    const inputId = asMessageId('msg_delegate_input')
    let threadMessages = [userMessage()]

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        pendingWaits: [],
        provider: 'openai',
        responseId: null,
        runId: rootRunId,
        sessionId: asSessionId('ses_1'),
        status: 'waiting',
        threadId: asThreadId('thr_1'),
        usage: null,
        waitIds: [],
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          {
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_delegate_called'),
            payload: {
              args: { agentAlias: 'tony', task: 'Switch the music' },
              callId: 'call_delegate_1',
              runId: rootRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'delegate_to_agent',
            },
            type: 'tool.called',
          },
          {
            createdAt: at,
            eventNo: 4,
            id: asEventId('evt_delegate_waiting'),
            payload: {
              args: { agentAlias: 'tony', task: 'Switch the music' },
              callId: 'call_delegate_1',
              description: 'Waiting for delegated child agent "tony"',
              runId: rootRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'delegate_to_agent',
              waitId: 'wte_delegate_1',
              waitTargetKind: 'run',
              waitTargetRef: 'tony:run_child',
              waitTargetRunId: childRunId,
              waitType: 'agent',
            },
            type: 'tool.waiting',
          },
          runEvent(5, 'run.waiting', {
            pendingWaits: [],
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            status: 'waiting',
            threadId: asThreadId('thr_1'),
            waitIds: [],
          }),
          {
            createdAt: at,
            eventNo: 6,
            id: asEventId('evt_child_tool_called'),
            payload: {
              args: { action: 'play_track', query: 'Nora En Pure - Pretoria' },
              callId: 'call_child_tool',
              runId: childRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'spotify__spotify_control',
            },
            type: 'tool.called',
          },
          {
            createdAt: at,
            eventNo: 7,
            id: asEventId('evt_child_confirmation'),
            payload: {
              args: { action: 'play_track', query: 'Nora En Pure - Pretoria' },
              callId: 'call_child_tool',
              description: 'Confirm switching the music on Adam’s MacBook Pro.',
              runId: childRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'spotify__spotify_control',
              waitId: 'wte_child_tool',
              waitTargetKind: 'human_response',
              waitTargetRef: 'spotify__spotify_control',
              waitType: 'human',
            },
            type: 'tool.confirmation_requested',
          },
        ])
        threadMessages = [
          userMessageWith({
            content: [{ text: 'Ask Tony to switch the music.', type: 'text' }],
            id: inputId,
          }),
        ]
      },
    })

    await store.switchToThread(thread())
    await store.submit('Ask Tony to switch the music.')

    const assistant = store.messages.find((message) => message.role === 'assistant')
    expect(assistant?.blocks).toMatchObject([
      {
        childRunId: 'run_child',
        name: 'delegate_to_agent',
        status: 'running',
        toolCallId: 'call_delegate_1',
        type: 'tool_interaction',
      },
      {
        confirmation: {
          description: 'Confirm switching the music on Adam’s MacBook Pro.',
          ownerRunId: 'run_child',
          waitId: 'wte_child_tool',
        },
        name: 'spotify__spotify_control',
        sourceRunId: 'run_child',
        status: 'awaiting_confirmation',
        toolCallId: 'call_child_tool',
        type: 'tool_interaction',
      },
    ])
  })

  test('approves a delegated child confirmation on the child run id', async () => {
    const rootRunId = asRunId('run_root')
    const childRunId = asRunId('run_child')
    const inputId = asMessageId('msg_delegate_input')
    const resumeCalls: Array<{ input: Record<string, unknown>; runId: RunId }> = []
    let streamInvocation = 0

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      resumeRun: async (runId, input) => {
        resumeCalls.push({ input, runId })
        return {
          assistantItemId: null,
          assistantMessageId: null,
          model: 'gpt-5.4',
          outputText: '',
          provider: 'openai',
          responseId: 'resp_child_resume',
          runId,
          status: 'completed',
          usage: null,
        }
      },
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        pendingWaits: [],
        provider: 'openai',
        responseId: null,
        runId: rootRunId,
        sessionId: asSessionId('ses_1'),
        status: 'waiting',
        threadId: asThreadId('thr_1'),
        usage: null,
        waitIds: [],
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        streamInvocation += 1
        if (streamInvocation === 1) {
          onEvents([
            runEvent(1, 'run.created', {
              runId: rootRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
            }),
            runEvent(2, 'run.started', {
              runId: rootRunId,
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId: asThreadId('thr_1'),
            }),
            {
              createdAt: at,
              eventNo: 3,
              id: asEventId('evt_delegate_called_for_resume'),
              payload: {
                args: { agentAlias: 'tony', task: 'Switch the music' },
                callId: 'call_delegate_resume',
                runId: rootRunId,
                sessionId: asSessionId('ses_1'),
                threadId: asThreadId('thr_1'),
                tool: 'delegate_to_agent',
              },
              type: 'tool.called',
            },
            {
              createdAt: at,
              eventNo: 4,
              id: asEventId('evt_delegate_waiting_for_resume'),
              payload: {
                args: { agentAlias: 'tony', task: 'Switch the music' },
                callId: 'call_delegate_resume',
                description: 'Waiting for delegated child agent "tony"',
                runId: rootRunId,
                sessionId: asSessionId('ses_1'),
                threadId: asThreadId('thr_1'),
                tool: 'delegate_to_agent',
                waitId: 'wte_delegate_resume',
                waitTargetKind: 'run',
                waitTargetRef: 'tony:run_child',
                waitTargetRunId: childRunId,
                waitType: 'agent',
              },
              type: 'tool.waiting',
            },
            runEvent(5, 'run.waiting', {
              pendingWaits: [],
              runId: rootRunId,
              sessionId: asSessionId('ses_1'),
              status: 'waiting',
              threadId: asThreadId('thr_1'),
              waitIds: [],
            }),
            {
              createdAt: at,
              eventNo: 6,
              id: asEventId('evt_child_confirmation_for_resume'),
              payload: {
                args: { action: 'play_track', query: 'Nora En Pure - Pretoria' },
                callId: 'call_child_confirm_resume',
                description: 'Confirm switching the music on Adam’s MacBook Pro.',
                runId: childRunId,
                sessionId: asSessionId('ses_1'),
                threadId: asThreadId('thr_1'),
                tool: 'spotify__spotify_control',
                waitId: 'wte_child_resume',
                waitTargetKind: 'human_response',
                waitTargetRef: 'spotify__spotify_control',
                waitType: 'human',
              },
              type: 'tool.confirmation_requested',
            },
          ])
          return
        }

        onEvents([])
      },
    })

    await store.switchToThread(thread())
    await store.submit('Ask Tony to switch the music.')
    await store.approvePendingWait('wte_child_resume', childRunId)

    expect(resumeCalls).toEqual([
      {
        input: {
          approve: true,
          rememberApproval: false,
          waitId: 'wte_child_resume',
        },
        runId: childRunId,
      },
    ])
    expect(store.runId).toBe(rootRunId)
    expect(store.isWaiting).toBe(true)
  })

  test('replies to the current parent wait instead of a delegated child human-response wait', async () => {
    const rootRunId = asRunId('run_root')
    const childRunId = asRunId('run_child')
    const inputId = asMessageId('msg_delegate_input')
    const replyMessageId = asMessageId('msg_delegate_reply')
    const postCalls: Array<{ input: Record<string, unknown>; threadId: ThreadId }> = []
    const resumeCalls: Array<{ input: Record<string, unknown>; runId: RunId }> = []
    const storage = createStorage()
    let startInteractionCalls = 0
    let streamInvocation = 0
    let threadMessages = [
      userMessageWith({
        content: [{ text: 'Ask Tony to switch the music.', type: 'text' }],
        id: inputId,
      }),
    ]

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 0,
        runId: rootRunId,
        sessionId: asSessionId('ses_1'),
        threadId: asThreadId('thr_1'),
      }),
    )

    const store = createChatStore({
      getRun: async () =>
        ({
          completedAt: null,
          configSnapshot: {},
          createdAt: at,
          errorJson: null,
          id: rootRunId,
          job: null,
          jobId: null,
          metadataJson: null,
          parentRunId: null,
          resultJson: {
            model: 'gpt-5.4',
            outputText: 'Which Nora En Pure track do you want?',
            pendingWaits: [
              {
                args: {
                  details: {
                    question: 'Which Nora En Pure track do you want?',
                  },
                  reason: 'Need the exact Nora En Pure track before resuming Tony.',
                },
                callId: 'call_parent_suspend_reply',
                createdAt: at,
                description: 'Which Nora En Pure track do you want?',
                requiresApproval: false,
                targetKind: 'human_response',
                targetRef: 'user_response',
                tool: 'suspend_run',
                type: 'human',
                waitId: 'wte_root_suspend_reply',
              },
            ],
            waitIds: ['wte_root_suspend_reply'],
          },
          rootRunId,
          sessionId: asSessionId('ses_1'),
          startedAt: at,
          status: 'waiting',
          targetKind: 'thread',
          task: 'Ask Tony to switch the music.',
          threadId: asThreadId('thr_1'),
          toolProfileId: null,
          turnCount: 1,
          updatedAt: at,
          version: 2,
          workspaceRef: null,
        }) satisfies BackendRun,
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      postThreadMessage: async (threadId, input) => {
        postCalls.push({ input: input as Record<string, unknown>, threadId })
        threadMessages = [
          userMessageWith({
            content: [{ text: 'Ask Tony to switch the music.', type: 'text' }],
            id: inputId,
          }),
          userMessageWith({
            content: [{ text: String(input.text), type: 'text' }],
            id: replyMessageId,
            sequence: 2,
          }),
        ]

        return {
          messageId: replyMessageId,
          sequence: 2,
          sessionId: asSessionId('ses_1'),
          threadId,
        }
      },
      resumeRun: async (runId, input) => {
        resumeCalls.push({ input: input as Record<string, unknown>, runId })
        return {
          assistantItemId: null,
          assistantMessageId: null,
          model: 'gpt-5.4',
          outputText: '',
          provider: 'openai',
          responseId: 'resp_parent_reply_resume',
          runId,
          status: 'waiting',
          usage: null,
        }
      },
      startThreadInteraction: async () => {
        startInteractionCalls += 1
        return {
          assistantItemId: null,
          assistantMessageId: null,
          attachedFileIds: [],
          inputMessageId: inputId,
          model: 'gpt-5.4',
          outputText: '',
          pendingWaits: [],
          provider: 'openai',
          responseId: null,
          runId: rootRunId,
          sessionId: asSessionId('ses_1'),
          status: 'waiting',
          threadId: asThreadId('thr_1'),
          usage: null,
          waitIds: [],
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        streamInvocation += 1
        if (streamInvocation > 1) {
          onEvents([])
          return
        }

        onEvents([
          {
            createdAt: at,
            eventNo: 1,
            id: asEventId('evt_child_waiting_for_human_reply'),
            payload: {
              args: {
                details: {
                  question: 'Which Nora En Pure track do you want?',
                },
                reason: 'The request is ambiguous.',
              },
              callId: 'call_child_suspend_reply',
              description: 'Which Nora En Pure track do you want?',
              runId: childRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'suspend_run',
              waitId: 'wte_child_suspend_reply',
              waitTargetKind: 'human_response',
              waitTargetRef: 'user_response',
              waitType: 'human',
            },
            type: 'tool.waiting',
          },
        ])
      },
    })

    await store.hydrate()

    expect(store.isWaiting).toBe(true)
    expect(store.canReplyToPendingWait).toBe(true)

    const ok = await store.submit('Which Nora En Pure track do you want?')

    expect(ok).toBe(true)
    expect(startInteractionCalls).toBe(0)
    expect(postCalls).toEqual([
      {
        input: {
          text: 'Which Nora En Pure track do you want?',
        },
        threadId: asThreadId('thr_1'),
      },
    ])
    expect(resumeCalls).toEqual([
      {
        input: {
          output: {
            content: [{ text: 'Which Nora En Pure track do you want?', type: 'text' }],
            kind: 'human_response',
            sourceMessageId: replyMessageId,
            text: 'Which Nora En Pure track do you want?',
            threadId: asThreadId('thr_1'),
          },
          waitId: 'wte_root_suspend_reply',
        },
        runId: rootRunId,
      },
    ])
    expect(store.runId).toBe(rootRunId)
    expect(store.isWaiting).toBe(true)
  })

  test('hydrates a waiting run and cancels it by real backend run id', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const cancelCalls: RunId[] = []
    let cancelledOnServer = false

    const waitingRun = {
      completedAt: null,
      configSnapshot: {},
      createdAt: at,
      errorJson: null,
      id: asRunId('run_waiting'),
      lastProgressAt: at,
      parentRunId: null,
      resultJson: { pendingWaits: [pendingConfirmationWait()], waitIds: ['wte_1'] },
      rootRunId: asRunId('run_waiting'),
      sessionId: asSessionId('ses_1'),
      sourceCallId: null,
      startedAt: at,
      status: 'waiting' as const,
      task: 'Need human input',
      tenantId: 'ten_overment',
      threadId: asThreadId('thr_1'),
      turnCount: 1,
      updatedAt: at,
      version: 2,
      workspaceRef: null,
    } satisfies BackendRun

    const store = createChatStore({
      cancelRun: async (runId) => {
        cancelCalls.push(runId)
        cancelledOnServer = true
        return { runId, status: 'cancelled' }
      },
      getRun: async () =>
        cancelledOnServer
          ? ({
              ...waitingRun,
              completedAt: at,
              resultJson: null,
              status: 'cancelled',
            } satisfies BackendRun)
          : waitingRun,
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      storage,
    })

    await store.hydrate()

    expect(store.isWaiting).toBe(true)
    expect(store.pendingToolConfirmation).toMatchObject({
      tool: 'mcp.echo',
      waitId: 'wte_1',
    })
    await store.cancel()

    expect(cancelCalls).toEqual([asRunId('run_waiting')])
    expect(store.isWaiting).toBe(false)
    expect(store.runId).toBe(null)
    expect(store.error).toBe(null)
  })

  test('cancel marks active live tool and web search blocks as terminal', async () => {
    const runId = asRunId('run_cancel_live')
    const storage = createStorage()
    let cancelledOnServer = false

    const store = createChatStore({
      cancelRun: async (value) => {
        cancelledOnServer = true
        return { runId: value, status: 'cancelled' }
      },
      getRun: async () =>
        buildRun(cancelledOnServer ? 'cancelled' : 'running', {
          id: runId,
          rootRunId: runId,
          threadId: asThreadId('thr_1'),
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      storage,
      streamThreadEvents: async ({ onEvents, signal }) => {
        onEvents([
          runEvent(1, 'run.started', {
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          {
            createdAt: at,
            eventNo: 2,
            id: asEventId('evt_cancel_live_tool'),
            payload: {
              args: { query: 'album' },
              callId: 'call_cancel_live_tool',
              runId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'spotify__search_catalog',
            },
            type: 'tool.called',
          } as BackendEvent,
          {
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_cancel_live_search'),
            payload: {
              patterns: [],
              provider: 'openai',
              queries: ['album'],
              references: [],
              responseId: null,
              runId,
              searchId: 'search_cancel_live',
              sessionId: asSessionId('ses_1'),
              status: 'searching',
              targetUrls: [],
              threadId: asThreadId('thr_1'),
            },
            type: 'web_search.progress',
          } as BackendEvent,
        ])

        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    await store.switchToThread(
      threadWith({
        rootJob: {
          currentRunId: runId,
          id: 'job_cancel_live',
          status: 'running',
        },
      }),
    )
    await Promise.resolve()

    const assistantBeforeCancel = store.messages.find((message) => message.role === 'assistant')
    expect(assistantBeforeCancel?.blocks).toMatchObject([
      {
        name: 'spotify__search_catalog',
        status: 'running',
        type: 'tool_interaction',
      },
      {
        status: 'searching',
        type: 'web_search',
      },
    ])

    await store.cancel()

    const assistantAfterCancel = store.messages.find((message) => message.role === 'assistant')
    expect(assistantAfterCancel?.blocks).toMatchObject([
      {
        name: 'spotify__search_catalog',
        status: 'error',
        type: 'tool_interaction',
      },
      {
        status: 'failed',
        type: 'web_search',
      },
    ])
    expect(store.runId).toBe(null)
  })

  test('cancel keeps a durable cancelled transcript authoritative over stale live reasoning', async () => {
    const runId = asRunId('run_cancel_reasoning')
    const storage = createStorage()
    let cancelledOnServer = false
    let messages: BackendThreadMessage[] = [userMessage()]
    const cancelledTranscript = {
      blocks: [
        {
          content: 'Need approval before calling the tool.',
          createdAt: at,
          id: 'thinking:rs_cancel_reasoning_1',
          status: 'done' as const,
          title: 'reasoning',
          type: 'thinking' as const,
        },
      ],
      toolBlocks: [],
      version: 2 as const,
      webSearchBlocks: [],
    }
    const cancelledAssistant = {
      ...assistantMessageWithMetadata(
        'Need approval before I can finish.',
        {
          finishReason: 'cancelled',
          transcript: cancelledTranscript,
        },
        runId,
      ),
      id: asMessageId('msg_cancel_reasoning'),
    }

    const store = createChatStore({
      cancelRun: async (value) => {
        cancelledOnServer = true
        messages = [userMessage(), cancelledAssistant]
        return { runId: value, status: 'cancelled' }
      },
      getRun: async () =>
        buildRun(cancelledOnServer ? 'cancelled' : 'running', {
          completedAt: cancelledOnServer ? at : null,
          id: runId,
          resultJson: cancelledOnServer
            ? {
                assistantMessageId: cancelledAssistant.id,
                outputText: 'Need approval before I can finish.',
                transcript: cancelledTranscript,
              }
            : null,
          rootRunId: runId,
          threadId: asThreadId('thr_1'),
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      storage,
      streamThreadEvents: async ({ onEvents, signal }) => {
        onEvents([
          runEvent(1, 'run.started', {
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          {
            createdAt: at,
            eventNo: 2,
            id: asEventId('evt_cancel_reasoning_delta'),
            payload: {
              delta: 'Thinking through the resize request.',
              itemId: 'rs_cancel_reasoning_1',
              runId,
              sessionId: asSessionId('ses_1'),
              text: 'Thinking through the resize request.',
              threadId: asThreadId('thr_1'),
              turn: 1,
            },
            type: 'reasoning.summary.delta',
          } as BackendEvent,
        ])

        await new Promise<void>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true },
          )
        })
      },
    })

    await store.switchToThread(
      threadWith({
        rootJob: {
          currentRunId: runId,
          id: 'job_cancel_reasoning',
          status: 'running',
        },
      }),
    )
    await Promise.resolve()

    const assistantBeforeCancel = store.messages.find((message) => message.role === 'assistant')
    expect(assistantBeforeCancel?.blocks).toMatchObject([
      {
        id: 'thinking:rs_cancel_reasoning_1',
        status: 'thinking',
        type: 'thinking',
      },
    ])

    await store.cancel()

    const assistantAfterCancel = store.messages.find(
      (message) => message.id === asMessageId('msg_cancel_reasoning'),
    )
    expect(assistantAfterCancel?.status).toBe('complete')
    expect(assistantAfterCancel?.finishReason).toBe('cancelled')
    expect(
      assistantAfterCancel?.blocks.some(
        (block) => block.type === 'thinking' && block.status === 'thinking',
      ),
    ).toBe(false)
    expect(assistantAfterCancel?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Need approval before calling the tool.',
          id: 'thinking:rs_cancel_reasoning_1',
          status: 'done',
          type: 'thinking',
        }),
      ]),
    )
  })

  test('cancel keeps the durable assistant response visible after the next submit', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const cancelledTranscript = persistedReasoningWaitingTranscript().transcript
    const cancelledAssistant = {
      ...assistantMessageWithMetadata(
        'Need approval before I can finish.',
        { finishReason: 'cancelled', transcript: cancelledTranscript },
        asRunId('run_waiting'),
      ),
      id: asMessageId('msg_cancelled_assistant'),
    }

    let cancelledOnServer = false
    let messages: BackendThreadMessage[] = [userMessage()]

    const waitingRun = {
      completedAt: null,
      configSnapshot: {},
      createdAt: at,
      errorJson: null,
      id: asRunId('run_waiting'),
      lastProgressAt: at,
      parentRunId: null,
      resultJson: {
        outputText: 'Need approval before I can finish.',
        pendingWaits: [pendingConfirmationWait()],
        transcript: cancelledTranscript,
        waitIds: ['wte_1'],
      },
      rootRunId: asRunId('run_waiting'),
      sessionId: asSessionId('ses_1'),
      sourceCallId: null,
      startedAt: at,
      status: 'waiting' as const,
      task: 'Need human input',
      tenantId: 'ten_overment',
      threadId: asThreadId('thr_1'),
      turnCount: 1,
      updatedAt: at,
      version: 2,
      workspaceRef: null,
    } satisfies BackendRun

    const store = createChatStore({
      cancelRun: async (runId) => {
        cancelledOnServer = true
        messages = [userMessage(), cancelledAssistant]
        return { runId, status: 'cancelled' }
      },
      getRun: async () =>
        cancelledOnServer
          ? ({
              ...waitingRun,
              completedAt: at,
              resultJson: {
                assistantMessageId: asMessageId('msg_cancelled_assistant'),
                outputText: 'Need approval before I can finish.',
                transcript: cancelledTranscript,
              },
              status: 'cancelled',
            } satisfies BackendRun)
          : waitingRun,
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      startThreadInteraction: async (threadId) => {
        messages = [
          userMessage(),
          cancelledAssistant,
          {
            ...userMessage(),
            content: [{ text: 'What should we do next?', type: 'text' }],
            id: asMessageId('msg_follow_up'),
            runId: asRunId('run_2'),
            sequence: 3,
          },
          {
            ...assistantMessage('Next, reconnect SSE.', asRunId('run_2')),
            id: asMessageId('msg_assistant_2'),
            sequence: 4,
          },
        ]

        return {
          assistantItemId: 'itm_2',
          assistantMessageId: asMessageId('msg_assistant_2'),
          attachedFileIds: [],
          inputMessageId: asMessageId('msg_follow_up'),
          model: 'gpt-5.4',
          outputText: 'Next, reconnect SSE.',
          provider: 'openai',
          responseId: 'resp_2',
          runId: asRunId('run_2'),
          sessionId: asSessionId('ses_1'),
          status: 'completed',
          threadId,
          usage: null,
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(13, 'run.started', {
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          runEvent(14, 'stream.delta', {
            delta: 'Next, reconnect SSE.',
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(15, 'message.posted', {
            messageId: asMessageId('msg_assistant_2'),
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(16, 'run.completed', {
            outputText: 'Next, reconnect SSE.',
            runId: asRunId('run_2'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
      },
    })

    await store.hydrate()
    await store.cancel()

    expect(
      store.messages.some((message) => message.id === asMessageId('msg_cancelled_assistant')),
    ).toBe(true)
    expect(
      store.messages.find((message) => message.id === asMessageId('msg_cancelled_assistant'))
        ?.finishReason,
    ).toBe('cancelled')

    await store.submit('What should we do next?')

    expect(
      store.messages.some((message) => message.id === asMessageId('msg_cancelled_assistant')),
    ).toBe(true)
    expect(
      store.messages.find((message) => message.id === asMessageId('msg_cancelled_assistant'))
        ?.finishReason,
    ).toBe('cancelled')
    expect(
      store.messages
        .find((message) => message.id === asMessageId('msg_cancelled_assistant'))
        ?.blocks.some(
          (block) =>
            block.type === 'text' && block.content === 'Need approval before I can finish.',
        ),
    ).toBe(true)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Next, reconnect SSE.',
    })
  })

  test('hydrates waiting-run transcript blocks without losing reasoning', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        activeRunTranscript: persistedRunTranscript(
          asRunId('run_waiting'),
          materializeBlocks([
            runEvent(11, 'stream.delta', {
              delta: 'stale waiting transcript\n',
              runId: asRunId('run_waiting'),
              sessionId: asSessionId('ses_1'),
              status: 'running',
              threadId: asThreadId('thr_1'),
              turn: 1,
            }),
          ]),
          {
            messageId: asMessageId('live:run_waiting'),
          },
        ),
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getRun: async () =>
        ({
          completedAt: null,
          configSnapshot: {},
          createdAt: at,
          errorJson: null,
          id: asRunId('run_waiting'),
          lastProgressAt: at,
          parentRunId: null,
          resultJson: {
            outputText: '',
            pendingWaits: [pendingConfirmationWait()],
            ...persistedReasoningWaitingTranscript(),
            waitIds: ['wte_1'],
          },
          rootRunId: asRunId('run_waiting'),
          sessionId: asSessionId('ses_1'),
          sourceCallId: null,
          startedAt: at,
          status: 'waiting',
          task: 'Need human input',
          tenantId: 'ten_overment',
          threadId: asThreadId('thr_1'),
          turnCount: 1,
          updatedAt: at,
          version: 2,
          workspaceRef: null,
        }) satisfies BackendRun,
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      storage,
    })

    await store.hydrate()

    expect(store.isWaiting).toBe(true)
    expect(store.messages[1]?.blocks).toMatchObject([
      {
        content: 'Need approval before calling the tool.',
        id: 'thinking:rs_reasoning_waiting_1',
        status: 'done',
        type: 'thinking',
      },
      {
        args: { value: 'hello' },
        confirmation: {
          description: 'Confirmation required before running mcp.echo',
          targetRef: 'mcp.echo',
          waitId: 'wte_1',
        },
        name: 'mcp.echo',
        status: 'awaiting_confirmation',
        type: 'tool_interaction',
      },
    ])
  })

  test('cancel reconciles a run that is already terminal server-side', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let runReads = 0
    let messages = [userMessage()]

    const store = createChatStore({
      cancelRun: async () => {
        throw new Error('run run_waiting is already terminal')
      },
      getRun: async () => {
        runReads += 1
        if (runReads === 1) {
          return buildRun('waiting', {
            id: asRunId('run_waiting'),
            rootRunId: asRunId('run_waiting'),
            threadId: asThreadId('thr_1'),
          })
        }

        messages = [
          userMessage(),
          assistantMessage('Recovered after cancel conflict.', asRunId('run_waiting')),
        ]
        return buildRun('completed', {
          id: asRunId('run_waiting'),
          rootRunId: asRunId('run_waiting'),
          threadId: asThreadId('thr_1'),
        })
      },
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      storage,
    })

    await store.hydrate()
    expect(store.isWaiting).toBe(true)

    await store.cancel()

    expect(runReads).toBe(2)
    expect(store.runId).toBe(null)
    expect(store.isWaiting).toBe(false)
    expect(store.error).toBe(null)
    expect(store.messages.at(-1)?.text).toBe('Recovered after cancel conflict.')
  })

  test('approves a pending wait and resumes the run through the backend resume route', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const resumeCalls: Array<{ input: Record<string, unknown>; runId: RunId }> = []
    let emitEvents: ((events: BackendEvent[]) => void) | null = null

    const store = createChatStore({
      getRun: async () =>
        ({
          completedAt: null,
          configSnapshot: {},
          createdAt: at,
          errorJson: null,
          id: asRunId('run_waiting'),
          lastProgressAt: at,
          parentRunId: null,
          resultJson: { pendingWaits: [pendingConfirmationWait()], waitIds: ['wte_1'] },
          rootRunId: asRunId('run_waiting'),
          sessionId: asSessionId('ses_1'),
          sourceCallId: null,
          startedAt: at,
          status: 'waiting',
          task: 'Need tool approval',
          tenantId: 'ten_overment',
          threadId: asThreadId('thr_1'),
          turnCount: 1,
          updatedAt: at,
          version: 2,
          workspaceRef: null,
        }) satisfies BackendRun,
      getThread: async () => thread(),
      listThreadMessages: async () => [
        userMessage(),
        assistantMessageWithMetadata(
          'Approved tool output.',
          persistedToolTranscript(false),
          asRunId('run_waiting'),
        ),
      ],
      resumeRun: async (runId, input) => {
        resumeCalls.push({ input, runId })
        emitEvents?.([
          runEvent(13, 'run.resumed', {
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            waitId: 'wte_1',
          }),
          runEvent(14, 'tool.confirmation_granted', {
            callId: 'call_waiting_1',
            remembered: false,
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
            tool: 'mcp.echo',
            waitId: 'wte_1',
          }),
          runEvent(15, 'tool.completed', {
            callId: 'call_waiting_1',
            outcome: { echoed: 'hello' },
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
            tool: 'mcp.echo',
          }),
          runEvent(16, 'stream.delta', {
            delta: 'Approved tool output.',
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(17, 'stream.done', {
            model: 'gpt-5.4',
            provider: 'openai',
            responseId: 'resp_resume_1',
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            text: 'Approved tool output.',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(18, 'run.completed', {
            outputText: 'Approved tool output.',
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
        return {
          runId,
          status: 'accepted',
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        emitEvents = onEvents
        onEvents([])
      },
    })

    await store.hydrate()
    expect(store.isWaiting).toBe(true)

    await store.approvePendingWait()

    expect(resumeCalls).toEqual([
      {
        input: {
          approve: true,
          rememberApproval: false,
          waitId: 'wte_1',
        },
        runId: asRunId('run_waiting'),
      },
    ])
    expect(store.isWaiting).toBe(false)
    expect(store.runId).toBe(null)
    expect(store.error).toBe(null)
    expect(store.messages[1]?.blocks).toMatchObject([
      {
        args: { value: 'hello' },
        name: 'mcp.echo',
        output: { echoed: 'hello' },
        status: 'complete',
        type: 'tool_interaction',
      },
      {
        content: 'Approved tool output.',
        type: 'text',
      },
    ])
  })

  test('trusts a pending wait and persists the approval through the backend resume route', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const resumeCalls: Array<{ input: Record<string, unknown>; runId: RunId }> = []
    let emitEvents: ((events: BackendEvent[]) => void) | null = null

    const store = createChatStore({
      getRun: async () =>
        ({
          completedAt: null,
          configSnapshot: {},
          createdAt: at,
          errorJson: null,
          id: asRunId('run_waiting'),
          lastProgressAt: at,
          parentRunId: null,
          resultJson: { pendingWaits: [pendingConfirmationWait()], waitIds: ['wte_1'] },
          rootRunId: asRunId('run_waiting'),
          sessionId: asSessionId('ses_1'),
          sourceCallId: null,
          startedAt: at,
          status: 'waiting',
          task: 'Need tool approval',
          tenantId: 'ten_overment',
          threadId: asThreadId('thr_1'),
          turnCount: 1,
          updatedAt: at,
          version: 2,
          workspaceRef: null,
        }) satisfies BackendRun,
      getThread: async () => thread(),
      listThreadMessages: async () => [
        userMessage(),
        assistantMessageWithMetadata(
          'Trusted tool output.',
          persistedToolTranscript(true),
          asRunId('run_waiting'),
        ),
      ],
      resumeRun: async (runId, input) => {
        resumeCalls.push({ input, runId })
        emitEvents?.([
          runEvent(13, 'run.resumed', {
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            waitId: 'wte_1',
          }),
          runEvent(14, 'run.completed', {
            outputText: 'Trusted tool output.',
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
        return {
          runId,
          status: 'accepted',
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        emitEvents = onEvents
        onEvents([])
      },
    })

    await store.hydrate()
    expect(store.isWaiting).toBe(true)

    await store.trustPendingWait()

    expect(resumeCalls).toEqual([
      {
        input: {
          approve: true,
          rememberApproval: true,
          waitId: 'wte_1',
        },
        runId: asRunId('run_waiting'),
      },
    ])
    expect(store.isWaiting).toBe(false)
    expect(store.runId).toBe(null)
    expect(store.error).toBe(null)
  })

  test('shows sandbox output files as assistant attachments after the response settles', async () => {
    const runId = asRunId('run_sandbox_live')
    const inputId = asMessageId('msg_sandbox_input')
    let threadMessages: BackendThreadMessage[] = [userMessage()]
    let attachmentsAfterToolCompleted: MessageAttachment[] = []
    let attachmentsAfterStreamDone: MessageAttachment[] = []
    let store!: ReturnType<typeof createChatStore>

    store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        provider: 'openai',
        responseId: null,
        runId,
        sessionId: asSessionId('ses_1'),
        status: 'completed',
        threadId: asThreadId('thr_1'),
        usage: null,
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId,
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          {
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_sandbox_called'),
            payload: {
              args: { task: 'Resize image' },
              callId: 'call_sandbox_1',
              runId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'execute',
            },
            type: 'tool.called',
          } as BackendEvent,
          {
            createdAt: at,
            eventNo: 4,
            id: asEventId('evt_sandbox_completed'),
            payload: {
              callId: 'call_sandbox_1',
              outcome: {
                durationMs: 320,
                files: [
                  {
                    fileId: 'fil_resized_1',
                    mimeType: 'image/png',
                    originalFilename: 'resized-5x5.png',
                    sandboxPath: '/output/resized-5x5.png',
                    sizeBytes: 128,
                  },
                ],
                outputDir: '/output',
                sandboxExecutionId: 'sbx_1',
                status: 'completed',
                stderr: null,
                stdout: null,
                writebacks: [],
              },
              runId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'execute',
            },
            type: 'tool.completed',
          } as BackendEvent,
        ])

        attachmentsAfterToolCompleted =
          store.messages
            .find((message) => message.role === 'assistant')
            ?.attachments.map((attachment) => ({ ...attachment })) ?? []

        onEvents([
          runEvent(5, 'stream.delta', {
            delta: 'Done — I resized it.',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(6, 'stream.done', {
            model: 'gpt-5.4',
            provider: 'openai',
            responseId: 'resp_sandbox_live',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            text: 'Done — I resized it.',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
        ])

        attachmentsAfterStreamDone =
          store.messages
            .find((message) => message.role === 'assistant')
            ?.attachments.map((attachment) => ({ ...attachment })) ?? []

        onEvents([
          runEvent(7, 'run.completed', {
            outputText: 'Done — I resized it.',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])

        threadMessages = [
          userMessageWith({
            content: [{ text: 'Resize this image.', type: 'text' }],
            id: inputId,
          }),
          assistantMessage('Done — I resized it.', runId),
        ]
      },
    })

    await store.switchToThread(thread())
    await store.submit('Resize this image.')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const assistant = store.messages.find((message) => message.role === 'assistant')
    expect(attachmentsAfterToolCompleted).toEqual([])
    expect(attachmentsAfterStreamDone).toEqual([
      {
        id: 'fil_resized_1',
        kind: 'image',
        mime: 'image/png',
        name: 'resized-5x5.png',
        size: 128,
        thumbnailUrl: '/api/files/fil_resized_1/content',
        url: '/api/files/fil_resized_1/content',
      },
    ])
    expect(assistant?.attachments).toEqual([
      {
        id: 'fil_resized_1',
        kind: 'image',
        mime: 'image/png',
        name: 'resized-5x5.png',
        size: 128,
        thumbnailUrl: '/api/files/fil_resized_1/content',
        url: '/api/files/fil_resized_1/content',
      },
    ])
  })

  test('shows execute output files as assistant attachments after the response settles', async () => {
    const runId = asRunId('run_execute_live')
    const inputId = asMessageId('msg_execute_input')
    let threadMessages: BackendThreadMessage[] = [userMessage()]

    const store = createChatStore({
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        provider: 'openai',
        responseId: null,
        runId,
        sessionId: asSessionId('ses_1'),
        status: 'completed',
        threadId: asThreadId('thr_1'),
        usage: null,
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId,
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          {
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_execute_called'),
            payload: {
              args: { task: 'List files' },
              callId: 'call_execute_1',
              runId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'execute',
            },
            type: 'tool.called',
          } as BackendEvent,
          {
            createdAt: at,
            eventNo: 4,
            id: asEventId('evt_execute_completed'),
            payload: {
              callId: 'call_execute_1',
              outcome: {
                durationMs: 120,
                files: [
                  {
                    fileId: 'fil_garden_list_1',
                    mimeType: 'text/plain',
                    originalFilename: 'garden-files.txt',
                    sandboxPath: '/output/garden-files.txt',
                    sizeBytes: 64,
                  },
                ],
                outputDir: '/output',
                sandboxExecutionId: 'sbx_execute_1',
                status: 'completed',
                stderr: null,
                stdout: null,
                writebacks: [],
              },
              runId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'execute',
            },
            type: 'tool.completed',
          } as BackendEvent,
          runEvent(5, 'stream.delta', {
            delta: 'Attached the file list.',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(6, 'stream.done', {
            model: 'gpt-5.4',
            provider: 'openai',
            responseId: 'resp_execute_live',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            text: 'Attached the file list.',
            threadId: asThreadId('thr_1'),
            turn: 1,
          }),
          runEvent(7, 'run.completed', {
            outputText: 'Attached the file list.',
            runId,
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])

        threadMessages = [
          userMessageWith({
            content: [{ text: 'List the files.', type: 'text' }],
            id: inputId,
          }),
          assistantMessage('Attached the file list.', runId),
        ]
      },
    })

    await store.switchToThread(thread())
    await store.submit('List the files.')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const assistant = store.messages.find((message) => message.role === 'assistant')
    expect(assistant?.attachments).toEqual([
      {
        id: 'fil_garden_list_1',
        kind: 'file',
        mime: 'text/plain',
        name: 'garden-files.txt',
        size: 64,
        url: '/api/files/fil_garden_list_1/content',
      },
    ])
  })

  test('approvePendingWait preserves confirmation state and sets error when the HTTP call fails', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const store = createChatStore({
      getRun: async () =>
        ({
          completedAt: null,
          configSnapshot: {},
          createdAt: at,
          errorJson: null,
          id: asRunId('run_waiting'),
          lastProgressAt: at,
          parentRunId: null,
          resultJson: { pendingWaits: [pendingConfirmationWait()], waitIds: ['wte_1'] },
          rootRunId: asRunId('run_waiting'),
          sessionId: asSessionId('ses_1'),
          sourceCallId: null,
          startedAt: at,
          status: 'waiting',
          task: 'Need tool approval',
          tenantId: 'ten_overment',
          threadId: asThreadId('thr_1'),
          turnCount: 1,
          updatedAt: at,
          version: 2,
          workspaceRef: null,
        }) satisfies BackendRun,
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage()],
      resumeRun: async () => {
        throw new Error('Service unavailable')
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([])
      },
    })

    await store.hydrate()
    expect(store.isWaiting).toBe(true)

    const assistantBefore = store.messages.find((m) => m.role === 'assistant')
    const toolBlockBefore = assistantBefore?.blocks.find(
      (b) => b.type === 'tool_interaction' && b.toolCallId === 'call_waiting_1',
    )
    expect(toolBlockBefore).toMatchObject({
      status: 'awaiting_confirmation',
      type: 'tool_interaction',
    })
    expect(
      toolBlockBefore?.type === 'tool_interaction' ? toolBlockBefore.confirmation : null,
    ).toBeDefined()

    await store.approvePendingWait()

    expect(store.error).toBe('Service unavailable')

    const assistantAfter = store.messages.find((m) => m.role === 'assistant')
    const toolBlockAfter = assistantAfter?.blocks.find(
      (b) => b.type === 'tool_interaction' && b.toolCallId === 'call_waiting_1',
    )
    expect(toolBlockAfter).toMatchObject({
      status: 'awaiting_confirmation',
      type: 'tool_interaction',
    })
    expect(
      toolBlockAfter?.type === 'tool_interaction' ? toolBlockAfter.confirmation : null,
    ).toBeDefined()
  })

  test('rejects a pending wait and resumes the run through the backend resume route', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_waiting',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const resumeCalls: Array<{ input: Record<string, unknown>; runId: RunId }> = []
    let emitEvents: ((events: BackendEvent[]) => void) | null = null

    const store = createChatStore({
      getRun: async () =>
        ({
          completedAt: null,
          configSnapshot: {},
          createdAt: at,
          errorJson: null,
          id: asRunId('run_waiting'),
          lastProgressAt: at,
          parentRunId: null,
          resultJson: { pendingWaits: [pendingConfirmationWait()], waitIds: ['wte_1'] },
          rootRunId: asRunId('run_waiting'),
          sessionId: asSessionId('ses_1'),
          sourceCallId: null,
          startedAt: at,
          status: 'waiting',
          task: 'Need tool approval',
          tenantId: 'ten_overment',
          threadId: asThreadId('thr_1'),
          turnCount: 1,
          updatedAt: at,
          version: 2,
          workspaceRef: null,
        }) satisfies BackendRun,
      getThread: async () => thread(),
      listThreadMessages: async () => [
        userMessage(),
        assistantMessageWithMetadata(
          'Rejected tool output.',
          persistedToolTranscript(null),
          asRunId('run_waiting'),
        ),
      ],
      resumeRun: async (runId, input) => {
        resumeCalls.push({ input, runId })
        emitEvents?.([
          runEvent(13, 'run.resumed', {
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
            waitId: 'wte_1',
          }),
          runEvent(14, 'run.completed', {
            outputText: 'Rejected tool output.',
            runId: asRunId('run_waiting'),
            sessionId: asSessionId('ses_1'),
            status: 'completed',
            threadId: asThreadId('thr_1'),
          }),
        ])
        return {
          runId,
          status: 'accepted',
        }
      },
      storage,
      streamThreadEvents: async ({ onEvents }) => {
        emitEvents = onEvents
        onEvents([])
      },
    })

    await store.hydrate()
    expect(store.isWaiting).toBe(true)

    await store.rejectPendingWait()

    expect(resumeCalls).toEqual([
      {
        input: {
          approve: false,
          waitId: 'wte_1',
        },
        runId: asRunId('run_waiting'),
      },
    ])
    expect(store.isWaiting).toBe(false)
    expect(store.runId).toBe(null)
    expect(store.error).toBe(null)
  })

  test('branching from a durable assistant message creates and loads the branched thread', async () => {
    const sourceThread = thread()
    const branchedThread = threadWith({
      branchFromMessageId: asMessageId('msg_assistant'),
      branchFromSequence: 2,
      id: asThreadId('thr_branch'),
      parentThreadId: sourceThread.id,
      updatedAt: '2026-03-30T12:30:00.000Z',
    })
    const sourceMessages: BackendThreadMessage[] = [
      userMessage(),
      assistantMessage('Original reply'),
    ]
    const branchedMessages: BackendThreadMessage[] = [
      userMessageWith({
        id: asMessageId('msg_branch_user'),
        threadId: branchedThread.id,
      }),
      {
        ...assistantMessage('Original reply'),
        id: asMessageId('msg_branch_assistant'),
        runId: null,
        threadId: branchedThread.id,
      },
    ]
    const branchCalls: Array<{ sourceMessageId: string; threadId: ThreadId }> = []

    const store = createChatStore({
      branchThread: async (threadId, input) => {
        branchCalls.push({
          sourceMessageId: String(input.sourceMessageId),
          threadId,
        })
        return branchedThread
      },
      getThreadBudget: async () => null,
      listThreadMessages: async (threadId) =>
        threadId === branchedThread.id ? branchedMessages : sourceMessages,
      storage: createStorage(),
    })

    await store.switchToThread(sourceThread)

    await expect(store.branchFromMessage(asMessageId('msg_assistant'))).resolves.toBe(true)
    expect(branchCalls).toEqual([
      {
        sourceMessageId: 'msg_assistant',
        threadId: sourceThread.id,
      },
    ])
    expect(store.threadId).toBe(branchedThread.id)
    expect(store.messages.map((message) => message.id)).toEqual([
      asMessageId('msg_branch_user'),
      asMessageId('msg_branch_assistant'),
    ])
    expect(store.runId).toBe(null)
    expect(store.error).toBe(null)
  })

  test('per-turn target switching sends different targets on the same thread', async () => {
    const interactionCalls: Array<Record<string, unknown>> = []
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 0,
        runId: null,
        sessionId: 'ses_switching',
        threadId: 'thr_switching',
      }),
    )

    const makeInteractionResult = (runId: string) => ({
      assistantItemId: `itm_${runId}`,
      assistantMessageId: asMessageId(`msg_${runId}`),
      attachedFileIds: [],
      inputMessageId: asMessageId(`msg_user_${runId}`),
      model: 'gpt-5.4',
      outputText: '',
      provider: 'openai',
      responseId: `resp_${runId}`,
      runId: asRunId(runId),
      sessionId: asSessionId('ses_switching'),
      status: 'completed' as const,
      threadId: asThreadId('thr_switching'),
      usage: null,
    })

    let callCount = 0

    const store = createChatStore({
      getThread: async () =>
        threadWith({
          id: asThreadId('thr_switching'),
          sessionId: asSessionId('ses_switching'),
          title: 'Target switching thread',
        }),
      listThreadMessages: async () => [],
      startThreadInteraction: async (threadId, input) => {
        callCount += 1
        interactionCalls.push({ input, threadId })
        return makeInteractionResult(`run_turn_${callCount}`)
      },
      storage,
      streamThreadEvents: async () => {},
    })

    await store.hydrate()

    // Turn 1: agent target
    await store.submit('Turn 1 with agent', [], [], {
      agentId: 'agt_alice',
      agentName: 'Alice',
    })

    // Turn 2: explicit assistant target
    store.setTargetMode('assistant')
    await store.submit('Turn 2 with assistant', [], [])

    // Turn 3: back to default (no explicit target)
    store.setTargetMode('default')
    await store.submit('Turn 3 with default', [], [])

    expect(interactionCalls).toEqual([
      {
        input: {
          target: { agentId: 'agt_alice', kind: 'agent' },
          text: 'Turn 1 with agent',
        },
        threadId: asThreadId('thr_switching'),
      },
      {
        input: {
          target: { kind: 'assistant' },
          text: 'Turn 2 with assistant',
        },
        threadId: asThreadId('thr_switching'),
      },
      {
        input: {
          text: 'Turn 3 with default',
        },
        threadId: asThreadId('thr_switching'),
      },
    ])
  })

  test('resolveHydratedRun re-anchors to the root run when the stored run is a private child', async () => {
    const rootRunId = asRunId('run_root_rehydrate')
    const childRunId = asRunId('run_child_rehydrate')
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 10,
        runId: childRunId,
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    const getRunCalls: RunId[] = []

    const store = createChatStore({
      getRun: async (runId) => {
        getRunCalls.push(runId)

        if (runId === childRunId) {
          return buildRun('completed', {
            id: childRunId,
            parentRunId: rootRunId,
            rootRunId,
            threadId: null,
          })
        }

        return buildRun('completed', {
          id: rootRunId,
          rootRunId,
          threadId: asThreadId('thr_1'),
        })
      },
      getThread: async () => thread(),
      listThreadMessages: async () => [userMessage(), assistantMessage('Root answer.', rootRunId)],
      storage,
    })

    await store.hydrate()

    // First call fetches the stored child run, second fetches the root run
    expect(getRunCalls).toEqual([childRunId, rootRunId])
    expect(store.runId).toBe(null)
    expect(store.messages.at(-1)?.blocks[0]).toMatchObject({
      type: 'text',
      content: 'Root answer.',
    })
  })

  test('waiting run transitions to completed after reconciliation poll returns terminal state', async () => {
    const storage = createStorage()
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        eventCursor: 12,
        runId: 'run_wait_to_done',
        sessionId: 'ses_1',
        threadId: 'thr_1',
      }),
    )

    let runReads = 0
    let messages = [
      userMessage(),
      assistantMessageWithMetadata('', persistedReasoningWaitingTranscript()),
    ]

    const store = createChatStore({
      getRun: async () => {
        runReads += 1

        if (runReads <= 2) {
          return buildRun('waiting', {
            id: asRunId('run_wait_to_done'),
            rootRunId: asRunId('run_wait_to_done'),
            threadId: asThreadId('thr_1'),
          })
        }

        messages = [
          userMessage(),
          assistantMessage('Tool approved and completed.', asRunId('run_wait_to_done')),
        ]
        return buildRun('completed', {
          id: asRunId('run_wait_to_done'),
          rootRunId: asRunId('run_wait_to_done'),
          threadId: asThreadId('thr_1'),
        })
      },
      getThread: async () => thread(),
      listThreadMessages: async () => messages,
      runReconcileDelayMs: 0,
      storage,
    })

    await store.hydrate()
    // First poll: still waiting
    expect(store.isWaiting).toBe(true)

    // Let polling advance
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runReads).toBeGreaterThanOrEqual(3)
    expect(store.isWaiting).toBe(false)
    expect(store.isStreaming).toBe(false)
    expect(store.runId).toBe(null)
    expect(store.messages.at(-1)?.text).toBe('Tool approved and completed.')
  })

  test('delegation to a failed child run surfaces an error via run.failed on the live transcript', async () => {
    const rootRunId = asRunId('run_root_fail')
    const childRunId = asRunId('run_child_fail')
    const inputId = asMessageId('msg_fail_deleg_input')
    let threadMessages = [userMessage()]

    const store = createChatStore({
      getRun: async () =>
        buildRun('failed', {
          id: rootRunId,
          rootRunId,
          threadId: asThreadId('thr_1'),
        }),
      getThread: async () => thread(),
      listThreadMessages: async () => threadMessages,
      startThreadInteraction: async () => ({
        assistantItemId: null,
        assistantMessageId: null,
        attachedFileIds: [],
        inputMessageId: inputId,
        model: 'gpt-5.4',
        outputText: '',
        provider: 'openai',
        responseId: null,
        runId: rootRunId,
        sessionId: asSessionId('ses_1'),
        status: 'waiting',
        threadId: asThreadId('thr_1'),
        usage: null,
      }),
      storage: createStorage(),
      streamThreadEvents: async ({ onEvents }) => {
        onEvents([
          runEvent(1, 'run.created', {
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            threadId: asThreadId('thr_1'),
          }),
          runEvent(2, 'run.started', {
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            status: 'running',
            threadId: asThreadId('thr_1'),
          }),
          {
            createdAt: at,
            eventNo: 3,
            id: asEventId('evt_delegate_called_fail'),
            payload: {
              args: { agentAlias: 'tony', task: 'Do something risky' },
              callId: 'call_deleg_fail',
              runId: rootRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'delegate_to_agent',
            },
            type: 'tool.called',
          },
          {
            createdAt: at,
            eventNo: 4,
            id: asEventId('evt_delegate_waiting_fail'),
            payload: {
              args: { agentAlias: 'tony', task: 'Do something risky' },
              callId: 'call_deleg_fail',
              description: 'Waiting for delegated child agent "tony"',
              runId: rootRunId,
              sessionId: asSessionId('ses_1'),
              threadId: asThreadId('thr_1'),
              tool: 'delegate_to_agent',
              waitId: 'wte_deleg_fail',
              waitTargetKind: 'run',
              waitTargetRef: 'tony:run_child_fail',
              waitTargetRunId: childRunId,
              waitType: 'agent',
            },
            type: 'tool.waiting',
          },
          runEvent(5, 'run.waiting', {
            pendingWaits: [],
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            status: 'waiting',
            threadId: asThreadId('thr_1'),
            waitIds: [],
          }),
          {
            aggregateId: String(childRunId),
            aggregateType: 'run',
            createdAt: at,
            eventNo: 6,
            id: asEventId('evt_child_error'),
            payload: {
              error: { message: 'Child agent crashed', type: 'provider_error' },
              runId: childRunId,
              sessionId: asSessionId('ses_1'),
              status: 'failed',
              threadId: asThreadId('thr_1'),
            },
            type: 'run.failed',
          } as BackendEvent,
          runEvent(7, 'run.failed', {
            error: { message: 'Delegation failed', type: 'provider_error' },
            runId: rootRunId,
            sessionId: asSessionId('ses_1'),
            status: 'failed',
            threadId: asThreadId('thr_1'),
          }),
        ])
        threadMessages = [
          userMessageWith({
            content: [{ text: 'Do something risky', type: 'text' }],
            id: inputId,
          }),
        ]
      },
    })

    await store.switchToThread(thread())
    await store.submit('Do something risky')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const assistant = store.messages.find((message) => message.role === 'assistant')
    expect(assistant?.status).toBe('error')

    const errorBlock = assistant?.blocks.find((block) => block.type === 'error')
    expect(errorBlock).toMatchObject({
      type: 'error',
      message: 'Child agent crashed',
    })

    const delegationBlock = assistant?.blocks.find(
      (block) => block.type === 'tool_interaction' && block.name === 'delegate_to_agent',
    )
    expect(delegationBlock).toMatchObject({
      childRunId: String(childRunId),
      name: 'delegate_to_agent',
      type: 'tool_interaction',
    })
  })
})
