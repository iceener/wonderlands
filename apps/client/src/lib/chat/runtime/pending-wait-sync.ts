import type { BackendEvent, BackendPendingWait } from '@wonderlands/contracts/chat'

export type PendingWaitSyncAction =
  | { kind: 'upsert'; wait: BackendPendingWait }
  | { kind: 'removeByWaitId'; waitId: string }
  | { kind: 'removeByCallId'; callId: string }
  | null

/**
 * Maps a live backend event to the pending-wait bookkeeping action it implies
 * for a *foreign* run (a run this client is not directly driving, e.g. a
 * delegated child run). Pure mapping only — callers are responsible for
 * dispatching the resulting action against pending-wait state.
 */
export const resolveForeignPendingWaitAction = (event: BackendEvent): PendingWaitSyncAction => {
  switch (event.type) {
    case 'tool.confirmation_requested':
      return {
        kind: 'upsert',
        wait: {
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
        },
      }

    case 'tool.waiting':
      if (event.payload.waitType !== 'human' || event.payload.waitTargetKind !== 'human_response') {
        return null
      }

      return {
        kind: 'upsert',
        wait: {
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
        },
      }

    case 'tool.confirmation_granted':
    case 'tool.confirmation_rejected':
    case 'wait.timed_out':
      return { kind: 'removeByWaitId', waitId: event.payload.waitId }

    case 'tool.completed':
    case 'tool.failed':
      return { kind: 'removeByCallId', callId: String(event.payload.callId) }

    default:
      return null
  }
}
