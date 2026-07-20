import {
  asMessageId,
  asRunId,
  asSessionId,
  asThreadId,
  type BackendEvent,
  type BootstrapSessionOutput,
  type ResumeRunOutput,
  type StartThreadInteractionOutput,
} from '@wonderlands/contracts/chat'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  bootstrapSession,
  cancelRun,
  replayRunEvents,
  resumeRun,
  startThreadInteraction,
  streamTenantEvents,
  streamThreadEvents,
} from './api'
import { setApiTenantId } from './backend'

const originalFetch = globalThis.fetch
const encoder = new TextEncoder()

const createPendingSseResponse = (): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(''))
      },
    }),
    {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    },
  )

beforeEach(() => {
  setApiTenantId('ten_overment')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  setApiTenantId(null)
})

describe('api service interaction boundaries', () => {
  test('bootstraps a session through the backend envelope contract', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody: BootstrapSessionOutput = {
      assistantItemId: 'itm_bootstrap',
      assistantMessageId: asMessageId('msg_assistant_bootstrap'),
      inputMessageId: asMessageId('msg_bootstrap'),
      model: 'gpt-5.4',
      outputText: 'Plan the first backend milestone.',
      provider: 'openai',
      responseId: 'resp_bootstrap',
      runId: asRunId('run_bootstrap'),
      sessionId: asSessionId('ses_bootstrap'),
      status: 'completed',
      threadId: asThreadId('thr_bootstrap'),
      usage: null,
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_1', traceId: 'trace_1' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      bootstrapSession({
        initialMessage: 'Plan the first backend milestone',
        title: 'Milestone planning',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('/api/sessions/bootstrap')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        initialMessage: 'Plan the first backend milestone',
        title: 'Milestone planning',
        execute: true,
      }),
    })
    expect(new Headers(requests[0]?.init?.headers).get('content-type')).toBe('application/json')
    expect(new Headers(requests[0]?.init?.headers).get('x-tenant-id')).toBe('ten_overment')
  })

  test('starts a thread interaction with backend-native request fields', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody: StartThreadInteractionOutput = {
      assistantItemId: 'itm_1',
      assistantMessageId: asMessageId('msg_assistant'),
      attachedFileIds: [],
      inputMessageId: asMessageId('msg_input'),
      model: 'gpt-5.4',
      outputText: 'Start with SSE replay.',
      provider: 'openai',
      responseId: 'resp_1',
      runId: asRunId('run_1'),
      sessionId: asSessionId('ses_1'),
      status: 'completed',
      threadId: asThreadId('thr_1'),
      usage: null,
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_3', traceId: 'trace_3' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      startThreadInteraction(asThreadId('thr_1'), {
        fileIds: ['fil_1'],
        model: 'gpt-5.4',
        reasoning: {
          effort: 'high',
        },
        text: 'What should we wire next?',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests[0]?.url).toBe('/api/threads/thr_1/interactions')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        fileIds: ['fil_1'],
        model: 'gpt-5.4',
        reasoning: {
          effort: 'high',
        },
        text: 'What should we wire next?',
      }),
    })
  })

  test.each([
    {
      expectedThreadId: 'thr_live',
      scope: 'thread',
      stream: (signal: AbortSignal) =>
        streamThreadEvents({
          onEvents: () => undefined,
          signal,
          threadId: asThreadId('thr_live'),
        }),
    },
    {
      expectedThreadId: null,
      scope: 'tenant',
      stream: (signal: AbortSignal) =>
        streamTenantEvents({
          onEvents: () => undefined,
          signal,
        }),
    },
  ])('streams $scope events with an all-category follow subscription', async (scenario) => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const controller = new AbortController()

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return createPendingSseResponse()
    }) as typeof fetch

    setTimeout(() => {
      controller.abort()
    }, 0)

    await expect(scenario.stream(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(requests.length).toBeGreaterThan(0)

    const url = new URL(requests[0]!.url, 'http://localhost')

    expect(url.pathname).toBe('/api/events/stream')
    expect(url.searchParams.get('category')).toBe('all')
    expect(url.searchParams.get('follow')).toBe('true')
    expect(url.searchParams.get('threadId')).toBe(scenario.expectedThreadId)
    expect(url.searchParams.get('cursor')).toBe('0')
    expect(requests[0]?.init?.credentials).toBe('include')
    expect(requests[0]?.init?.method).toBe('GET')
  })

  test('replays run events with a non-follow run-scoped request', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const seenEvents: BackendEvent[] = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'id: 5\n' +
                  'event: run.started\n' +
                  `data: ${JSON.stringify({
                    aggregateId: 'run_bootstrap',
                    aggregateType: 'run',
                    createdAt: '2026-03-29T12:00:00.000Z',
                    eventNo: 5,
                    id: 'evt_bootstrap_started',
                    payload: {
                      rootRunId: 'run_bootstrap',
                      runId: 'run_bootstrap',
                      sessionId: 'ses_bootstrap',
                      threadId: 'thr_bootstrap',
                    },
                    type: 'run.started',
                  })}\n\n`,
              ),
            )
            controller.close()
          },
        }),
        {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        },
      )
    }) as typeof fetch

    await replayRunEvents({
      onEvents: (events) => {
        seenEvents.push(...events)
      },
      runId: asRunId('run_bootstrap'),
    })

    expect(seenEvents).toHaveLength(1)

    const url = new URL(requests[0]!.url, 'http://localhost')

    expect(url.pathname).toBe('/api/events/stream')
    expect(url.searchParams.get('category')).toBe('all')
    expect(url.searchParams.get('follow')).toBe('false')
    expect(url.searchParams.get('runId')).toBe('run_bootstrap')
    expect(url.searchParams.get('cursor')).toBe('0')
    expect(url.searchParams.get('threadId')).toBeNull()
    expect(requests[0]?.init?.credentials).toBe('include')
    expect(requests[0]?.init?.method).toBe('GET')
  })

  test('resumes a waiting run with an explicit wait resolution payload', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody: ResumeRunOutput = {
      runId: asRunId('run_waiting'),
      status: 'accepted',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_resume', traceId: 'trace_resume' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(
      resumeRun(asRunId('run_waiting'), {
        approve: true,
        rememberApproval: false,
        waitId: 'wte_1',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests[0]?.url).toBe('/api/runs/run_waiting/resume')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        approve: true,
        rememberApproval: false,
        waitId: 'wte_1',
      }),
    })
  })

  test('cancels a run by backend run id', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: { runId: asRunId('run_waiting'), status: 'cancelled' },
          meta: { requestId: 'req_4', traceId: 'trace_4' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(cancelRun(asRunId('run_waiting'))).resolves.toEqual({
      runId: asRunId('run_waiting'),
      status: 'cancelled',
    })

    expect(requests[0]?.url).toBe('/api/runs/run_waiting/cancel')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: '{}',
    })
  })
})
