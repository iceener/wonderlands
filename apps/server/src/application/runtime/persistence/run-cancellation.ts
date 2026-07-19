import type { AppDatabase } from '../../../db/client'
import type { RepositoryDatabase } from '../../../db/repository-database'
import { withTransaction } from '../../../db/transaction'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import { type DomainError, DomainErrorException } from '../../../shared/errors'
import type { RunId } from '../../../shared/ids'
import { err, ok, type Result } from '../../../shared/result'
import type { CommandContext } from '../../commands/command-context'
import { createEventStore } from '../../commands/event-store'
import {
  createRunDependencyRepository,
  createRunRepository,
  createToolExecutionRepository,
} from '../../persistence/repositories'
import { appendDomainEvent, resolveRunEventThreadId } from '../run-events'
import { toRunExecutionTerminalError } from '../run-execution-convergence'
import { markRunJobCancelled } from '../scheduling/job-sync'
import {
  buildRunTranscriptSnapshot,
  persistAssistantSnapshotMessageInTransaction,
} from './run-persistence'

type CancelRunCommandDisposition = 'already_cancelling' | 'execute'
type CancelRunRecoveryDisposition = 'already_cancelled' | 'already_cancelling' | 'execute'

export type CancelRunResponseStatus = 'cancelled' | 'cancelling'

interface CancelRunSubtreeResult {
  responseStatus: CancelRunResponseStatus
  run: RunRecord
}

const unwrapOrThrow = <TValue>(result: Result<TValue, DomainError>): TValue => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}

export const isTerminalRunStatus = (status: RunRecord['status']): boolean =>
  status === 'completed' || status === 'failed' || status === 'cancelled'

const toCancellationMetadata = (
  run: RunRecord,
  input: {
    cancelledAt: string
    reason: string | null
  },
): Record<string, unknown> => ({
  ...(typeof run.resultJson === 'object' && run.resultJson !== null
    ? (run.resultJson as Record<string, unknown>)
    : {}),
  cancelRequestedAt: input.cancelledAt,
  reason: input.reason ?? null,
})

const toAlreadyTerminalCancellationConflict = (runId: RunId): DomainError => ({
  message: `run ${runId} is already terminal`,
  type: 'conflict',
})

export const classifyRunForCancelCommand = (
  runId: RunId,
  run: RunRecord,
): Result<CancelRunCommandDisposition, DomainError> => {
  if (isTerminalRunStatus(run.status)) {
    return err(toAlreadyTerminalCancellationConflict(runId))
  }

  if (run.status === 'cancelling') {
    return ok('already_cancelling')
  }

  return ok('execute')
}

export const classifyRunForCancelRecovery = (
  run: RunRecord,
): Result<CancelRunRecoveryDisposition, DomainError> => {
  switch (run.status) {
    case 'cancelled':
      return ok('already_cancelled')
    case 'cancelling':
      return ok('already_cancelling')
    case 'completed':
    case 'failed':
      return err(toRunExecutionTerminalError(run))
    case 'running':
      return ok('execute')
    case 'pending':
    case 'waiting':
      return ok('execute')
  }
}

const commitRunCancelledState = (
  context: CommandContext,
  input: {
    cancelledAt: string
    db: RepositoryDatabase
    eventStore: ReturnType<typeof createEventStore>
    reason: string | null
    run: RunRecord
    runRepository: ReturnType<typeof createRunRepository>
  },
): RunRecord => {
  const transcriptSnapshot = unwrapOrThrow(
    buildRunTranscriptSnapshot(context, input.db, input.run, {
      createdAt: input.cancelledAt,
    }),
  )
  const snapshotOutputText =
    transcriptSnapshot.outputText.length > 0
      ? transcriptSnapshot.outputText
      : input.reason
        ? `Cancelled: ${input.reason}`
        : 'Run cancelled.'
  const assistantMessage = unwrapOrThrow(
    persistAssistantSnapshotMessageInTransaction(context, input.db, input.run, {
      createdAt: input.cancelledAt,
      finishReason: 'cancelled',
      outputText: snapshotOutputText,
      transcript: transcriptSnapshot.transcript,
    }),
  )

  if (assistantMessage.created && assistantMessage.assistantMessageId && input.run.threadId) {
    appendDomainEvent(context, input.eventStore, {
      aggregateId: assistantMessage.assistantMessageId,
      aggregateType: 'session_message',
      payload: {
        messageId: assistantMessage.assistantMessageId,
        runId: input.run.id,
        sessionId: input.run.sessionId,
        threadId: input.run.threadId,
      },
      type: 'message.posted',
    })
  }

  const cancelledRun = unwrapOrThrow(
    input.runRepository.cancel(context.tenantScope, {
      completedAt: input.cancelledAt,
      expectedStatus: input.run.status,
      expectedVersion: input.run.version,
      lastProgressAt: input.cancelledAt,
      resultJson: {
        ...toCancellationMetadata(input.run, {
          cancelledAt: input.cancelledAt,
          reason: input.reason,
        }),
        assistantMessageId: assistantMessage.assistantMessageId,
        cancelledAt: input.cancelledAt,
        ...(transcriptSnapshot.transcript ? { transcript: transcriptSnapshot.transcript } : {}),
        ...(snapshotOutputText.length > 0 ? { outputText: snapshotOutputText } : {}),
      },
      runId: input.run.id,
      updatedAt: input.cancelledAt,
    }),
  )

  unwrapOrThrow(
    input.eventStore.append({
      actorAccountId: context.tenantScope.accountId,
      aggregateId: input.run.id,
      aggregateType: 'run',
      outboxTopics: ['projection', 'realtime'],
      payload: {
        reason: input.reason ?? null,
        runId: input.run.id,
        sessionId: cancelledRun.sessionId,
        status: cancelledRun.status,
        threadId: resolveRunEventThreadId(cancelledRun),
      },
      tenantId: context.tenantScope.tenantId,
      traceId: context.traceId,
      type: 'run.cancelled',
    }),
  )

  unwrapOrThrow(
    markRunJobCancelled(input.db, context.tenantScope, cancelledRun, {
      completedAt: input.cancelledAt,
      eventContext: {
        eventStore: input.eventStore,
        traceId: context.traceId,
      },
      resultJson: cancelledRun.resultJson,
    }),
  )

  return cancelledRun
}

const requestRunCancellation = (
  context: CommandContext,
  input: {
    cancelledAt: string
    eventStore: ReturnType<typeof createEventStore>
    reason: string | null
    run: RunRecord
    runRepository: ReturnType<typeof createRunRepository>
  },
): CancelRunSubtreeResult => {
  if (input.run.status !== 'running') {
    return {
      responseStatus: 'cancelled',
      run: input.run,
    }
  }

  const cancellingRun = unwrapOrThrow(
    input.runRepository.markCancelling(context.tenantScope, {
      expectedStatus: 'running',
      expectedVersion: input.run.version,
      lastProgressAt: input.cancelledAt,
      resultJson: toCancellationMetadata(input.run, {
        cancelledAt: input.cancelledAt,
        reason: input.reason,
      }),
      runId: input.run.id,
      updatedAt: input.cancelledAt,
    }),
  )

  unwrapOrThrow(
    input.eventStore.append({
      actorAccountId: context.tenantScope.accountId,
      aggregateId: input.run.id,
      aggregateType: 'run',
      outboxTopics: ['projection', 'realtime'],
      payload: {
        reason: input.reason ?? null,
        runId: input.run.id,
        sessionId: cancellingRun.sessionId,
        status: cancellingRun.status,
        threadId: resolveRunEventThreadId(cancellingRun),
      },
      tenantId: context.tenantScope.tenantId,
      traceId: context.traceId,
      type: 'run.cancelling',
    }),
  )

  return {
    responseStatus: 'cancelling',
    run: cancellingRun,
  }
}

const cancelPendingWaits = (
  context: CommandContext,
  input: {
    cancelledAt: string
    reason: string | null
    run: RunRecord
    runDependencyRepository: ReturnType<typeof createRunDependencyRepository>
  },
): string[] => {
  const pendingWaits = unwrapOrThrow(
    input.runDependencyRepository.listPendingByRunId(context.tenantScope, input.run.id),
  )

  if (pendingWaits.length === 0) {
    return []
  }

  unwrapOrThrow(
    input.runDependencyRepository.resolveManyForRun(context.tenantScope, {
      ids: pendingWaits.map((wait) => wait.id),
      resolutionJson: {
        reason: input.reason ?? 'Run cancelled',
      },
      resolvedAt: input.cancelledAt,
      runId: input.run.id,
      status: 'cancelled',
    }),
  )

  return pendingWaits.map((wait) => wait.id)
}

const failIncompleteToolExecutions = (
  context: CommandContext,
  input: {
    cancelledAt: string
    db: RepositoryDatabase
    eventStore: ReturnType<typeof createEventStore>
    reason: string | null
    run: RunRecord
    toolExecutionRepository: ReturnType<typeof createToolExecutionRepository>
  },
): void => {
  const incompleteToolExecutions = unwrapOrThrow(
    input.toolExecutionRepository.listIncompleteByRunId(context.tenantScope, input.run.id),
  )
  const eventThreadId = resolveRunEventThreadId(input.run)

  for (const toolExecution of incompleteToolExecutions) {
    unwrapOrThrow(
      input.toolExecutionRepository.fail(context.tenantScope, {
        completedAt: input.cancelledAt,
        durationMs: null,
        errorText: input.reason ?? 'Run cancelled',
        id: toolExecution.id,
        outcomeJson: {
          error: {
            message: input.reason ?? 'Run cancelled',
            type: 'conflict',
          },
          ok: false,
        },
      }),
    )

    unwrapOrThrow(
      input.eventStore.append({
        actorAccountId: context.tenantScope.accountId,
        aggregateId: toolExecution.id,
        aggregateType: 'tool_execution',
        outboxTopics: ['projection', 'realtime'],
        payload: {
          callId: toolExecution.id,
          error: {
            message: input.reason ?? 'Run cancelled',
            type: 'conflict',
          },
          runId: input.run.id,
          sessionId: input.run.sessionId,
          threadId: eventThreadId,
          tool: toolExecution.tool,
        },
        tenantId: context.tenantScope.tenantId,
        traceId: context.traceId,
        type: 'tool.failed',
      }),
    )
  }
}

export const cancelRunSubtree = (
  context: CommandContext,
  input: {
    abortedRunIds: Set<RunId>
    cancelledAt: string
    db: RepositoryDatabase
    eventStore: ReturnType<typeof createEventStore>
    reason: string | null
    run: RunRecord
    runRepository: ReturnType<typeof createRunRepository>
    toolExecutionRepository: ReturnType<typeof createToolExecutionRepository>
    runDependencyRepository: ReturnType<typeof createRunDependencyRepository>
  },
  seenRunIds: Set<RunId>,
): CancelRunSubtreeResult => {
  if (seenRunIds.has(input.run.id) || isTerminalRunStatus(input.run.status)) {
    return {
      responseStatus: 'cancelled',
      run: input.run,
    }
  }

  seenRunIds.add(input.run.id)

  const childRuns = unwrapOrThrow(
    input.runRepository.listByParentRunId(context.tenantScope, input.run.id),
  )

  for (const childRun of childRuns) {
    if (isTerminalRunStatus(childRun.status)) {
      continue
    }

    cancelRunSubtree(
      context,
      {
        ...input,
        reason: input.reason ?? `Parent run ${input.run.id} cancelled`,
        run: childRun,
      },
      seenRunIds,
    )
  }

  cancelPendingWaits(context, input)
  failIncompleteToolExecutions(context, input)
  const requested = requestRunCancellation(context, {
    cancelledAt: input.cancelledAt,
    eventStore: input.eventStore,
    reason: input.reason,
    run: input.run,
    runRepository: input.runRepository,
  })

  if (requested.responseStatus === 'cancelling') {
    input.abortedRunIds.add(requested.run.id)
    return requested
  }

  const cancelledRun = commitRunCancelledState(context, {
    cancelledAt: input.cancelledAt,
    db: input.db,
    eventStore: input.eventStore,
    reason: input.reason,
    run: input.run,
    runRepository: input.runRepository,
  })
  input.abortedRunIds.add(cancelledRun.id)

  return {
    responseStatus: 'cancelled',
    run: cancelledRun,
  }
}

export const finalizeRunCancellation = (
  context: CommandContext,
  input: {
    cancelledAt: string
    db: AppDatabase
    reason: string | null
    runId: RunId
  },
): Result<RunRecord, DomainError> =>
  withTransaction(input.db, (tx) => {
    const runRepository = createRunRepository(tx)
    const run = unwrapOrThrow(runRepository.getById(context.tenantScope, input.runId))

    if (run.status === 'cancelled') {
      return ok(run)
    }

    if (run.status !== 'cancelling') {
      return err({
        message: `run ${input.runId} is not awaiting cancellation finalization`,
        type: 'conflict',
      })
    }

    const runDependencyRepository = createRunDependencyRepository(tx)
    const toolExecutionRepository = createToolExecutionRepository(tx)
    const eventStore = createEventStore(tx)

    cancelPendingWaits(context, {
      cancelledAt: input.cancelledAt,
      reason: input.reason,
      run,
      runDependencyRepository,
    })
    failIncompleteToolExecutions(context, {
      cancelledAt: input.cancelledAt,
      db: tx,
      eventStore,
      reason: input.reason,
      run,
      toolExecutionRepository,
    })

    return ok(
      commitRunCancelledState(context, {
        cancelledAt: input.cancelledAt,
        db: tx,
        eventStore,
        reason: input.reason,
        run,
        runRepository,
      }),
    )
  })
