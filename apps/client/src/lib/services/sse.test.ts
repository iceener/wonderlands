import { describe, expect, test } from 'vitest'
import { consumeSse, createReconnectingSseConsumer } from './sse'

const encoder = new TextEncoder()

const createChunkedResponse = (chunks: string[], init?: ResponseInit): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    init,
  )

describe('consumeSse', () => {
  test('parses chunked named SSE frames across arbitrary boundaries', async () => {
    const received: Array<{ data: string; event: string | null; id: string | null }> = []
    const payload =
      'id: 1\n' +
      'event: stream.delta\n' +
      'data: {"delta":"Hello"}\n\n' +
      'id: 2\n' +
      'event: run.completed\n' +
      'data: {"status":"completed"}\n\n'

    await consumeSse(
      createChunkedResponse([payload.slice(0, 17), payload.slice(17, 52), payload.slice(52)], {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      }),
      (event) => {
        received.push(event)
      },
    )

    expect(received).toEqual([
      {
        data: '{"delta":"Hello"}',
        event: 'stream.delta',
        id: '1',
      },
      {
        data: '{"status":"completed"}',
        event: 'run.completed',
        id: '2',
      },
    ])
  })

  test('extracts structured backend errors before reading the stream', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'tenant membership not found',
          type: 'permission',
        },
      }),
      {
        headers: { 'content-type': 'application/json' },
        status: 403,
      },
    )

    await expect(consumeSse(response, () => undefined)).rejects.toThrow(
      'tenant membership not found',
    )
  })

  test('ignores a trailing incomplete frame when the stream ends mid-line', async () => {
    const received: Array<{ data: string; event: string | null; id: string | null }> = []
    const payload =
      'id: 1\n' +
      'event: stream.delta\n' +
      'data: {"delta":"Hello"}\n\n' +
      'id: 2\n' +
      'event: stream.delta\n' +
      'data: {"delta":"unterminated'

    await consumeSse(
      createChunkedResponse([payload], {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      }),
      (event) => {
        received.push(event)
      },
    )

    expect(received).toEqual([
      {
        data: '{"delta":"Hello"}',
        event: 'stream.delta',
        id: '1',
      },
    ])
  })
})

describe('createReconnectingSseConsumer', () => {
  test('reconnects with the last SSE id through the request builder', async () => {
    const requests: string[] = []
    const received: string[] = []
    const reconnectStates: boolean[] = []
    let callCount = 0
    const controller = new AbortController()

    const consumer = createReconnectingSseConsumer('/v1/events/stream', {
      buildRequest(cursor) {
        return {
          url: `/v1/events/stream?cursor=${cursor ?? '0'}&threadId=thr_1`,
        }
      },
      fetch: (async (url) => {
        requests.push(String(url))
        callCount += 1

        const payload =
          callCount === 1
            ? 'id: 1\nevent: stream.delta\ndata: {"delta":"Hello"}\n\n'
            : 'id: 2\nevent: stream.delta\ndata: {"delta":" world"}\n\n' +
              'id: 3\nevent: run.completed\ndata: {"status":"completed"}\n\n'

        return createChunkedResponse([payload], {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        })
      }) as typeof fetch,
      onEvent(event) {
        received.push(`${event.id}:${event.event}`)
        if (event.event === 'run.completed') {
          controller.abort()
        }
      },
      onReconnectStateChange(isReconnecting) {
        reconnectStates.push(isReconnecting)
      },
      reconnectBaseDelayMs: 0,
      reconnectMaxDelayMs: 0,
      signal: controller.signal,
    })

    await expect(consumer.consume()).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toEqual([
      '/v1/events/stream?cursor=0&threadId=thr_1',
      '/v1/events/stream?cursor=1&threadId=thr_1',
    ])
    expect(received).toEqual(['1:stream.delta', '2:stream.delta', '3:run.completed'])
    expect(reconnectStates).toEqual([true, false])
  })

  test('does not advance the cursor when the event handler fails', async () => {
    const requests: string[] = []
    let callCount = 0
    let shouldFail = true
    const controller = new AbortController()

    const consumer = createReconnectingSseConsumer('/v1/events/stream', {
      buildRequest(cursor) {
        return {
          url: `/v1/events/stream?cursor=${cursor ?? '0'}`,
        }
      },
      fetch: (async (url) => {
        requests.push(String(url))
        callCount += 1

        const payload =
          callCount === 1
            ? 'id: 1\nevent: stream.delta\ndata: {"delta":"Hello"}\n\n' +
              'id: 2\nevent: stream.delta\ndata: {"delta":" world"}\n\n'
            : 'id: 2\nevent: stream.delta\ndata: {"delta":" world"}\n\n'

        return createChunkedResponse([payload], {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        })
      }) as typeof fetch,
      onEvent(event) {
        if (event.id === '2' && shouldFail) {
          shouldFail = false
          throw new Error('boom')
        }

        if (event.id === '2') {
          controller.abort()
        }
      },
      maxReconnectAttempts: 0,
      reconnectBaseDelayMs: 0,
      reconnectMaxDelayMs: 0,
      signal: controller.signal,
    })

    await expect(consumer.consume()).rejects.toThrow('SSE event handler failed.')
    await expect(consumer.consume()).rejects.toMatchObject({ name: 'AbortError' })

    expect(requests).toEqual(['/v1/events/stream?cursor=0', '/v1/events/stream?cursor=1'])
  })

  test('does not exhaust reconnect budget after repeated healthy EOF renewals', async () => {
    const requests: string[] = []
    let callCount = 0
    const controller = new AbortController()

    const consumer = createReconnectingSseConsumer('/v1/events/stream', {
      buildRequest(cursor) {
        return {
          url: `/v1/events/stream?cursor=${cursor ?? '0'}&threadId=thr_1`,
        }
      },
      fetch: (async (url) => {
        requests.push(String(url))
        callCount += 1

        const payload =
          callCount < 8
            ? `id: ${callCount}\nevent: progress.reported\ndata: {"stage":"renew"}\n\n`
            : 'id: 8\nevent: run.completed\ndata: {"status":"completed"}\n\n'

        return createChunkedResponse([payload], {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        })
      }) as typeof fetch,
      onEvent(event) {
        if (event.event === 'run.completed') {
          controller.abort()
        }
      },
      maxReconnectAttempts: 1,
      reconnectBaseDelayMs: 0,
      reconnectMaxDelayMs: 0,
      signal: controller.signal,
    })

    await expect(consumer.consume()).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toHaveLength(8)
    expect(requests[0]).toBe('/v1/events/stream?cursor=0&threadId=thr_1')
    expect(requests.at(-1)).toBe('/v1/events/stream?cursor=7&threadId=thr_1')
  })
})
