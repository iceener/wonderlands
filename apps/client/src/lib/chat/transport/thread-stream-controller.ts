import type { BackendEvent, ThreadId } from '@wonderlands/contracts/chat'

export interface ActiveThreadStreamContext {
  epoch: number
  threadId: ThreadId
}

interface ThreadStreamControllerDependencies<Lease> {
  isAbortError: (error: unknown, signal?: AbortSignal) => boolean
  streamThreadEvents: (input: {
    cursor?: number
    onEvents: (events: BackendEvent[]) => void
    onReconnectStateChange?: (isReconnecting: boolean) => void
    signal?: AbortSignal
    threadId: ThreadId
  }) => Promise<void>
}

interface ConnectThreadStreamOptions<Lease> {
  cursor: number
  lease: Lease
  onEvents: (events: BackendEvent[], abort: () => void) => void
  onReconnectStateChange: (isReconnecting: boolean) => void
  threadId: ThreadId
  threadLeaseCurrent: (lease: Lease, threadId: ThreadId) => boolean
}

export const createThreadStreamController = <Lease>({
  isAbortError,
  streamThreadEvents,
}: ThreadStreamControllerDependencies<Lease>) => {
  let activeAbortController: AbortController | null = null
  let activePromise: Promise<void> | null = null
  let activeContext: ActiveThreadStreamContext | null = null

  const clear = (expectedPromise?: Promise<void> | null) => {
    if (expectedPromise !== undefined && activePromise !== expectedPromise) {
      return
    }

    activeAbortController = null
    activePromise = null
    activeContext = null
  }

  const abort = () => {
    activeAbortController?.abort()
  }

  const stop = async (): Promise<void> => {
    const controller = activeAbortController
    const streamPromise = activePromise
    clear(streamPromise)
    controller?.abort()
    await streamPromise?.catch(() => undefined)
  }

  const connect = ({
    cursor,
    lease,
    onEvents,
    onReconnectStateChange,
    threadId,
    threadLeaseCurrent,
  }: ConnectThreadStreamOptions<Lease>): Promise<void> => {
    if (!threadLeaseCurrent(lease, threadId)) {
      return Promise.resolve()
    }

    if (
      activePromise &&
      (activeContext?.threadId !== threadId ||
        activeContext?.epoch !== (lease as { epoch: number }).epoch)
    ) {
      activeAbortController?.abort()
    }

    const controller = new AbortController()
    let streamPromise: Promise<void> | null = null
    activeAbortController = controller
    activeContext = {
      epoch: (lease as { epoch: number }).epoch,
      threadId,
    }

    streamPromise = streamThreadEvents({
      cursor,
      signal: controller.signal,
      threadId,
      onReconnectStateChange(isReconnecting) {
        if (!threadLeaseCurrent(lease, threadId)) {
          return
        }

        onReconnectStateChange(isReconnecting)
      },
      onEvents(events) {
        if (!threadLeaseCurrent(lease, threadId)) {
          controller.abort()
          return
        }

        onEvents(events, () => controller.abort())
      },
    })
      .catch((error) => {
        if (!isAbortError(error)) {
          throw error
        }
      })
      .finally(() => {
        if (activePromise === streamPromise) {
          clear(streamPromise)
        }
      })

    activePromise = streamPromise
    return streamPromise
  }

  const ensure = (options: ConnectThreadStreamOptions<Lease>): Promise<void> => {
    if (
      activePromise &&
      activeContext?.threadId === options.threadId &&
      activeContext?.epoch === (options.lease as { epoch: number }).epoch
    ) {
      return activePromise
    }

    return connect(options)
  }

  return {
    abort,
    clear,
    connect,
    ensure,
    get context(): ActiveThreadStreamContext | null {
      return activeContext
    },
    hasActiveStream(): boolean {
      return activeAbortController != null && activePromise != null
    },
    isCurrentAbortError(error: unknown): boolean {
      return isAbortError(error, activeAbortController?.signal)
    },
    get promise(): Promise<void> | null {
      return activePromise
    },
    stop,
  }
}
