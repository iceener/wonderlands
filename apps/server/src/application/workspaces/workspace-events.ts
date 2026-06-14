import type { WorkspaceRecord } from '../../domain/agents/workspace-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type { CommandContext } from '../commands/command-context'
import type { createEventStore } from '../commands/event-store'
import type { WorkspaceResolution } from './workspace-service'

const unwrapOrThrow = <TValue>(result: Result<TValue, DomainError>): TValue => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}

interface WorkspaceLifecycleEventInput {
  parentRunId?: string | null
  reason: string
  resolution: WorkspaceResolution
  rootRunId?: string | null
  runId?: string | null
  sessionId?: string | null
  threadId?: string | null
  workspaceRef?: string | null
}

const toPayload = (
  workspace: WorkspaceRecord,
  input: Omit<WorkspaceLifecycleEventInput, 'resolution'>,
) => ({
  accountId: workspace.accountId,
  kind: workspace.kind,
  ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
  reason: input.reason,
  rootRef: workspace.rootRef,
  ...(input.rootRunId ? { rootRunId: input.rootRunId } : {}),
  ...(input.runId ? { runId: input.runId } : {}),
  ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  status: workspace.status,
  ...(input.threadId ? { threadId: input.threadId } : {}),
  workspaceId: workspace.id,
  ...(input.workspaceRef ? { workspaceRef: input.workspaceRef } : {}),
})

export const appendWorkspaceLifecycleEvents = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  input: WorkspaceLifecycleEventInput,
): void => {
  const payload = toPayload(input.resolution.workspace, input)

  if (input.resolution.created) {
    unwrapOrThrow(
      eventStore.append({
        actorAccountId: context.tenantScope.accountId,
        aggregateId: input.resolution.workspace.id,
        aggregateType: 'workspace',
        outboxTopics: ['projection', 'realtime'],
        payload,
        tenantId: context.tenantScope.tenantId,
        traceId: context.traceId,
        type: 'workspace.created',
      }),
    )
  }

  unwrapOrThrow(
    eventStore.append({
      actorAccountId: context.tenantScope.accountId,
      aggregateId: input.resolution.workspace.id,
      aggregateType: 'workspace',
      outboxTopics: ['projection', 'realtime'],
      payload,
      tenantId: context.tenantScope.tenantId,
      traceId: context.traceId,
      type: 'workspace.resolved',
    }),
  )
}
