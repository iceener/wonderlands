import type {
  BackendPendingWait,
  MessageId,
  ResumeRunOutput,
  RunId,
  SessionId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { asRunId } from '@wonderlands/contracts/chat'

export interface PendingWaitReplyInput {
  optimisticUserMessageId: MessageId | null
  text: string
  threadId: ThreadId
  wait: BackendPendingWait
}

type PendingWaitConfirmationMode = 'approve' | 'reject' | 'trust'

interface ResolvePendingWaitConfirmationInput {
  mode: PendingWaitConfirmationMode
  ownerRunId?: RunId | string
  waitId?: string
}

interface ApplyOptimisticConfirmationEventInput {
  remembered?: boolean
  runId: RunId
  sessionId: SessionId
  status: 'approved' | 'rejected'
  threadId: ThreadId
}

interface PendingWaitCommandsDependencies<Lease> {
  applyOptimisticConfirmationEvent: (
    wait: BackendPendingWait,
    input: ApplyOptimisticConfirmationEventInput,
  ) => void
  applyResumeRunOutput: (result: ResumeRunOutput) => void
  captureViewLease: () => Lease
  ensureThreadEventStream: (threadId: ThreadId, lease: Lease) => Promise<void>
  finishResolvingWait: (waitId: string, lease: Lease, threadId: ThreadId | null) => void
  findPendingWait: (waitId: string) => BackendPendingWait | null
  getActiveRunId: () => RunId | null
  getPendingWaitIds: () => readonly string[]
  getPendingWaits: () => readonly BackendPendingWait[]
  getSessionId: () => SessionId | null
  getThreadId: () => ThreadId | null
  getVisibleToolBlockStatus: (callId: string) => string | null
  hasResolvingWait: (waitId: string) => boolean
  isThreadLeaseCurrent: (lease: Lease, threadId: ThreadId | null) => boolean
  postThreadMessage: (
    threadId: ThreadId,
    input: {
      text: string
    },
  ) => Promise<{
    messageId: MessageId
    sessionId: SessionId
  }>
  removePendingWaitByWaitId: (waitId: string) => void
  replaceMessageId: (currentId: MessageId, nextId: MessageId) => void
  resumeRun: (
    runId: RunId,
    input:
      | {
          approve: false
          waitId: string
        }
      | {
          approve: true
          rememberApproval: boolean
          waitId: string
        }
      | {
          output: {
            content: Array<{
              text: string
              type: 'text'
            }>
            kind: 'human_response'
            sourceMessageId: MessageId
            text: string
            threadId: ThreadId
          }
          waitId: string
        },
  ) => Promise<ResumeRunOutput>
  setError: (message: string | null) => void
  setSessionId: (sessionId: SessionId) => void
  startResolvingWait: (waitId: string) => void
  toDisplayError: (error: unknown, fallback: string) => string
  bumpStreamPulse: () => void
}

export const resolvePendingConfirmationWaitId = (input: {
  pendingWaitIds: readonly string[]
  pendingWaits: readonly BackendPendingWait[]
  requestedWaitId?: string
  resolvingWaitIds: ReadonlySet<string>
}): string | null =>
  input.requestedWaitId ??
  input.pendingWaits.find(
    (wait) => wait.requiresApproval === true && !input.resolvingWaitIds.has(wait.waitId),
  )?.waitId ??
  input.pendingWaitIds.find((id) => !input.resolvingWaitIds.has(id)) ??
  null

export const createPendingWaitCommands = <Lease>(
  dependencies: PendingWaitCommandsDependencies<Lease>,
) => {
  const submitReply = async (
    input: PendingWaitReplyInput,
    viewLease: Lease = dependencies.captureViewLease(),
  ) => {
    const activeRunId = dependencies.getActiveRunId()
    const targetRunId = input.wait.ownerRunId ? asRunId(input.wait.ownerRunId) : activeRunId

    if (!targetRunId) {
      throw new Error('Replyable wait is missing an owner run id.')
    }

    dependencies.startResolvingWait(input.wait.waitId)

    try {
      const isCurrentRunWait = activeRunId != null && targetRunId === activeRunId
      void dependencies.ensureThreadEventStream(input.threadId, viewLease)

      const postedMessage = await dependencies.postThreadMessage(input.threadId, {
        text: input.text,
      })
      if (!dependencies.isThreadLeaseCurrent(viewLease, input.threadId)) {
        return
      }

      dependencies.setSessionId(postedMessage.sessionId)

      if (input.optimisticUserMessageId) {
        dependencies.replaceMessageId(input.optimisticUserMessageId, postedMessage.messageId)
      }

      const resumeResult = await dependencies.resumeRun(targetRunId, {
        output: {
          content: [{ text: input.text, type: 'text' }],
          kind: 'human_response',
          sourceMessageId: postedMessage.messageId,
          text: input.text,
          threadId: input.threadId,
        },
        waitId: input.wait.waitId,
      })
      if (!dependencies.isThreadLeaseCurrent(viewLease, input.threadId)) {
        return
      }

      dependencies.removePendingWaitByWaitId(input.wait.waitId)

      if (isCurrentRunWait) {
        dependencies.applyResumeRunOutput(resumeResult)
      }
    } finally {
      dependencies.finishResolvingWait(input.wait.waitId, viewLease, input.threadId)
    }
  }

  const resolveConfirmation = async ({
    mode,
    ownerRunId,
    waitId,
  }: ResolvePendingWaitConfirmationInput) => {
    const targetWaitId = resolvePendingConfirmationWaitId({
      pendingWaitIds: dependencies.getPendingWaitIds(),
      pendingWaits: dependencies.getPendingWaits(),
      requestedWaitId: waitId,
      resolvingWaitIds: new Set(
        dependencies
          .getPendingWaitIds()
          .filter((pendingWaitId) => dependencies.hasResolvingWait(pendingWaitId)),
      ),
    })
    const activeRunId = dependencies.getActiveRunId()
    const targetRunId = ownerRunId ? asRunId(String(ownerRunId)) : activeRunId
    const threadId = dependencies.getThreadId()

    if (!targetRunId || !threadId || !targetWaitId || dependencies.hasResolvingWait(targetWaitId)) {
      return
    }

    const viewLease = dependencies.captureViewLease()
    dependencies.setError(null)
    dependencies.startResolvingWait(targetWaitId)

    try {
      const isCurrentRunWait = activeRunId != null && targetRunId === activeRunId
      const resolvedWait = dependencies.findPendingWait(targetWaitId)
      void dependencies.ensureThreadEventStream(threadId, viewLease)
      const resumeResult =
        mode === 'reject'
          ? await dependencies.resumeRun(targetRunId, {
              approve: false,
              waitId: targetWaitId,
            })
          : await dependencies.resumeRun(targetRunId, {
              approve: true,
              rememberApproval: mode === 'trust',
              waitId: targetWaitId,
            })
      if (!dependencies.isThreadLeaseCurrent(viewLease, threadId)) {
        return
      }

      dependencies.removePendingWaitByWaitId(targetWaitId)

      const sessionId = dependencies.getSessionId()
      if (
        resolvedWait &&
        sessionId &&
        dependencies.getVisibleToolBlockStatus(String(resolvedWait.callId)) ===
          'awaiting_confirmation'
      ) {
        dependencies.applyOptimisticConfirmationEvent(resolvedWait, {
          ...(mode === 'approve' ? { remembered: false } : {}),
          ...(mode === 'trust' ? { remembered: true } : {}),
          runId: targetRunId,
          sessionId,
          status: mode === 'reject' ? 'rejected' : 'approved',
          threadId,
        })
      }

      if (isCurrentRunWait) {
        dependencies.applyResumeRunOutput(resumeResult)
      }
    } catch (error) {
      if (dependencies.isThreadLeaseCurrent(viewLease, threadId)) {
        dependencies.setError(
          dependencies.toDisplayError(
            error,
            mode === 'approve'
              ? 'Could not approve the pending tool call.'
              : mode === 'trust'
                ? 'Could not trust and approve the pending tool call.'
                : 'Could not reject the pending tool call.',
          ),
        )
      }
    } finally {
      dependencies.finishResolvingWait(targetWaitId, viewLease, threadId)
      if (dependencies.isThreadLeaseCurrent(viewLease, threadId)) {
        dependencies.bumpStreamPulse()
      }
    }
  }

  return {
    resolveConfirmation,
    submitReply,
  }
}
