import type {
  BackendEvent,
  BackendRun,
  MessageId,
  RunId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { asMessageId, asRunId } from '@wonderlands/contracts/chat'
import type { RunLease, ViewLease } from './leases'

export interface ActiveRunReplayGuard {
  floorCreatedAt: string
  runId: RunId
}

const REPLAY_GUARD_SETTLEMENT_TOLERANCE_MS = 5_000

const replayGuardGraceEventTypes = new Set<BackendEvent['type']>([
  'tool.completed',
  'tool.confirmation_granted',
  'tool.confirmation_rejected',
  'tool.confirmation_requested',
  'tool.failed',
  'tool.waiting',
  'web_search.progress',
])

const isPrivateChildRun = (run: BackendRun): boolean =>
  run.threadId == null && run.rootRunId !== run.id

interface RunBootstrapDependencies {
  clearPendingWaits: () => void
  eventRunId: (event: BackendEvent) => RunId | null
  getRun: (runId: RunId) => Promise<BackendRun>
  getThreadId: () => ThreadId | null
  getThreadLeaseCurrent: (lease: ViewLease, threadId: ThreadId | null) => boolean
  getRunLeaseCurrent: (lease: RunLease) => boolean
  ingestEvent: (event: BackendEvent, options?: { updateCursor?: boolean }) => boolean
  isAbortError: (error: unknown, signal?: AbortSignal | null) => boolean
  isTerminalRunStatus: (
    status: BackendRun['status'] | null,
  ) => status is 'completed' | 'failed' | 'cancelled'
  replayRunEvents: (input: {
    onEvents: (events: BackendEvent[]) => void
    runId: RunId
    signal?: AbortSignal
  }) => Promise<void>
  rememberRunTranscriptFromMessage: (
    message: {
      attachments: []
      blocks: []
      createdAt: string
      finishReason: null
      id: MessageId
      role: 'assistant'
      runId: RunId
      sequence: null
      status: 'streaming'
      text: ''
      uiKey: MessageId
    },
    source: 'liveStream',
  ) => void
  resolveKnownChildRunIds: () => Set<string>
  setThreadEventCursor: (threadId: ThreadId | null, eventCursor: number) => void
  syncLiveAssistantProjectionFromTranscript: (
    runId: RunId,
    createdAt: string,
    input: { preferredId?: MessageId },
  ) => unknown
  syncProjectedMessages: (options?: { pulse?: boolean }) => void
  persistState: () => void
  getLiveAssistantMessageId: (runId: RunId) => MessageId | null
}

export const createRunBootstrapCoordinator = ({
  clearPendingWaits,
  eventRunId,
  getRun,
  getThreadId,
  getThreadLeaseCurrent,
  getRunLeaseCurrent,
  ingestEvent,
  isAbortError,
  isTerminalRunStatus,
  replayRunEvents,
  rememberRunTranscriptFromMessage,
  resolveKnownChildRunIds,
  setThreadEventCursor,
  syncLiveAssistantProjectionFromTranscript,
  syncProjectedMessages,
  persistState,
  getLiveAssistantMessageId,
}: RunBootstrapDependencies) => {
  let activeRunReplayGuard: ActiveRunReplayGuard | null = null

  const clearRunReplayGuard = (runId: RunId | null = null) => {
    if (!activeRunReplayGuard) {
      return
    }

    if (runId == null || activeRunReplayGuard.runId === runId) {
      activeRunReplayGuard = null
    }
  }

  const primeRunReplayGuardFromSnapshot = (run: BackendRun) => {
    if (isTerminalRunStatus(run.status)) {
      clearRunReplayGuard(run.id)
      return
    }

    activeRunReplayGuard = {
      floorCreatedAt: run.updatedAt,
      runId: run.id,
    }
  }

  const shouldIgnoreReplayGuardedRunEvent = (event: BackendEvent): boolean => {
    const runId = eventRunId(event)
    if (!runId || activeRunReplayGuard?.runId !== runId) {
      return false
    }

    const floorCreatedAtMs = Date.parse(activeRunReplayGuard.floorCreatedAt)
    const eventCreatedAtMs = Date.parse(event.createdAt)

    if (Number.isNaN(floorCreatedAtMs) || Number.isNaN(eventCreatedAtMs)) {
      return event.createdAt < activeRunReplayGuard.floorCreatedAt
    }

    if (eventCreatedAtMs >= floorCreatedAtMs) {
      return false
    }

    if (!replayGuardGraceEventTypes.has(event.type)) {
      return true
    }

    return floorCreatedAtMs - eventCreatedAtMs > REPLAY_GUARD_SETTLEMENT_TOLERANCE_MS
  }

  const resolveHydratedRun = async (
    run: BackendRun,
    threadId: ThreadId | null = getThreadId(),
    viewLease?: ViewLease,
  ): Promise<BackendRun> => {
    if (!threadId || !viewLease || !isPrivateChildRun(run)) {
      return run
    }

    try {
      const rootRun = await getRun(run.rootRunId)
      if (!getThreadLeaseCurrent(viewLease, threadId)) {
        return run
      }

      if (rootRun.threadId === threadId) {
        return rootRun
      }
    } catch {
      // Fall back to the stored run if the root run cannot be loaded.
    }

    return run
  }

  const prepareLiveAssistantForBackendBootstrap = (run: BackendRun): void => {
    clearRunReplayGuard(run.id)
    clearPendingWaits()
    const liveMessageId = getLiveAssistantMessageId(run.id) ?? asMessageId(`live:${String(run.id)}`)

    rememberRunTranscriptFromMessage(
      {
        attachments: [],
        blocks: [],
        createdAt: run.updatedAt,
        finishReason: null,
        id: liveMessageId,
        role: 'assistant',
        runId: run.id,
        sequence: null,
        status: 'streaming',
        text: '',
        uiKey: liveMessageId,
      },
      'liveStream',
    )
    syncLiveAssistantProjectionFromTranscript(run.id, run.updatedAt, {
      preferredId: liveMessageId,
    })

    setThreadEventCursor(run.threadId ?? getThreadId(), 0)
    syncProjectedMessages({ pulse: true })
    persistState()
  }

  const bootstrapActiveRunTranscriptFromBackend = async (
    run: BackendRun,
    lease: ViewLease,
    runLease: RunLease,
  ): Promise<void> => {
    if (
      !run.threadId ||
      (run.status !== 'running' && run.status !== 'pending') ||
      !getThreadLeaseCurrent(lease, run.threadId) ||
      !getRunLeaseCurrent(runLease)
    ) {
      return
    }

    prepareLiveAssistantForBackendBootstrap(run)

    const replayController = new AbortController()
    const replayedRunIds = new Set<string>()
    let maxBootstrappedEventNo = 0

    const isBootstrapLeaseCurrent = (): boolean =>
      getThreadLeaseCurrent(lease, run.threadId) && getRunLeaseCurrent(runLease)

    const replaySingleRun = async (targetRunId: RunId): Promise<void> => {
      if (replayedRunIds.has(targetRunId)) {
        return
      }

      replayedRunIds.add(targetRunId)

      await replayRunEvents({
        onEvents: (events) => {
          if (!isBootstrapLeaseCurrent()) {
            replayController.abort()
            return
          }

          for (const event of events) {
            maxBootstrappedEventNo = Math.max(maxBootstrappedEventNo, event.eventNo)
            ingestEvent(event, { updateCursor: false })
          }
        },
        runId: targetRunId,
        signal: replayController.signal,
      })
    }

    try {
      await replaySingleRun(run.id)

      while (isBootstrapLeaseCurrent()) {
        const nextChildRunId = Array.from(resolveKnownChildRunIds()).find(
          (childRunId) => !replayedRunIds.has(childRunId),
        )

        if (!nextChildRunId) {
          break
        }

        await replaySingleRun(asRunId(nextChildRunId))
      }
    } catch (error) {
      if (isAbortError(error, replayController.signal) && !isBootstrapLeaseCurrent()) {
        return
      }

      throw error
    }

    if (!isBootstrapLeaseCurrent()) {
      return
    }

    setThreadEventCursor(run.threadId, maxBootstrappedEventNo)
    persistState()
  }

  return {
    bootstrapActiveRunTranscriptFromBackend,
    clearRunReplayGuard,
    get activeRunReplayGuard(): ActiveRunReplayGuard | null {
      return activeRunReplayGuard
    },
    prepareLiveAssistantForBackendBootstrap,
    primeRunReplayGuardFromSnapshot,
    resolveHydratedRun,
    shouldIgnoreReplayGuardedRunEvent,
  }
}
