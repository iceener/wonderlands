import type {
  BackendEvent,
  BackendPendingWait,
  Block,
  MessageId,
  RunId,
  SessionId,
  ThreadId,
  ToolInteractionBlock,
} from '@wonderlands/contracts/chat'
import {
  asEventId,
  asMessageId,
  asRunId,
  asSessionId,
  asThreadId,
} from '@wonderlands/contracts/chat'
import type { ContextBudget, RunTranscriptState, UiMessage } from '../types'

interface PendingOptimisticOwnerSnapshot {
  viewEpoch: number
}

interface EventEngineDependencies {
  applyEvent: (blocks: Block[], event: BackendEvent, toolIndex: Map<string, number>) => void
  applyRunExecutionOutput: (
    output: { pendingWaits?: BackendPendingWait[]; runId: RunId; status: 'completed' | 'waiting' },
    options?: { settleDelayMs?: number },
  ) => void
  applyThreadTitle: (thread: { title: string | null }) => void
  bindActiveRun: (runId: RunId) => void
  captureViewLease: () => { epoch: number }
  clearPendingWaits: () => void
  clearTranscriptTextBlocksForLiveResume: (runId: RunId) => void
  durableHasAssistantForRun: (runId: RunId | null) => boolean
  ensureLiveAssistantMessage: (createdAt: string, expectedRunId?: RunId | null) => UiMessage
  ensureRunTranscript: (
    runId: RunId,
    createdAt: string,
    options: { preferredMessageId?: MessageId; source: 'liveStream' },
  ) => RunTranscriptState
  eventCursor: () => number
  extractEventErrorMessage: (error: unknown, fallback: string) => string
  finalizeRun: (
    status: 'waiting' | 'failed' | 'cancelled' | 'completed',
    finishReason: UiMessage['finishReason'],
    options?: { runId?: RunId | null },
  ) => void
  getContextBudget: () => ContextBudget | null
  getDurableMessages: () => UiMessage[]
  getIsStreaming: () => boolean
  getLiveAssistantMessage: () => UiMessage | null
  getPendingOptimisticMessageId: () => MessageId | null
  getPendingOptimisticOwner: () => PendingOptimisticOwnerSnapshot | null
  getPendingWaits: () => BackendPendingWait[]
  getRetainedAssistantMessages: () => UiMessage[]
  getRunId: () => RunId | null
  getRunStatus: () =>
    | 'pending'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | null
  getThreadId: () => ThreadId | null
  getViewEpoch: () => number
  humanizeErrorMessage: (message: string) => string
  isTerminalRunStatus: (
    status: ReturnType<EventEngineDependencies['getRunStatus']>,
  ) => status is 'completed' | 'failed' | 'cancelled'
  isViewLeaseCurrent: (lease: { epoch: number }) => boolean
  liveAssistantHasBlocksForRun: (runId: RunId | null) => boolean
  logDebug: (scope: string, event: string, payload: unknown) => void
  nowIso: () => string
  parseUsage: (value: Record<string, unknown> | null | undefined) => {
    cachedTokens: number | null
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    totalTokens: number | null
  } | null
  persistState: () => void
  projectAssistantMessageFromRunTranscript: (message: UiMessage) => UiMessage
  refreshThreadMessages: (threadId: ThreadId | null, lease?: { epoch: number }) => Promise<void>
  rememberRunTranscriptFromMessage: (message: UiMessage, source: 'liveStream') => void
  replaceMessageId: (currentId: MessageId, nextId: MessageId) => void
  resolveStableUiKey: (message: Pick<UiMessage, 'id' | 'uiKey'>) => string
  resolveTranscriptProjectionMessageId: (runId: RunId) => MessageId
  scheduleRunReconciliation: (runId: RunId) => void
  setContextBudget: (budget: ContextBudget | null) => void
  setError: (message: string | null) => void
  setEventCursor: (cursor: number) => void
  setIsResolvingWait: (value: boolean) => void
  setIsStreaming: (value: boolean) => void
  setIsThreadNaming: (value: boolean) => void
  setIsWaiting: (value: boolean) => void
  setMemoryActivity: (value: 'idle' | 'observing' | 'reflecting') => void
  setRunStatus: (
    status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled',
  ) => void
  setSessionId: (sessionId: SessionId) => void
  setStreamPulse: () => void
  setThreadId: (threadId: ThreadId) => void
  shouldIgnoreReplayGuardedRunEvent: (event: BackendEvent) => boolean
  syncLiveAssistantProjectionFromTranscript: (
    runId: RunId,
    createdAt: string,
    options?: { preferredId?: MessageId },
  ) => UiMessage | null
  syncProjectedMessages: (options?: { pulse?: boolean }) => void
  syncSandboxAttachmentsFromLiveMessage: (
    message: UiMessage,
    options?: { force?: boolean; reveal?: boolean },
  ) => void
  syncSandboxAttachmentsFromTranscript: (
    transcript: RunTranscriptState,
    options?: { force?: boolean; reveal?: boolean },
  ) => void
  threadMessageRefreshError: (error: unknown) => string
  toolIndexByMessageId: Map<string, Map<string, number>>
  typewriterMarkStreamed: (key: string) => void
  updateLiveAssistantMessage: (updater: (message: UiMessage) => void) => void
  mergePendingWaitsForRun: (
    waits: BackendPendingWait[],
    ownerRunId?: RunId | string | null,
  ) => BackendPendingWait[]
  reconcileFailedRunState: (runId: RunId | null) => void
  removePendingWaitByCallId: (callId: string) => void
  removePendingWaitByWaitId: (waitId: string) => void
  setPendingWaits: (waits: BackendPendingWait[], ownerRunId?: RunId | string | null) => void
  syncPendingWaitBlocks: (createdAt?: string) => void
  upsertPendingWait: (wait: BackendPendingWait) => void
  withEstimatedOutputDelta: (budget: ContextBudget | null, delta: string) => ContextBudget | null
  withReconciledUsage: (
    budget: ContextBudget | null,
    usage: ReturnType<EventEngineDependencies['parseUsage']>,
    measuredAt: string,
    model: string | null,
    provider: string | null,
    fallbackOutputText: string,
  ) => ContextBudget | null
  withStreamingBudgetStart: (
    budget: ContextBudget | null,
    input: {
      estimatedInputTokens: number
      reservedOutputTokens: number | null
      stablePrefixTokens: number | null
      turn: number | null
      volatileSuffixTokens: number | null
    },
  ) => ContextBudget
}

const eventRunId = (event: BackendEvent): RunId | null => {
  if (!('runId' in event.payload) || typeof event.payload.runId !== 'string') {
    return null
  }

  return asRunId(event.payload.runId)
}

const eventThreadId = (event: BackendEvent): ThreadId | null => {
  if (!('threadId' in event.payload) || typeof event.payload.threadId !== 'string') {
    return null
  }

  return asThreadId(event.payload.threadId)
}

const isChildTranscriptEvent = (event: BackendEvent): boolean => {
  switch (event.type) {
    case 'generation.completed':
    case 'reasoning.summary.delta':
    case 'reasoning.summary.done':
    case 'stream.delta':
    case 'stream.done':
    case 'tool.called':
    case 'tool.confirmation_requested':
    case 'tool.confirmation_granted':
    case 'tool.confirmation_rejected':
    case 'tool.completed':
    case 'tool.failed':
    case 'tool.waiting':
    case 'wait.timed_out':
    case 'web_search.progress':
    case 'run.cancelled':
    case 'run.failed':
      return true
    default:
      return false
  }
}

const isDelegationParentBlock = (block: Block): block is Block & { childRunId: string } =>
  block.type === 'tool_interaction' &&
  block.name === 'delegate_to_agent' &&
  typeof block.childRunId === 'string' &&
  block.childRunId.trim().length > 0

const doesEventSettleAssistantAttachments = (event: BackendEvent): boolean => {
  switch (event.type) {
    case 'generation.completed':
    case 'stream.done':
    case 'run.cancelled':
    case 'run.completed':
    case 'run.failed':
    case 'run.waiting':
      return true
    default:
      return false
  }
}

export const createChatEventEngine = (dependencies: EventEngineDependencies) => {
  const isCurrentThreadEvent = (event: BackendEvent): boolean =>
    !dependencies.getThreadId() || eventThreadId(event) === dependencies.getThreadId()

  const collectKnownChildRunIds = (): Set<string> => {
    const childRunIds = new Set<string>()
    const relevantMessages: UiMessage[] = []

    const liveAssistantMessage = dependencies.getLiveAssistantMessage()
    if (liveAssistantMessage) {
      relevantMessages.push(liveAssistantMessage)
    }

    for (const message of dependencies.getDurableMessages()) {
      if (message.role === 'assistant' && message.runId === dependencies.getRunId()) {
        relevantMessages.push(dependencies.projectAssistantMessageFromRunTranscript(message))
      }
    }

    for (const message of relevantMessages) {
      for (const block of message.blocks) {
        if (isDelegationParentBlock(block)) {
          childRunIds.add(block.childRunId)
        }
      }
    }

    for (const wait of dependencies.getPendingWaits()) {
      if (wait.ownerRunId && wait.ownerRunId !== dependencies.getRunId()) {
        childRunIds.add(wait.ownerRunId)
      }
    }

    return childRunIds
  }

  const isKnownChildRunEvent = (runId: RunId): boolean =>
    collectKnownChildRunIds().has(String(runId))

  const applyLiveEvent = (event: BackendEvent) => {
    dependencies.logDebug('store', 'applyLiveEvent', {
      eventNo: event.eventNo,
      runId: eventRunId(event),
      threadId: eventThreadId(event),
      type: event.type,
    })
    const transcriptOwnerRunId = dependencies.getRunId() ?? eventRunId(event)

    if (transcriptOwnerRunId) {
      const preferredMessageId =
        dependencies.resolveTranscriptProjectionMessageId(transcriptOwnerRunId)
      const transcript = dependencies.ensureRunTranscript(transcriptOwnerRunId, event.createdAt, {
        preferredMessageId,
        source: 'liveStream',
      })
      const message =
        dependencies.syncLiveAssistantProjectionFromTranscript(
          transcriptOwnerRunId,
          event.createdAt,
          {
            preferredId: preferredMessageId,
          },
        ) ?? dependencies.ensureLiveAssistantMessage(event.createdAt, transcriptOwnerRunId)

      dependencies.typewriterMarkStreamed(dependencies.resolveStableUiKey(message))
      const toolIndex =
        dependencies.toolIndexByMessageId.get(message.id) ?? new Map<string, number>()
      dependencies.toolIndexByMessageId.set(message.id, toolIndex)

      if (
        event.type !== 'run.waiting' &&
        event.type !== 'run.failed' &&
        event.type !== 'run.cancelled' &&
        event.type !== 'run.completed'
      ) {
        transcript.status = 'streaming'
        transcript.finishReason = null
      }

      dependencies.applyEvent(transcript.blocks, event, toolIndex)
      dependencies.syncSandboxAttachmentsFromTranscript(transcript, {
        reveal: doesEventSettleAssistantAttachments(event),
      })
      transcript.sources.liveStream = true
      dependencies.syncLiveAssistantProjectionFromTranscript(
        transcriptOwnerRunId,
        event.createdAt,
        {
          preferredId: message.id,
        },
      )
      dependencies.syncProjectedMessages({ pulse: true })
      dependencies.persistState()
      return
    }

    const message = dependencies.ensureLiveAssistantMessage(event.createdAt, eventRunId(event))
    dependencies.typewriterMarkStreamed(dependencies.resolveStableUiKey(message))
    const toolIndex = dependencies.toolIndexByMessageId.get(message.id) ?? new Map<string, number>()
    dependencies.toolIndexByMessageId.set(message.id, toolIndex)
    dependencies.applyEvent(message.blocks, event, toolIndex)
    dependencies.syncSandboxAttachmentsFromLiveMessage(message, {
      reveal: doesEventSettleAssistantAttachments(event),
    })
    dependencies.rememberRunTranscriptFromMessage(message, 'liveStream')
    dependencies.syncProjectedMessages({ pulse: true })
    dependencies.persistState()
  }

  const applyOptimisticConfirmationEvent = (
    wait: Pick<BackendPendingWait, 'callId' | 'tool' | 'waitId'>,
    input: {
      runId: RunId
      sessionId: SessionId
      threadId: ThreadId
      remembered?: boolean
      status: 'approved' | 'rejected'
    },
  ) => {
    const baseEvent = {
      aggregateId: String(wait.callId),
      aggregateType: 'tool_execution',
      createdAt: dependencies.nowIso(),
      eventNo: -1,
      id: asEventId(
        `evt_local_confirmation_${input.status === 'approved' ? 'approved' : 'rejected'}_${wait.waitId}`,
      ),
    }

    if (input.status === 'approved') {
      applyLiveEvent({
        ...baseEvent,
        payload: {
          callId: String(wait.callId),
          remembered: input.remembered ?? false,
          runId: input.runId,
          sessionId: input.sessionId,
          threadId: input.threadId,
          tool: wait.tool,
          waitId: wait.waitId,
        },
        type: 'tool.confirmation_granted',
      })
      return
    }

    applyLiveEvent({
      ...baseEvent,
      payload: {
        callId: String(wait.callId),
        runId: input.runId,
        sessionId: input.sessionId,
        threadId: input.threadId,
        tool: wait.tool,
        waitId: wait.waitId,
      },
      type: 'tool.confirmation_rejected',
    })
  }

  const getVisibleToolBlockStatus = (callId: string): ToolInteractionBlock['status'] | null => {
    const relevantMessages: UiMessage[] = []

    const liveAssistantMessage = dependencies.getLiveAssistantMessage()
    if (liveAssistantMessage) {
      relevantMessages.push(
        dependencies.projectAssistantMessageFromRunTranscript(liveAssistantMessage),
      )
    }

    for (const message of dependencies.getRetainedAssistantMessages()) {
      relevantMessages.push(dependencies.projectAssistantMessageFromRunTranscript(message))
    }

    for (const message of dependencies.getDurableMessages()) {
      if (message.role === 'assistant') {
        relevantMessages.push(dependencies.projectAssistantMessageFromRunTranscript(message))
      }
    }

    for (const message of relevantMessages) {
      for (const block of message.blocks) {
        if (block.type === 'tool_interaction' && block.toolCallId === callId) {
          return block.status
        }
      }
    }

    return null
  }

  const syncForeignPendingWaitFromEvent = (event: BackendEvent) => {
    switch (event.type) {
      case 'tool.confirmation_requested':
        dependencies.upsertPendingWait({
          args: event.payload.args,
          callId: event.payload.callId,
          createdAt: event.createdAt,
          description: event.payload.description,
          ownerRunId: String(event.payload.runId),
          requiresApproval: true,
          targetKind: event.payload.waitTargetKind,
          targetRef: event.payload.waitTargetRef,
          tool: event.payload.tool,
          type: event.payload.waitType,
          waitId: event.payload.waitId,
        })
        break

      case 'tool.waiting':
        if (
          event.payload.waitType !== 'human' ||
          event.payload.waitTargetKind !== 'human_response'
        ) {
          break
        }

        dependencies.upsertPendingWait({
          args: event.payload.args ?? null,
          callId: event.payload.callId,
          createdAt: event.createdAt,
          description: event.payload.description,
          ownerRunId: String(event.payload.runId),
          requiresApproval: false,
          targetKind: event.payload.waitTargetKind,
          targetRef: event.payload.waitTargetRef,
          tool: event.payload.tool,
          type: event.payload.waitType,
          waitId: event.payload.waitId,
        })
        break

      case 'tool.confirmation_granted':
      case 'tool.confirmation_rejected':
      case 'wait.timed_out':
        dependencies.removePendingWaitByWaitId(event.payload.waitId)
        break

      case 'tool.completed':
      case 'tool.failed':
        dependencies.removePendingWaitByCallId(String(event.payload.callId))
        break
    }
  }

  const ingestEvent = (event: BackendEvent, options: { updateCursor?: boolean } = {}): boolean => {
    const shouldUpdateCursor = options.updateCursor ?? true

    dependencies.logDebug('store', 'ingestEvent', {
      eventNo: event.eventNo,
      runId: eventRunId(event),
      stateRunId: dependencies.getRunId(),
      threadId: eventThreadId(event),
      type: event.type,
    })

    if (!isCurrentThreadEvent(event)) {
      return false
    }

    if (shouldUpdateCursor) {
      dependencies.setEventCursor(Math.max(dependencies.eventCursor(), event.eventNo))
      dependencies.persistState()
    }

    if (dependencies.shouldIgnoreReplayGuardedRunEvent(event)) {
      return false
    }

    if (event.type === 'message.posted') {
      const postedRunId = eventRunId(event)
      if (postedRunId && dependencies.durableHasAssistantForRun(postedRunId)) {
        return false
      }

      const shouldReplaceBootstrapOptimisticMessage =
        dependencies.getPendingOptimisticMessageId() != null &&
        dependencies.getDurableMessages().length === 0 &&
        dependencies.getPendingOptimisticOwner()?.viewEpoch === dependencies.getViewEpoch() &&
        typeof event.payload.messageId === 'string' &&
        (event.payload.runId === undefined || event.payload.runId === null)

      if (shouldReplaceBootstrapOptimisticMessage) {
        const optimisticMessageId = dependencies.getPendingOptimisticMessageId()
        if (optimisticMessageId) {
          dependencies.replaceMessageId(optimisticMessageId, asMessageId(event.payload.messageId))
        }
      }

      const shouldRefreshThreadMessages =
        shouldReplaceBootstrapOptimisticMessage ||
        (postedRunId != null &&
          !dependencies.liveAssistantHasBlocksForRun(postedRunId) &&
          (postedRunId === dependencies.getRunId() ||
            !dependencies.durableHasAssistantForRun(postedRunId)))

      if (!shouldRefreshThreadMessages) {
        return false
      }

      const refreshThreadId = dependencies.getThreadId()
      const refreshLease = dependencies.captureViewLease()
      void dependencies.refreshThreadMessages(refreshThreadId, refreshLease).catch((error) => {
        if (dependencies.isViewLeaseCurrent(refreshLease)) {
          dependencies.setError(dependencies.threadMessageRefreshError(error))
        }
      })
      return false
    }

    if (event.type === 'run.created') {
      const createdRunId = asRunId(String(event.payload.runId))
      if (dependencies.getRunId() && createdRunId !== dependencies.getRunId()) {
        return false
      }

      dependencies.bindActiveRun(createdRunId)
      dependencies.setRunStatus('pending')
      dependencies.setSessionId(asSessionId(String(event.payload.sessionId)))
      dependencies.setThreadId(asThreadId(String(event.payload.threadId)))
      dependencies.persistState()
      if (dependencies.getRunId()) {
        dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
      }
      return false
    }

    const runId = eventRunId(event)
    if (dependencies.getRunId() == null && runId && dependencies.durableHasAssistantForRun(runId)) {
      return false
    }

    const canBootstrapActiveRunFromEvent =
      runId != null &&
      dependencies.getRunId() == null &&
      dependencies.getLiveAssistantMessage() != null &&
      dependencies.getIsStreaming() &&
      event.type !== 'run.waiting' &&
      event.type !== 'run.failed' &&
      event.type !== 'run.cancelled' &&
      event.type !== 'run.completed'

    if (canBootstrapActiveRunFromEvent) {
      dependencies.bindActiveRun(runId)
      dependencies.persistState()
    }

    if (dependencies.getRunId() == null && runId) {
      return false
    }

    const isForeignRunEvent = Boolean(
      runId && dependencies.getRunId() && runId !== dependencies.getRunId(),
    )
    if (
      isForeignRunEvent &&
      (!runId || !isChildTranscriptEvent(event) || !isKnownChildRunEvent(runId))
    ) {
      return false
    }

    if (isForeignRunEvent) {
      syncForeignPendingWaitFromEvent(event)
      applyLiveEvent(event)
      if (dependencies.getRunId()) {
        dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
      }
      return false
    }

    switch (event.type) {
      case 'run.started':
      case 'run.resumed': {
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        dependencies.clearPendingWaits()
        dependencies.syncPendingWaitBlocks()
        if (dependencies.getRunId()) {
          const transcript = dependencies.ensureRunTranscript(
            dependencies.getRunId()!,
            event.createdAt,
            {
              preferredMessageId: dependencies.resolveTranscriptProjectionMessageId(
                dependencies.getRunId()!,
              ),
              source: 'liveStream',
            },
          )
          transcript.status = 'streaming'
          transcript.finishReason = null
          dependencies.clearTranscriptTextBlocksForLiveResume(dependencies.getRunId()!)
          dependencies.syncLiveAssistantProjectionFromTranscript(
            dependencies.getRunId()!,
            event.createdAt,
            {
              preferredId: dependencies.resolveTranscriptProjectionMessageId(
                dependencies.getRunId()!,
              ),
            },
          )
          dependencies.syncProjectedMessages()
        } else {
          dependencies.updateLiveAssistantMessage((message) => {
            message.status = 'streaming'
            message.finishReason = null
          })
          dependencies.syncProjectedMessages()
        }
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        break
      }

      case 'turn.started':
        dependencies.setContextBudget(
          dependencies.withStreamingBudgetStart(dependencies.getContextBudget(), {
            estimatedInputTokens: event.payload.estimatedInputTokens,
            reservedOutputTokens: event.payload.reservedOutputTokens,
            stablePrefixTokens: event.payload.stablePrefixTokens,
            turn: event.payload.turn,
            volatileSuffixTokens: event.payload.volatileSuffixTokens,
          }),
        )
        break

      case 'memory.observation.started':
        dependencies.setMemoryActivity('observing')
        break
      case 'memory.observation.completed':
        dependencies.setMemoryActivity('idle')
        break
      case 'memory.reflection.started':
        dependencies.setMemoryActivity('reflecting')
        break
      case 'memory.reflection.completed':
        dependencies.setMemoryActivity('idle')
        break

      case 'thread.naming.requested':
      case 'thread.naming.started':
        dependencies.setIsThreadNaming(true)
        dependencies.persistState()
        dependencies.setStreamPulse()
        return false

      case 'thread.updated':
        dependencies.applyThreadTitle({ title: event.payload.title })
        dependencies.setIsThreadNaming(false)
        dependencies.persistState()
        dependencies.setStreamPulse()
        return false

      case 'thread.naming.completed':
        if (event.payload.applied) {
          dependencies.applyThreadTitle({ title: event.payload.title })
        }
        dependencies.setIsThreadNaming(false)
        dependencies.persistState()
        dependencies.setStreamPulse()
        return false

      case 'thread.naming.failed':
        dependencies.setIsThreadNaming(false)
        if (event.payload.trigger === 'manual_regenerate') {
          dependencies.setError(
            dependencies.humanizeErrorMessage(
              dependencies.extractEventErrorMessage(event.payload.error, 'Thread naming failed'),
            ),
          )
        }
        dependencies.persistState()
        dependencies.setStreamPulse()
        return false

      case 'progress.reported':
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        dependencies.persistState()
        return false

      case 'reasoning.summary.delta':
      case 'reasoning.summary.done':
      case 'stream.done':
      case 'web_search.progress':
      case 'tool.called':
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        applyLiveEvent(event)
        return false

      case 'stream.delta':
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        dependencies.setContextBudget(
          dependencies.withEstimatedOutputDelta(
            dependencies.getContextBudget(),
            event.payload.delta,
          ),
        )
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        applyLiveEvent(event)
        return false

      case 'generation.completed':
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        dependencies.setContextBudget(
          dependencies.withReconciledUsage(
            dependencies.getContextBudget(),
            dependencies.parseUsage(event.payload.usage),
            event.createdAt,
            event.payload.model,
            event.payload.provider,
            event.payload.outputText,
          ),
        )
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        applyLiveEvent(event)
        return false

      case 'tool.confirmation_requested':
        dependencies.upsertPendingWait({
          args: event.payload.args,
          callId: event.payload.callId,
          createdAt: event.createdAt,
          description: event.payload.description,
          requiresApproval: true,
          targetKind: event.payload.waitTargetKind,
          targetRef: event.payload.waitTargetRef,
          tool: event.payload.tool,
          type: event.payload.waitType,
          waitId: event.payload.waitId,
        })
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        applyLiveEvent(event)
        return false

      case 'tool.confirmation_granted':
      case 'tool.confirmation_rejected':
        dependencies.removePendingWaitByWaitId(event.payload.waitId)
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        applyLiveEvent(event)
        return false

      case 'tool.completed':
      case 'tool.failed': {
        dependencies.removePendingWaitByCallId(String(event.payload.callId))
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        const liveMessage = dependencies.getLiveAssistantMessage()
        if (dependencies.getRunId() && liveMessage && liveMessage.status === 'waiting') {
          const transcript = dependencies.ensureRunTranscript(
            dependencies.getRunId()!,
            event.createdAt,
            {
              preferredMessageId: dependencies.resolveTranscriptProjectionMessageId(
                dependencies.getRunId()!,
              ),
              source: 'liveStream',
            },
          )
          transcript.status = 'streaming'
          transcript.finishReason = null
          dependencies.syncLiveAssistantProjectionFromTranscript(
            dependencies.getRunId()!,
            event.createdAt,
            {
              preferredId: dependencies.resolveTranscriptProjectionMessageId(
                dependencies.getRunId()!,
              ),
            },
          )
        } else if (liveMessage && liveMessage.status === 'waiting') {
          dependencies.updateLiveAssistantMessage((message) => {
            message.status = 'streaming'
            message.finishReason = null
          })
        }
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        applyLiveEvent(event)
        return false
      }

      case 'run.waiting':
        dependencies.setPendingWaits(
          dependencies.mergePendingWaitsForRun(
            event.payload.pendingWaits ?? [],
            runId ?? dependencies.getRunId(),
          ),
        )
        dependencies.setIsResolvingWait(false)
        applyLiveEvent(event)
        dependencies.finalizeRun('waiting', 'waiting', { runId })
        return false

      case 'run.failed': {
        const terminalRunId = dependencies.getRunId() ?? runId
        applyLiveEvent(event)
        dependencies.setError(
          dependencies.humanizeErrorMessage(
            dependencies.extractEventErrorMessage(event.payload.error, 'Run failed'),
          ),
        )
        dependencies.finalizeRun('failed', 'error', { runId: terminalRunId })
        dependencies.reconcileFailedRunState(terminalRunId)
        return true
      }

      case 'run.cancelled':
        applyLiveEvent(event)
        dependencies.finalizeRun('cancelled', 'cancelled', { runId })
        return true

      case 'run.completed':
        applyLiveEvent(event)
        dependencies.finalizeRun('completed', 'stop', { runId })
        return true

      case 'tool.waiting':
      case 'wait.timed_out':
        dependencies.setRunStatus('running')
        dependencies.setIsStreaming(true)
        dependencies.setIsWaiting(false)
        dependencies.setIsResolvingWait(false)
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        applyLiveEvent(event)
        return false

      case 'child_run.completed':
      case 'run.requeued':
        if (dependencies.getRunId()) {
          dependencies.scheduleRunReconciliation(dependencies.getRunId()!)
        }
        return false
    }

    return false
  }

  return {
    applyLiveEvent,
    applyOptimisticConfirmationEvent,
    collectKnownChildRunIds,
    eventRunId,
    eventThreadId,
    getVisibleToolBlockStatus,
    ingestEvent,
    isCurrentThreadEvent,
  }
}
