import type { AiMessageContent } from '../../../domain/ai/types'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { RunId } from '../../../shared/ids'
import { err } from '../../../shared/result'
import {
  isNativeToolAllowedForRun,
  isToolAllowedForRun,
  resolveMcpModeForRun,
} from '../../agents/agent-runtime-policy'
import type { CommandContext, CommandResult } from '../../commands/command-context'
import { collectContextFacts } from '../../context/collect-context-facts'
import { projectContextFactsToThreadContextData } from '../../context/context-facts'
import {
  persistContextManifestAttempt,
  resolveNextContextManifestAttemptTurn,
} from '../../context/persist-context-manifest'
import { prepareContextState } from '../../context/prepare-context-state'
import { assembleThreadInteractionRequest } from '../../interactions/assemble-thread-interaction-request'
import type { RunInteractionOverrides } from '../../interactions/build-run-interaction-request'
import { applyLatestBudgetCalibration } from '../../interactions/context-bundle'
import { buildMcpCodeModeCatalog } from '../../mcp/code-mode'
import { createRunRepository, createUsageLedgerRepository } from '../../persistence/repositories'
import { finalizeRunCancellation } from '../persistence/run-cancellation'
import {
  completeRunWithAssistantMessage,
  failRun,
  markRunWaiting,
  persistOutputItems,
  persistUsageEntry,
  type RunExecutionOutput,
} from '../persistence/run-persistence'
import { convergeRunExecutionConflict } from '../run-execution-convergence'
import { emitProgressReported } from '../run-telemetry'
import { streamRunInteraction } from './run-generation-stream'
import {
  executeOneToolCall,
  persistToolCalledEvents,
  persistToolOutcomes,
  prepareToolExecution,
  toToolContext,
} from './run-tool-execution'

export type {
  CompletedRunExecutionOutput,
  RunExecutionOutput,
  WaitingRunExecutionOutput,
} from '../persistence/run-persistence'

const toInactiveRunError = (run: RunRecord) => ({
  message: `run ${run.id} is no longer active for execution; current status is ${run.status}`,
  type: 'conflict' as const,
})

const toRunCancelledExecutionError = (runId: RunId) => ({
  message: `run ${runId} was cancelled`,
  type: 'conflict' as const,
})

const getReplayFunctionCallNames = (messages: Array<{ content: AiMessageContent[] }>): string[] =>
  messages.flatMap((message) =>
    message.content.flatMap((part) => (part.type === 'function_call' ? [part.name] : [])),
  )

export const executeRunTurnLoop = async (
  context: CommandContext,
  run: RunRecord,
  overrides: RunInteractionOverrides,
): Promise<CommandResult<RunExecutionOutput>> => {
  const abortController = new AbortController()
  const activeRun = context.services.activeRuns.register({
    abortController,
    phase: 'run.starting',
    provider: null,
    responseId: null,
    rootRunId: run.rootRunId,
    runId: run.id,
  })
  let currentRun = run
  let turn = currentRun.turnCount + 1
  const finalizeCancelledRun = async (runId: RunId): Promise<CommandResult<RunExecutionOutput>> => {
    const finalized = finalizeRunCancellation(context, {
      cancelledAt: context.services.clock.nowIso(),
      db: context.db,
      reason:
        typeof abortController.signal.reason === 'string' ? abortController.signal.reason : null,
      runId,
    })

    if (!finalized.ok && finalized.error.type !== 'conflict') {
      return finalized
    }

    return convergeRunExecutionConflict(context, runId, toRunCancelledExecutionError(runId))
  }

  try {
    while (true) {
      if (abortController.signal.aborted) {
        return await finalizeCancelledRun(currentRun.id)
      }

      if (currentRun.status !== 'running') {
        return err(toInactiveRunError(currentRun))
      }

      if (turn > context.config.multiagent.maxRunTurns) {
        return failRun(context, currentRun, {
          message: `run ${currentRun.id} exceeded the configured maximum of ${context.config.multiagent.maxRunTurns} turns`,
          type: 'capacity',
        })
      }

      activeRun.update({
        phase: 'context.loading',
      })
      const preparedContext = await prepareContextState(context, currentRun)

      if (!preparedContext.ok) {
        return preparedContext
      }

      const contextFacts = await collectContextFacts(context, preparedContext.value)

      if (!contextFacts.ok) {
        return contextFacts
      }

      const threadContext = projectContextFactsToThreadContextData(contextFacts.value)
      const toolSpecs = context.services.tools
        .list(toToolContext(context, currentRun))
        .filter((tool) => isToolAllowedForRun(context.db, context.tenantScope, currentRun, tool))
      const mcpMode = resolveMcpModeForRun(context.db, context.tenantScope, currentRun)
      const mcpCatalog =
        mcpMode === 'code'
          ? buildMcpCodeModeCatalog(toToolContext(context, currentRun), toolSpecs)
          : null
      const nativeTools = isNativeToolAllowedForRun(
        context.db,
        context.tenantScope,
        currentRun,
        'web_search',
      )
        ? (['web_search'] as const)
        : []
      const manifestAttemptTurn = resolveNextContextManifestAttemptTurn(context, currentRun)

      if (!manifestAttemptTurn.ok) {
        return manifestAttemptTurn
      }

      const assembledInteraction = assembleThreadInteractionRequest({
        activeTools: toolSpecs,
        context: threadContext,
        mcpCatalog,
        mcpMode,
        nativeTools: [...nativeTools],
        overrides,
        turn: manifestAttemptTurn.value,
      })
      if (currentRun.threadId) {
        const latestBudgetSnapshot = createUsageLedgerRepository(
          context.db,
        ).getLatestThreadInteractionBudget(context.tenantScope, currentRun.threadId)

        if (!latestBudgetSnapshot.ok) {
          return latestBudgetSnapshot
        }

        assembledInteraction.bundle.budget = applyLatestBudgetCalibration(
          assembledInteraction.bundle.budget,
          latestBudgetSnapshot.value
            ? {
                latestActualInputTokens: latestBudgetSnapshot.value.inputTokens,
                latestCachedTokens: latestBudgetSnapshot.value.cachedTokens,
                latestEstimatedInputTokens: latestBudgetSnapshot.value.estimatedInputTokens,
              }
            : null,
        )
      }

      const persistedManifest = persistContextManifestAttempt(context, {
        manifest: assembledInteraction.manifest,
        mode: 'shadow',
        run: currentRun,
        turn: manifestAttemptTurn.value,
      })

      if (!persistedManifest.ok) {
        return persistedManifest
      }

      const interactionRequest = assembledInteraction.request

      interactionRequest.abortSignal = abortController.signal

      if (context.config.app.env !== 'production') {
        context.services.logger.info('Run interaction request debug', {
          functionToolNames: interactionRequest.tools?.map((tool) => tool.name) ?? [],
          messageCount: interactionRequest.messages.length,
          nativeTools: interactionRequest.nativeTools ?? [],
          provider: interactionRequest.provider ?? null,
          replayFunctionCallNames: getReplayFunctionCallNames(interactionRequest.messages),
          runId: currentRun.id,
          subsystem: 'run_execution',
          toolSpecNames: toolSpecs.map((tool) => tool.name),
          turn,
        })
      }

      activeRun.update({
        phase: 'generation.streaming',
      })
      const interaction = await streamRunInteraction(context, {
        budget: assembledInteraction.bundle.budget,
        observationCount: threadContext.observations.length,
        pendingWaitCount: threadContext.pendingWaits.length,
        request: interactionRequest,
        run: currentRun,
        summaryId: threadContext.summary?.id ?? null,
        turn,
      })

      if (!interaction.ok) {
        if (abortController.signal.aborted) {
          return await finalizeCancelledRun(currentRun.id)
        }

        const failed = failRun(context, currentRun, interaction.error)

        if (!failed.ok && failed.error.type === 'conflict') {
          return await convergeRunExecutionConflict(context, currentRun.id, failed.error)
        }

        return failed
      }

      const persistedAt = context.services.clock.nowIso()
      if (interaction.value.toolCalls.length === 0) {
        const completed = completeRunWithAssistantMessage(
          context,
          currentRun,
          interaction.value,
          persistedAt,
          assembledInteraction.bundle.budget,
        )

        if (!completed.ok) {
          if (abortController.signal.aborted) {
            return await finalizeCancelledRun(currentRun.id)
          }

          if (completed.error.type === 'conflict') {
            return await convergeRunExecutionConflict(context, currentRun.id, completed.error)
          }

          return completed
        }

        return completed
      }

      const usageResult = persistUsageEntry(
        context,
        currentRun,
        interaction.value.usage,
        interaction.value.model,
        interaction.value.provider,
        persistedAt,
        assembledInteraction.bundle.budget,
      )

      if (!usageResult.ok) {
        if (abortController.signal.aborted) {
          return await finalizeCancelledRun(currentRun.id)
        }

        if (usageResult.error.type === 'conflict') {
          return await convergeRunExecutionConflict(context, currentRun.id, usageResult.error)
        }

        return usageResult
      }

      const outputPersistence = persistOutputItems(
        context,
        currentRun,
        interaction.value,
        persistedAt,
      )

      if (!outputPersistence.ok) {
        if (abortController.signal.aborted) {
          return await finalizeCancelledRun(currentRun.id)
        }

        if (outputPersistence.error.type === 'conflict') {
          return await convergeRunExecutionConflict(context, currentRun.id, outputPersistence.error)
        }

        return outputPersistence
      }

      if (abortController.signal.aborted) {
        return await finalizeCancelledRun(currentRun.id)
      }

      const preparedToolCalls = interaction.value.toolCalls.map((toolCall) =>
        prepareToolExecution(context, toolCall),
      )
      emitProgressReported(context, context.db, currentRun, {
        detail: `Executing ${preparedToolCalls.length} tool call${preparedToolCalls.length === 1 ? '' : 's'}`,
        percent: 75,
        stage: 'tools.executing',
        turn,
      })
      const calledPersistence = persistToolCalledEvents(
        context,
        currentRun,
        preparedToolCalls,
        turn,
      )

      if (!calledPersistence.ok) {
        if (abortController.signal.aborted) {
          return await finalizeCancelledRun(currentRun.id)
        }

        if (calledPersistence.error.type === 'conflict') {
          return await convergeRunExecutionConflict(context, currentRun.id, calledPersistence.error)
        }

        return calledPersistence
      }

      activeRun.update({
        phase: 'tools.executing',
      })
      const toolStarts = await Promise.all(
        preparedToolCalls.map((toolCall) =>
          executeOneToolCall(context, currentRun, toolCall, abortController.signal),
        ),
      )
      const toolOutcomePersistence = persistToolOutcomes(context, currentRun, toolStarts, turn)

      if (!toolOutcomePersistence.ok) {
        if (abortController.signal.aborted) {
          return await finalizeCancelledRun(currentRun.id)
        }

        if (toolOutcomePersistence.error.type === 'conflict') {
          return await convergeRunExecutionConflict(
            context,
            currentRun.id,
            toolOutcomePersistence.error,
          )
        }

        return toolOutcomePersistence
      }

      if (toolOutcomePersistence.value.waitIds.length > 0) {
        emitProgressReported(context, context.db, currentRun, {
          detail: `Run is waiting on ${toolOutcomePersistence.value.waitIds.length} pending result${toolOutcomePersistence.value.waitIds.length === 1 ? '' : 's'}`,
          percent: 90,
          stage: 'run.waiting',
          turn,
        })
        const waiting = markRunWaiting(
          context,
          currentRun,
          interaction.value,
          toolOutcomePersistence.value.waits,
          toolOutcomePersistence.value.waitIds,
        )

        if (!waiting.ok && waiting.error.type === 'conflict') {
          return await convergeRunExecutionConflict(context, currentRun.id, waiting.error)
        }

        return waiting
      }

      const refreshedRun = createRunRepository(context.db).getById(
        context.tenantScope,
        currentRun.id,
      )

      if (!refreshedRun.ok) {
        return refreshedRun
      }

      if (refreshedRun.value.status !== 'running') {
        return err(toInactiveRunError(refreshedRun.value))
      }

      activeRun.update({
        phase: 'run.turn_boundary',
      })
      currentRun = refreshedRun.value
      turn += 1
    }
  } finally {
    activeRun.unregister()
  }
}
