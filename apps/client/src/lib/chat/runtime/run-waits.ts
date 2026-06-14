import type {
  BackendPendingWait,
  BackendRun,
  MessageId,
  MessageStatus,
  RunId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { mergePendingWaitBlocks } from '../../runtime/materialize'
import { createWaitState } from '../state/waits.svelte'
import type { RunTranscriptState, UiMessage } from '../types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isPendingWait = (value: unknown): value is BackendPendingWait => {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.waitId === 'string' &&
    typeof value.callId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.tool === 'string' &&
    typeof value.type === 'string' &&
    typeof value.targetKind === 'string' &&
    (value.args === null || isRecord(value.args)) &&
    (value.description === null || typeof value.description === 'string') &&
    (value.ownerRunId === undefined || typeof value.ownerRunId === 'string') &&
    (value.requiresApproval === undefined || typeof value.requiresApproval === 'boolean') &&
    (value.targetRef === null || typeof value.targetRef === 'string')
  )
}

export const parsePendingWaits = (value: unknown): BackendPendingWait[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isPendingWait).map((wait) => ({
    ...wait,
    args: wait.args ? { ...wait.args } : null,
  }))
}

export const isConfirmationPendingWait = (wait: BackendPendingWait): boolean =>
  wait.requiresApproval === true

export const isReplyablePendingWait = (wait: BackendPendingWait): boolean =>
  !isConfirmationPendingWait(wait) && wait.type === 'human' && wait.targetKind === 'human_response'

interface RunWaitCoordinatorDependencies<Lease> {
  ensureLiveAssistantMessage: (createdAt: string, expectedRunId?: RunId | null) => UiMessage
  ensureRunTranscript: (
    runId: RunId,
    createdAt: string,
    options: {
      preferredMessageId?: MessageId
      source: 'liveStream'
      status?: MessageStatus
    },
  ) => RunTranscriptState
  getIsWaiting: () => boolean
  getLiveAssistantMessage: () => UiMessage | null
  getNowIso: () => string
  getRunId: () => RunId | null
  getRunStatus: () => BackendRun['status'] | null
  getTranscript: (runId: RunId) => RunTranscriptState | null
  isThreadLeaseCurrent: (lease: Lease, threadId: ThreadId | null) => boolean
  rebuildToolIndexForMessage: (message: Pick<UiMessage, 'blocks' | 'id'>) => void
  rememberRunTranscriptFromMessage: (message: UiMessage, source: 'liveStream') => void
  resolveTranscriptProjectionMessageId: (runId: RunId) => MessageId
  setIsReconnecting: (value: boolean) => void
  setIsResolvingWait: (value: boolean) => void
  setIsStreaming: (value: boolean) => void
  syncLiveAssistantProjectionFromTranscript: (
    runId: RunId,
    createdAt: string,
    input: { preferredId?: MessageId },
  ) => unknown
  syncProjectedMessages: () => void
  bumpStreamPulse: () => void
}

export const createRunWaitCoordinator = <Lease>({
  bumpStreamPulse,
  ensureLiveAssistantMessage,
  ensureRunTranscript,
  getIsWaiting,
  getLiveAssistantMessage,
  getNowIso,
  getRunId,
  getRunStatus,
  getTranscript,
  isThreadLeaseCurrent,
  rebuildToolIndexForMessage,
  rememberRunTranscriptFromMessage,
  resolveTranscriptProjectionMessageId,
  setIsReconnecting,
  setIsResolvingWait,
  setIsStreaming,
  syncLiveAssistantProjectionFromTranscript,
  syncProjectedMessages,
}: RunWaitCoordinatorDependencies<Lease>) => {
  const waitState = createWaitState()

  const clonePendingWait = (
    wait: BackendPendingWait,
    ownerRunId?: RunId | string | null,
  ): BackendPendingWait => waitState.clone(wait, ownerRunId)

  const clonePendingWaits = (
    waits: BackendPendingWait[],
    ownerRunId?: RunId | string | null,
  ): BackendPendingWait[] => waitState.cloneAll(waits, ownerRunId)

  const setPendingWaits = (waits: BackendPendingWait[], ownerRunId?: RunId | string | null) => {
    waitState.set(waits, ownerRunId)
  }

  const mergePendingWaitsForRun = (
    waits: BackendPendingWait[],
    ownerRunId?: RunId | string | null,
  ): BackendPendingWait[] => waitState.mergeForRun(waits, ownerRunId)

  const clearPendingWaits = () => {
    waitState.clear()
  }

  const removePendingWaitBlocksFromProjection = () => {
    const liveMessage = getLiveAssistantMessage()
    const targetRunId = liveMessage?.runId ?? getRunId()
    const transcript = targetRunId ? getTranscript(targetRunId) : null

    if (!transcript && !liveMessage) {
      return
    }

    const currentBlocks = transcript ? transcript.blocks : (liveMessage?.blocks ?? [])
    const nextBlocks = currentBlocks.filter(
      (block) => !(block.type === 'thinking' && block.id.startsWith('waiting:')),
    )

    if (nextBlocks.length === currentBlocks.length) {
      return
    }

    if (transcript && targetRunId != null) {
      transcript.blocks = nextBlocks
      syncLiveAssistantProjectionFromTranscript(
        targetRunId,
        liveMessage?.createdAt ?? transcript.createdAt,
        {
          preferredId: resolveTranscriptProjectionMessageId(targetRunId),
        },
      )
    } else if (liveMessage) {
      liveMessage.blocks = nextBlocks
      rebuildToolIndexForMessage(liveMessage)
    }

    syncProjectedMessages()
    bumpStreamPulse()
  }

  const ensurePendingWaitBlocks = (createdAt: string) => {
    if (waitState.pending.length === 0) {
      return
    }

    const liveMessage = getLiveAssistantMessage()
    const targetRunId = getRunId() ?? liveMessage?.runId ?? null

    if (targetRunId != null) {
      const transcript = ensureRunTranscript(targetRunId, createdAt, {
        preferredMessageId: resolveTranscriptProjectionMessageId(targetRunId),
        source: 'liveStream',
        status: getIsWaiting() ? 'waiting' : 'streaming',
      })
      transcript.blocks = mergePendingWaitBlocks(transcript.blocks, waitState.pending)
      transcript.status = getIsWaiting() ? 'waiting' : transcript.status
      transcript.finishReason = getIsWaiting() ? 'waiting' : transcript.finishReason
      transcript.sources.liveStream = true
      syncLiveAssistantProjectionFromTranscript(targetRunId, createdAt, {
        preferredId: resolveTranscriptProjectionMessageId(targetRunId),
      })
      syncProjectedMessages()
      return
    }

    const fallbackMessage = ensureLiveAssistantMessage(createdAt)
    fallbackMessage.blocks = mergePendingWaitBlocks(fallbackMessage.blocks, waitState.pending)
    rebuildToolIndexForMessage(fallbackMessage)
    rememberRunTranscriptFromMessage(fallbackMessage, 'liveStream')
    syncProjectedMessages()
  }

  const syncPendingWaitBlocks = (createdAt = getNowIso()) => {
    removePendingWaitBlocksFromProjection()

    if (waitState.pending.length === 0) {
      return
    }

    ensurePendingWaitBlocks(waitState.pending[0]?.createdAt ?? createdAt)
  }

  const removePendingWaitByWaitId = (waitId: string) => {
    waitState.removeByWaitId(waitId)
    syncPendingWaitBlocks()
  }

  const removePendingWaitByCallId = (callId: string) => {
    waitState.removeByCallId(callId)
    syncPendingWaitBlocks()
  }

  const upsertPendingWait = (wait: BackendPendingWait) => {
    waitState.upsert(wait)
    syncPendingWaitBlocks(wait.createdAt)
  }

  const startResolvingWait = (waitId: string) => {
    waitState.startResolving(waitId)
    setIsResolvingWait(true)
  }

  const finishResolvingWait = (waitId: string, lease: Lease, threadId: ThreadId | null) => {
    if (!isThreadLeaseCurrent(lease, threadId)) {
      return
    }

    waitState.finishResolving(waitId)
    setIsResolvingWait(waitState.sizeResolving() > 0)
    if (!getIsWaiting() && getRunStatus() !== 'pending' && getRunStatus() !== 'running') {
      setIsStreaming(false)
    }
    setIsReconnecting(false)
  }

  const clearResolving = () => {
    waitState.clearResolving()
  }

  const hydratePendingWaitState = (run: BackendRun) => {
    const hydratedPendingWaits =
      run.status === 'waiting' && isRecord(run.resultJson)
        ? parsePendingWaits(run.resultJson.pendingWaits)
        : []

    if (run.status === 'waiting' && hydratedPendingWaits.length > 0) {
      setPendingWaits(mergePendingWaitsForRun(hydratedPendingWaits, run.id))
      return
    }

    if (
      run.status === 'waiting' &&
      isRecord(run.resultJson) &&
      Array.isArray(run.resultJson.waitIds)
    ) {
      waitState.setWaitIds(
        run.resultJson.waitIds.filter((waitId): waitId is string => typeof waitId === 'string'),
      )
      return
    }

    clearPendingWaits()
  }

  const getReplyablePendingWait = (
    activeRunId: RunId | null = getRunId(),
  ): BackendPendingWait | null => {
    const replyableWaits = waitState.pending.filter(
      (wait) =>
        isReplyablePendingWait(wait) &&
        !waitState.hasResolving(wait.waitId) &&
        (activeRunId == null || wait.ownerRunId == null || wait.ownerRunId === activeRunId),
    )

    return replyableWaits.length === 1 ? clonePendingWait(replyableWaits[0]!) : null
  }

  return {
    clearPendingWaits,
    clearResolving,
    clonePendingWait,
    clonePendingWaits,
    ensurePendingWaitBlocks,
    find(waitId: string) {
      return waitState.find(waitId)
    },
    finishResolvingWait,
    get pending(): BackendPendingWait[] {
      return waitState.pending
    },
    getReplyablePendingWait,
    get resolvingIds(): Set<string> {
      return waitState.resolvingIds
    },
    get waitIds(): string[] {
      return waitState.waitIds
    },
    hasResolving(waitId: string): boolean {
      return waitState.hasResolving(waitId)
    },
    hydratePendingWaitState,
    mergePendingWaitsForRun,
    removePendingWaitByCallId,
    removePendingWaitByWaitId,
    setPendingWaits,
    startResolvingWait,
    syncPendingWaitBlocks,
    upsertPendingWait,
  }
}
