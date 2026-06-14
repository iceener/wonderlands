import type { BackendEvent, RunId, ThreadId } from '@wonderlands/contracts/chat'
import { apiFetch, createApiHeaders, toApiUrl } from '../backend'
import { consumeSse, createReconnectingSseConsumer } from '../sse'
import { parseBackendEvent } from './shared'

interface ReplayRunEventsOptions {
  onEvents: (events: BackendEvent[]) => void
  signal?: AbortSignal
  runId: RunId
}

interface StreamThreadEventsOptions {
  cursor?: number
  onEvents: (events: BackendEvent[]) => void
  onReconnectStateChange?: (isReconnecting: boolean) => void
  signal?: AbortSignal
  threadId: ThreadId
}

interface StreamTenantEventsOptions {
  cursor?: number
  onEvents: (events: BackendEvent[]) => void
  onReconnectStateChange?: (isReconnecting: boolean) => void
  signal?: AbortSignal
}

const buildEventsStreamUrl = (
  origin: string,
  input: {
    cursor: number | string
    follow: boolean
    runId?: string
    threadId?: ThreadId
  },
): URL => {
  const url = new URL(toApiUrl('/events/stream'), origin)
  url.searchParams.set('category', 'all')
  url.searchParams.set('follow', input.follow ? 'true' : 'false')
  url.searchParams.set('cursor', String(input.cursor))

  if (input.runId) {
    url.searchParams.set('runId', input.runId)
  }

  if (input.threadId) {
    url.searchParams.set('threadId', input.threadId)
  }

  return url
}

const parseAndDispatchEvent = (
  eventData: string,
  onEvents: (events: BackendEvent[]) => void,
): void => {
  onEvents([parseBackendEvent(JSON.parse(eventData))])
}

export const replayRunEvents = async ({
  onEvents,
  signal,
  runId,
}: ReplayRunEventsOptions): Promise<void> => {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const url = buildEventsStreamUrl(origin, {
    cursor: 0,
    follow: false,
    runId,
  })

  const response = await apiFetch(url.toString(), {
    headers: createApiHeaders(),
    method: 'GET',
    signal,
  })

  await consumeSse(
    response,
    (event) => {
      parseAndDispatchEvent(event.data, onEvents)
    },
    { signal },
  )
}

export const streamThreadEvents = async ({
  cursor = 0,
  onEvents,
  onReconnectStateChange,
  signal,
  threadId,
}: StreamThreadEventsOptions): Promise<void> => {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin

  const consumer = createReconnectingSseConsumer(toApiUrl('/events/stream'), {
    buildRequest(nextCursor) {
      const url = buildEventsStreamUrl(origin, {
        cursor: nextCursor ?? cursor,
        follow: true,
        threadId,
      })

      return {
        init: {
          headers: createApiHeaders(),
          method: 'GET',
        },
        url: url.toString(),
      }
    },
    fetch: apiFetch,
    onEvent(event) {
      parseAndDispatchEvent(event.data, onEvents)
    },
    onReconnectStateChange,
    signal,
  })

  await consumer.consume()
}

export const streamTenantEvents = async ({
  cursor = 0,
  onEvents,
  onReconnectStateChange,
  signal,
}: StreamTenantEventsOptions): Promise<void> => {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin

  const consumer = createReconnectingSseConsumer(toApiUrl('/events/stream'), {
    buildRequest(nextCursor) {
      const url = buildEventsStreamUrl(origin, {
        cursor: nextCursor ?? cursor,
        follow: true,
      })

      return {
        init: {
          headers: createApiHeaders(),
          method: 'GET',
        },
        url: url.toString(),
      }
    },
    fetch: apiFetch,
    onEvent(event) {
      parseAndDispatchEvent(event.data, onEvents)
    },
    onReconnectStateChange,
    signal,
  })

  await consumer.consume()
}
