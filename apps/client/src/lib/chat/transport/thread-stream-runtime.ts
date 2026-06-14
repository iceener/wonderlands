import type { BackendEvent, ThreadId } from '@wonderlands/contracts/chat'

interface ThreadStreamRuntimeDependencies<Lease> {
  bumpStreamPulse: () => void
  captureViewLease: () => Lease
  clearCompletedResponseSettle: () => void
  getEventCursor: () => number
  ingestEvent: (event: BackendEvent) => boolean
  setIsReconnecting: (value: boolean) => void
  threadLeaseCurrent: (lease: Lease, threadId: ThreadId) => boolean
  threadStreamController: {
    clear: (expectedPromise?: Promise<void> | null) => void
    connect: (input: {
      cursor: number
      lease: Lease
      onEvents: (events: BackendEvent[], abort: () => void) => void
      onReconnectStateChange: (isReconnecting: boolean) => void
      threadId: ThreadId
      threadLeaseCurrent: (lease: Lease, threadId: ThreadId) => boolean
    }) => Promise<void>
    ensure: (input: {
      cursor: number
      lease: Lease
      onEvents: (events: BackendEvent[], abort: () => void) => void
      onReconnectStateChange: (isReconnecting: boolean) => void
      threadId: ThreadId
      threadLeaseCurrent: (lease: Lease, threadId: ThreadId) => boolean
    }) => Promise<void>
    stop: () => Promise<void>
  }
}

export const createThreadStreamRuntime = <Lease>({
  bumpStreamPulse,
  captureViewLease,
  clearCompletedResponseSettle,
  getEventCursor,
  ingestEvent,
  setIsReconnecting,
  threadLeaseCurrent,
  threadStreamController,
}: ThreadStreamRuntimeDependencies<Lease>) => {
  const handleThreadStreamEvents = (events: readonly BackendEvent[], abort: () => void) => {
    let shouldStop = false
    for (const event of events) {
      shouldStop = ingestEvent(event) || shouldStop
      if (shouldStop) {
        break
      }
    }

    if (shouldStop) {
      abort()
    }
  }

  const handleThreadReconnectStateChange = (isReconnecting: boolean) => {
    setIsReconnecting(isReconnecting)
    bumpStreamPulse()
  }

  const connectThreadEventStream = (threadId: ThreadId, lease: Lease = captureViewLease()) => {
    return threadStreamController.connect({
      cursor: getEventCursor(),
      lease,
      onEvents: handleThreadStreamEvents,
      onReconnectStateChange: handleThreadReconnectStateChange,
      threadId,
      threadLeaseCurrent,
    })
  }

  const ensureThreadEventStream = (threadId: ThreadId, lease: Lease = captureViewLease()) => {
    return threadStreamController.ensure({
      cursor: getEventCursor(),
      lease,
      onEvents: handleThreadStreamEvents,
      onReconnectStateChange: handleThreadReconnectStateChange,
      threadId,
      threadLeaseCurrent,
    })
  }

  const clearActiveTransport = (expectedPromise?: Promise<void> | null) => {
    clearCompletedResponseSettle()
    threadStreamController.clear(expectedPromise)
  }

  const stopActiveStream = async (): Promise<void> => {
    clearCompletedResponseSettle()
    await threadStreamController.stop()
  }

  return {
    clearActiveTransport,
    connectThreadEventStream,
    ensureThreadEventStream,
    stopActiveStream,
  }
}
