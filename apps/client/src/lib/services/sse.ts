import { readErrorResponseMessage } from './response-errors'

const normalizeLineEndings = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const createAbortError = (): Error =>
  Object.assign(new Error('The operation was aborted.'), {
    name: 'AbortError',
  })

export const isAbortError = (error: unknown, signal?: AbortSignal): boolean =>
  signal?.aborted === true ||
  (error instanceof Error && error.name === 'AbortError') ||
  (typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError')

const waitForDelay = async (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (delayMs <= 0) {
    return
  }

  if (signal?.aborted) {
    throw createAbortError()
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let abortListener: (() => void) | undefined

  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(resolve, delayMs)

      if (!signal) {
        return
      }

      abortListener = () => reject(createAbortError())
      signal.addEventListener('abort', abortListener, { once: true })
    })
  } finally {
    if (timer) {
      clearTimeout(timer)
    }

    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener)
    }
  }
}

export interface SseFrame {
  data: string
  event: string | null
  id: string | null
}

const parseFrame = (frame: string): SseFrame | null => {
  const lines = frame.split('\n')
  const dataLines: string[] = []
  let event: string | null = null
  let id: string | null = null

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue
    }

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    let value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    if (field === 'data') {
      dataLines.push(value)
      continue
    }

    if (field === 'event') {
      event = value || null
      continue
    }

    if (field === 'id') {
      id = value || null
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  return {
    data: dataLines.join('\n'),
    event,
    id,
  }
}

export class SseResponseError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SseResponseError'
    this.status = status
  }
}

export class SseEventHandlingError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, {
      cause: cause instanceof Error ? cause : undefined,
    })
    this.name = 'SseEventHandlingError'
  }
}

interface ConsumeSseOptions {
  signal?: AbortSignal
}

const flushFrame = async (
  frame: string,
  onEvent: (event: SseFrame) => void | Promise<void>,
): Promise<void> => {
  const parsedFrame = parseFrame(frame)
  if (!parsedFrame) {
    return
  }

  await onEvent(parsedFrame)
}

export const consumeSse = async (
  response: Response,
  onEvent: (event: SseFrame) => void | Promise<void>,
  options: ConsumeSseOptions = {},
): Promise<void> => {
  if (!response.ok) {
    throw new SseResponseError(
      response.status,
      await readErrorResponseMessage(response, `Streaming request failed with ${response.status}`),
    )
  }

  if (!response.body) {
    throw new Error('Streaming response has no body')
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  const signal = options.signal
  let buffer = ''
  let abortListener: (() => void) | undefined

  if (signal?.aborted) {
    throw createAbortError()
  }

  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        abortListener = () => {
          void reader.cancel().catch(() => undefined)
          reject(createAbortError())
        }

        signal.addEventListener('abort', abortListener, { once: true })
      })
    : null

  try {
    while (true) {
      const { done, value } = abortPromise
        ? await Promise.race([reader.read(), abortPromise])
        : await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      buffer = normalizeLineEndings(buffer)

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        await flushFrame(frame, onEvent)
        boundary = buffer.indexOf('\n\n')
      }
    }

    buffer += decoder.decode()
    buffer = normalizeLineEndings(buffer)

    // Only flush the trailing frame at EOF when the stream ended on a line boundary.
    // If the connection drops mid-line, the leftover bytes are an incomplete SSE frame.
    const remaining = buffer.trimEnd()
    if (remaining && /(?:^|\n)(?:data|event|id|retry):/.test(remaining) && buffer.endsWith('\n')) {
      await flushFrame(remaining, onEvent)
    }
  } finally {
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener)
    }
  }
}

const shouldRetryReconnect = (error: unknown): boolean => {
  if (error instanceof SseResponseError) {
    return error.status === 408 || error.status === 429 || error.status >= 500
  }

  if (error instanceof SseEventHandlingError) {
    return false
  }

  if (error instanceof Error && error.message === 'Streaming response has no body') {
    return false
  }

  return true
}

const forwardAbortSignal = (
  source: AbortSignal | undefined,
  controller: AbortController,
): (() => void) => {
  if (!source) {
    return () => undefined
  }

  if (source.aborted) {
    controller.abort(source.reason)
    return () => undefined
  }

  const abortListener = () => {
    controller.abort(source.reason)
  }

  source.addEventListener('abort', abortListener, { once: true })

  return () => {
    source.removeEventListener('abort', abortListener)
  }
}

interface SseRequestDescriptor {
  init?: RequestInit
  url: string
}

export interface ReconnectingSseConsumerOptions {
  buildRequest?: (cursor: string | null) => SseRequestDescriptor
  fetch?: typeof fetch
  init?: RequestInit
  maxReconnectAttempts?: number
  onEvent: (event: SseFrame) => void | Promise<void>
  onReconnectStateChange?: (isReconnecting: boolean) => void | Promise<void>
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
  signal?: AbortSignal
}

export interface ReconnectingSseConsumer {
  consume(): Promise<void>
}

export const createReconnectingSseConsumer = (
  url: string,
  options: ReconnectingSseConsumerOptions,
): ReconnectingSseConsumer => {
  const fetchImpl = options.fetch ?? fetch
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 6
  const reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 250
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 2_000
  const signal = options.signal
  let reconnecting = false
  let lastEventId: string | null = null

  const setReconnecting = async (next: boolean) => {
    if (reconnecting === next) {
      return
    }

    reconnecting = next
    await options.onReconnectStateChange?.(next)
  }

  const resolveRequest = (cursor: string | null): SseRequestDescriptor =>
    options.buildRequest?.(cursor) ?? {
      init: options.init,
      url,
    }

  return {
    async consume() {
      let reconnectAttempt = 0

      while (true) {
        if (signal?.aborted) {
          throw createAbortError()
        }

        const controller = new AbortController()
        const detachAbort = forwardAbortSignal(signal, controller)
        const request = resolveRequest(lastEventId)

        try {
          const response = await fetchImpl(request.url, {
            ...request.init,
            signal: controller.signal,
          })

          await setReconnecting(false)

          await consumeSse(
            response,
            async (event) => {
              try {
                await options.onEvent(event)
              } catch (error) {
                throw new SseEventHandlingError('SSE event handler failed.', error)
              }

              if (event.id) {
                lastEventId = event.id
              }
            },
            { signal: controller.signal },
          )

          if (signal?.aborted) {
            throw createAbortError()
          }

          reconnectAttempt = 0
          await setReconnecting(true)
          const delayMs = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs)
          await waitForDelay(delayMs, signal)
        } catch (error) {
          if (isAbortError(error, signal)) {
            throw error
          }

          if (!shouldRetryReconnect(error)) {
            throw error
          }

          reconnectAttempt += 1
          if (reconnectAttempt > maxReconnectAttempts) {
            throw error
          }
          await setReconnecting(true)
          const delayMs = Math.min(
            reconnectMaxDelayMs,
            reconnectBaseDelayMs * 2 ** (reconnectAttempt - 1),
          )
          await waitForDelay(delayMs, signal)
        } finally {
          detachAbort()
        }
      }
    },
  }
}
