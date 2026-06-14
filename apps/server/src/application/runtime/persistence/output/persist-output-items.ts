import { withTransaction } from '../../../../db/transaction'
import type { AiInteractionResponse, AiOutputItem } from '../../../../domain/ai/types'
import type { RepositoryDatabase } from '../../../../domain/database-port'
import { createItemRepository } from '../../../../domain/runtime/item-repository'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { asItemId, type ItemId } from '../../../../shared/ids'
import { ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import { assertRunSnapshotCurrent } from '../../run-concurrency'
import { unwrapOrThrow } from '../../run-events'
import { toPersistenceFailure } from '../state/run-state-support'

const getPersistedOutputItems = (response: AiInteractionResponse): AiOutputItem[] => {
  if (Array.isArray(response.output)) {
    return response.output
  }

  const output: AiOutputItem[] = []

  for (const message of response.messages) {
    if (message.role !== 'assistant') {
      continue
    }

    output.push({
      content: message.content,
      phase: message.phase,
      role: 'assistant',
      type: 'message',
    })
  }

  for (const toolCall of response.toolCalls) {
    output.push({
      ...toolCall,
      type: 'function_call',
    })
  }

  return output
}

export const persistOutputItems = (
  context: CommandContext,
  run: RunRecord,
  response: AiInteractionResponse,
  createdAt: string,
): Result<{ assistantItemIds: ItemId[] }, DomainError> => {
  try {
    return withTransaction(context.db, (tx) =>
      persistOutputItemsInTransaction(context, tx, run, response, createdAt),
    )
  } catch (error) {
    return toPersistenceFailure(error, 'failed to persist output items')
  }
}

export const persistOutputItemsInTransaction = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  response: AiInteractionResponse,
  createdAt: string,
): Result<{ assistantItemIds: ItemId[] }, DomainError> => {
  unwrapOrThrow(assertRunSnapshotCurrent(db, context.tenantScope, run))

  const itemRepository = createItemRepository(db)
  let nextSequence = unwrapOrThrow(itemRepository.getNextSequence(context.tenantScope, run.id))
  const assistantItemIds: ItemId[] = []

  for (const outputItem of getPersistedOutputItems(response)) {
    if (outputItem.type === 'message') {
      const textContent = outputItem.content.reduce<
        Array<{
          text: string
          thought?: boolean
          thoughtSignature?: string
          type: 'text'
        }>
      >((parts, part) => {
        if (part.type === 'text') {
          parts.push({
            ...(part.thought === true ? { thought: true } : {}),
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
            text: part.text,
            type: 'text',
          })
        }

        return parts
      }, [])

      if (textContent.length === 0) {
        continue
      }

      const itemId = asItemId(context.services.ids.create('itm'))
      unwrapOrThrow(
        itemRepository.createMessage(context.tenantScope, {
          content: textContent,
          createdAt,
          id: itemId,
          providerPayload: {
            phase: outputItem.phase ?? null,
            provider: response.provider,
            providerMessageId: outputItem.providerMessageId ?? null,
            responseId: response.responseId,
          },
          role: 'assistant',
          runId: run.id,
          sequence: nextSequence,
        }),
      )
      assistantItemIds.push(itemId)
      nextSequence += 1
      continue
    }

    if (outputItem.type === 'reasoning') {
      const itemId = asItemId(context.services.ids.create('itm'))
      unwrapOrThrow(
        itemRepository.createReasoning(context.tenantScope, {
          createdAt,
          id: itemId,
          providerPayload: {
            encryptedContent: outputItem.encryptedContent ?? null,
            providerItemId: outputItem.id,
            provider: response.provider,
            responseId: response.responseId,
          },
          runId: run.id,
          sequence: nextSequence,
          summary: outputItem.summary,
        }),
      )
      nextSequence += 1
      continue
    }

    if (outputItem.type === 'function_call') {
      const itemId = asItemId(context.services.ids.create('itm'))
      unwrapOrThrow(
        itemRepository.createFunctionCall(context.tenantScope, {
          argumentsJson: outputItem.argumentsJson,
          callId: outputItem.callId,
          createdAt,
          id: itemId,
          name: outputItem.name,
          providerPayload: {
            provider: response.provider,
            providerItemId: outputItem.providerItemId ?? null,
            providerSignature: outputItem.providerSignature ?? null,
            responseId: response.responseId,
            thoughtSignature: outputItem.thoughtSignature ?? null,
          },
          runId: run.id,
          sequence: nextSequence,
        }),
      )
      nextSequence += 1
    }
  }

  return ok({ assistantItemIds })
}
