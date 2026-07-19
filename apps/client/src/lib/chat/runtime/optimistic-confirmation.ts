import type {
  BackendEvent,
  BackendPendingWait,
  RunId,
  SessionId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { asEventId } from '@wonderlands/contracts/chat'

export interface OptimisticConfirmationInput {
  runId: RunId
  sessionId: SessionId
  threadId: ThreadId
  remembered?: boolean
  status: 'approved' | 'rejected'
}

/**
 * Builds a synthetic backend event representing an optimistic (client-predicted)
 * tool confirmation outcome, before the server-authoritative event arrives. The
 * event is applied through the normal live-event pipeline so the UI updates
 * immediately, then reconciled once the real event streams in.
 */
export const buildOptimisticConfirmationEvent = (
  wait: Pick<BackendPendingWait, 'callId' | 'tool' | 'waitId'>,
  input: OptimisticConfirmationInput,
  nowIso: () => string,
): BackendEvent => {
  const baseEvent = {
    aggregateId: String(wait.callId),
    aggregateType: 'tool_execution',
    createdAt: nowIso(),
    eventNo: -1,
    id: asEventId(
      `evt_local_confirmation_${input.status === 'approved' ? 'approved' : 'rejected'}_${wait.waitId}`,
    ),
  }

  if (input.status === 'approved') {
    return {
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
    }
  }

  return {
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
  }
}
