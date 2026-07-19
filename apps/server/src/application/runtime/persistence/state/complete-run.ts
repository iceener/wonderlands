import { createFileLinkRepository } from '../../../persistence/repositories'
import { createFileRepository } from '../../../persistence/repositories'
import { createSessionMessageRepository } from '../../../persistence/repositories'
import { withTransaction } from '../../../../db/transaction'
import type { AiInteractionResponse } from '../../../../domain/ai/types'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import { createRunRepository } from '../../../persistence/repositories'
import type { DomainError } from '../../../../shared/errors'
import { asSessionMessageId, type SessionMessageId } from '../../../../shared/ids'
import { ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import { withMessageAttachmentFileIds } from '../../../files/attachment-metadata'
import type { ContextBudgetReport } from '../../../interactions/context-bundle'
import {
  normalizeAssistantMessageContent,
  normalizeAssistantOutputText,
} from '../../../interactions/normalize-interaction-response'
import { appendDomainEvent, appendRunEvent, unwrapOrThrow } from '../../run-events'
import { emitProgressReported } from '../../run-telemetry'
import { markRunJobCompleted } from '../../scheduling/job-sync'
import { persistOutputItemsInTransaction } from '../output/persist-output-items'
import type { CompletedRunExecutionOutput } from '../run-persistence'
import { persistUsageEntryInTransaction } from '../usage/persist-usage-entry'
import {
  buildAssistantTranscriptMetadata,
  compactRunContextAtBoundary,
  toPersistenceFailure,
} from './run-state-support'

const compareAssistantAttachmentOrder = (
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
): number => {
  const createdAtDelta = left.createdAt.localeCompare(right.createdAt)

  if (createdAtDelta !== 0) {
    return createdAtDelta
  }

  return left.id.localeCompare(right.id)
}

export const completeRunWithAssistantMessage = (
  context: CommandContext,
  run: RunRecord,
  response: AiInteractionResponse,
  completedAt: string,
  budget: ContextBudgetReport,
): Result<CompletedRunExecutionOutput, DomainError> => {
  try {
    return withTransaction(context.db, (tx) => {
      const runRepository = createRunRepository(tx)
      const sessionMessageRepository = createSessionMessageRepository(tx)
      const eventStore = createEventStore(tx)
      unwrapOrThrow(
        persistUsageEntryInTransaction(
          context,
          tx,
          run,
          response.usage,
          response.model,
          response.provider,
          completedAt,
          budget,
        ),
      )
      const outputPersistence = unwrapOrThrow(
        persistOutputItemsInTransaction(context, tx, run, response, completedAt),
      )
      const assistantItemId = outputPersistence.assistantItemIds.at(-1) ?? null
      let assistantMessageId: SessionMessageId | null = null

      const assistantContent = normalizeAssistantMessageContent(response)
      const assistantOutputText = normalizeAssistantOutputText(response)
      const transcript = unwrapOrThrow(
        buildAssistantTranscriptMetadata(context, tx, run, response, completedAt),
      )
      const runFiles = unwrapOrThrow(
        createFileRepository(tx).listByRunId(context.tenantScope, run.id),
      )
      const orderedRunFiles = [...runFiles].sort(compareAssistantAttachmentOrder)
      const shouldCreateAssistantMessage = Boolean(assistantContent || runFiles.length > 0)

      if (shouldCreateAssistantMessage && run.threadId) {
        const nextMessageSequence = unwrapOrThrow(
          sessionMessageRepository.getNextSequence(context.tenantScope, run.threadId),
        )
        assistantMessageId = asSessionMessageId(context.services.ids.create('msg'))
        const assistantMessageMetadata = withMessageAttachmentFileIds(
          {
            model: response.model,
            provider: response.provider,
            providerMessageId:
              response.output.find((item) => item.type === 'message')?.providerMessageId ?? null,
            responseId: response.responseId,
            ...(transcript ? { transcript } : {}),
          },
          orderedRunFiles.map((file) => file.id),
        )
        unwrapOrThrow(
          sessionMessageRepository.createAssistantMessage(context.tenantScope, {
            content: assistantContent ?? [],
            createdAt: completedAt,
            id: assistantMessageId,
            metadata: assistantMessageMetadata,
            runId: run.id,
            sequence: nextMessageSequence,
            sessionId: run.sessionId,
            threadId: run.threadId,
          }),
        )

        appendDomainEvent(context, eventStore, {
          aggregateId: assistantMessageId,
          aggregateType: 'session_message',
          payload: {
            messageId: assistantMessageId,
            runId: run.id,
            sessionId: run.sessionId,
            threadId: run.threadId,
          },
          type: 'message.posted',
        })

        if (orderedRunFiles.length > 0) {
          const fileLinkRepo = createFileLinkRepository(tx)
          for (const file of orderedRunFiles) {
            fileLinkRepo.create(context.tenantScope, {
              createdAt: completedAt,
              fileId: file.id,
              id: context.services.ids.create('flk'),
              linkType: 'message',
              targetId: assistantMessageId,
            })
          }
        }
      }

      const completedRun = unwrapOrThrow(
        runRepository.complete(context.tenantScope, {
          completedAt,
          expectedStatus: 'running',
          expectedVersion: run.version,
          lastProgressAt: completedAt,
          resultJson: {
            assistantMessageId,
            model: response.model,
            outputText: assistantOutputText,
            provider: response.provider,
            providerRequestId: response.providerRequestId,
            responseId: response.responseId,
            ...(transcript ? { transcript } : {}),
            usage: response.usage,
          },
          runId: run.id,
          turnCount: run.turnCount,
          updatedAt: completedAt,
        }),
      )

      appendRunEvent(context, eventStore, completedRun, 'run.completed', {
        assistantMessageId,
        model: response.model,
        outputText: assistantOutputText,
        provider: response.provider,
        providerRequestId: response.providerRequestId,
        responseId: response.responseId,
        usage: response.usage,
      })
      unwrapOrThrow(
        markRunJobCompleted(tx, context.tenantScope, completedRun, {
          completedAt,
          eventContext: {
            eventStore,
            traceId: context.traceId,
          },
          resultJson: completedRun.resultJson,
        }),
      )
      emitProgressReported(context, tx, completedRun, {
        detail: 'Run completed successfully',
        percent: 100,
        stage: 'run.completed',
        turn: completedRun.turnCount,
      })

      unwrapOrThrow(compactRunContextAtBoundary(context, tx, completedRun))

      return ok({
        assistantItemId,
        assistantMessageId,
        model: response.model,
        outputText: assistantOutputText,
        provider: response.provider,
        responseId: response.responseId,
        runId: run.id,
        status: 'completed',
        usage: response.usage,
      })
    })
  } catch (error) {
    return toPersistenceFailure(error, 'failed to complete run with assistant message')
  }
}
