import type { RunDependencyRecord } from '../../../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import type { CommandContext } from '../../../commands/command-context'
import type { createEventStore } from '../../../commands/event-store'
import { resolveRunEventThreadId } from '../../run-events'
import { type RunWaitResolutionInput, unwrapOrThrow } from './wait-resolution-support'

const toChildRunResultKind = (
  input: Pick<RunWaitResolutionInput, 'errorMessage' | 'output'>,
): 'cancelled' | 'completed' | 'failed' | null => {
  if (input.errorMessage) {
    return 'failed'
  }

  if (!input.output || typeof input.output !== 'object' || Array.isArray(input.output)) {
    return null
  }

  const candidate = (input.output as { kind?: unknown }).kind

  return candidate === 'cancelled' || candidate === 'completed' || candidate === 'failed'
    ? candidate
    : null
}

const toChildRunSummary = (output: unknown): string | null => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null
  }

  const candidate = (output as { summary?: unknown }).summary

  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

export const appendChildRunCompletedEvent = (input: {
  context: CommandContext
  currentRun: RunRecord
  eventStore: ReturnType<typeof createEventStore>
  resolutionInput: RunWaitResolutionInput
  runDependency: RunDependencyRecord
}): void => {
  if (
    input.runDependency.type !== 'agent' ||
    input.runDependency.targetKind !== 'run' ||
    !input.runDependency.targetRunId
  ) {
    return
  }

  const resultKind = toChildRunResultKind(input.resolutionInput)

  if (!resultKind) {
    return
  }

  unwrapOrThrow(
    input.eventStore.append({
      actorAccountId: input.context.tenantScope.accountId,
      aggregateId: input.currentRun.id,
      aggregateType: 'run',
      payload: {
        callId: input.runDependency.callId,
        childRunId: input.runDependency.targetRunId,
        parentRunId: input.currentRun.id,
        resultKind,
        rootRunId: input.currentRun.rootRunId,
        runId: input.currentRun.id,
        sessionId: input.currentRun.sessionId,
        sourceCallId: input.runDependency.callId,
        ...(toChildRunSummary(input.resolutionInput.output)
          ? { summary: toChildRunSummary(input.resolutionInput.output) }
          : {}),
        threadId: resolveRunEventThreadId(input.currentRun),
        waitId: input.runDependency.id,
      },
      tenantId: input.context.tenantScope.tenantId,
      traceId: input.context.traceId,
      type: 'child_run.completed',
    }),
  )
}
