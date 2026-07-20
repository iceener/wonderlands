import {
  asEventId,
  asMessageId,
  asRunId,
  asSessionId,
  asThreadId,
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
import { materializeBlocks } from '../runtime/materialize'
import { setApiTenantId } from '../services/backend'

const at = '2026-03-29T12:00:00.000Z'
const STORAGE_KEY = '05_04_ui.active-thread'
const _storageKeyForTenant = (tenantId: string): string => `${STORAGE_KEY}:${tenantId}`

import { createChatStore } from './chat-store.svelte.ts'

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

const _assistantMessageWithMetadata = (
  text: string,
  metadata: unknown,
  runId = asRunId('run_1'),
): BackendThreadMessage => ({
  ...assistantMessage(text, runId),
  metadata,
})

const _persistedToolTranscript = (remembered: boolean | null = false) => ({
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

const _persistedReasoningWaitingTranscript = () => ({
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
})
