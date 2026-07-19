import { createSessionMessageRepository } from '../../persistence/repositories'
import { withTransaction } from '../../../db/transaction'
import type { ItemRecord } from '../../../domain/runtime/item-repository'
import { createItemRepository } from '../../persistence/repositories'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { SessionMessageRecord } from '../../../domain/sessions/session-message-repository'
import type { DomainError } from '../../../shared/errors'
import type { RunId } from '../../../shared/ids'
import { asItemId } from '../../../shared/ids'
import { err, ok, type Result } from '../../../shared/result'
import type { CommandContext, CommandResult } from '../../commands/command-context'

const SESSION_MESSAGE_PROJECTION_SOURCE = 'session_message_projection'

interface ProjectedItemProviderPayload {
  providerMessageId?: string | null
  responseId?: string | null
  sessionMessageId?: string | null
  sourceItemId?: string | null
  sourceRunId?: string | null
  source?: string | null
}

export const toProjectedItemRole = (
  authorKind: SessionMessageRecord['authorKind'],
): 'assistant' | 'system' | 'user' | null => {
  switch (authorKind) {
    case 'assistant':
      return 'assistant'
    case 'system':
      return 'system'
    case 'user':
      return 'user'
    case 'tool':
      return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readProjectedProviderPayload = (value: unknown): ProjectedItemProviderPayload | null =>
  isRecord(value) ? value : null

const isSessionMessageProjectionPayload = (
  payload: ProjectedItemProviderPayload | null,
): payload is ProjectedItemProviderPayload => payload?.source === SESSION_MESSAGE_PROJECTION_SOURCE

const readProjectedSessionMessageId = (item: ItemRecord): string | null => {
  if (item.type !== 'message') {
    return null
  }

  const payload = readProjectedProviderPayload(item.providerPayload)
  return isSessionMessageProjectionPayload(payload) &&
    typeof payload.sessionMessageId === 'string' &&
    payload.sessionMessageId.length > 0
    ? payload.sessionMessageId
    : null
}

const isProjectedStructuredItem = (item: ItemRecord): boolean => {
  if (item.type === 'message') {
    return false
  }

  const payload = readProjectedProviderPayload(item.providerPayload)

  return (
    isSessionMessageProjectionPayload(payload) &&
    typeof payload.sourceItemId === 'string' &&
    payload.sourceItemId.length > 0 &&
    typeof payload.sourceRunId === 'string' &&
    payload.sourceRunId.length > 0
  )
}

const isProjectionOnlyThreadContext = (items: ItemRecord[]): boolean => {
  if (items.length === 0) {
    return true
  }

  let projectedMessageCount = 0

  for (const item of items) {
    if (item.type === 'message') {
      if (!readProjectedSessionMessageId(item)) {
        return false
      }

      projectedMessageCount += 1
      continue
    }

    if (item.type === 'reasoning') {
      continue
    }

    if (
      (item.type === 'function_call' || item.type === 'function_call_output') &&
      isProjectedStructuredItem(item)
    ) {
      continue
    }

    return false
  }

  return projectedMessageCount > 0
}

const toProjectedStructuredProviderPayload = (sourceItem: ItemRecord): unknown => {
  const payload = readProjectedProviderPayload(sourceItem.providerPayload)

  return {
    ...(payload ?? {}),
    source: SESSION_MESSAGE_PROJECTION_SOURCE,
    sourceItemId: sourceItem.id,
    sourceRunId: sourceItem.runId,
  }
}

const findMatchedAssistantSourceItem = (
  message: SessionMessageRecord,
  sourceItems: ItemRecord[],
): ItemRecord | null => {
  if (message.authorKind !== 'assistant') {
    return null
  }

  const metadata = message.metadata as {
    responseId?: string | null
    providerMessageId?: string | null
  } | null

  const assistantSourceItems = sourceItems.filter(
    (sourceItem) =>
      sourceItem.type === 'message' &&
      sourceItem.role === 'assistant' &&
      Boolean(sourceItem.content && sourceItem.content.length > 0),
  )

  if (assistantSourceItems.length === 0) {
    return null
  }

  if (metadata?.providerMessageId) {
    const matchedByProviderMessageId = assistantSourceItems.find((sourceItem) => {
      const sourceProviderPayload = readProjectedProviderPayload(sourceItem.providerPayload)
      return sourceProviderPayload?.providerMessageId === metadata.providerMessageId
    })

    if (matchedByProviderMessageId) {
      return matchedByProviderMessageId
    }
  }

  if (metadata?.responseId) {
    const responseMatches = assistantSourceItems.filter((sourceItem) => {
      const sourceProviderPayload = readProjectedProviderPayload(sourceItem.providerPayload)
      return sourceProviderPayload?.responseId === metadata.responseId
    })

    if (responseMatches.length === 1) {
      return responseMatches[0] ?? null
    }

    const matchedByContent = responseMatches.find((sourceItem) =>
      sourceItem.content?.some((part) =>
        message.content.some((messagePart) => messagePart.text === part.text),
      ),
    )

    if (matchedByContent) {
      return matchedByContent
    }
  }

  const matchedByText = assistantSourceItems.find((sourceItem) =>
    sourceItem.content?.some((part) =>
      message.content.some((messagePart) => messagePart.text === part.text),
    ),
  )

  return matchedByText ?? null
}

const listGeneratedTailSourceItems = (sourceItems: ItemRecord[]): ItemRecord[] => {
  const lastProjectedMessageIndex = sourceItems.reduce(
    (lastIndex, item, index) => (readProjectedSessionMessageId(item) ? index : lastIndex),
    -1,
  )

  return sourceItems.slice(lastProjectedMessageIndex + 1)
}

export const projectVisibleMessagesToRunItems = (
  context: CommandContext,
  input: {
    existingItems?: ItemRecord[]
    messages: SessionMessageRecord[]
    runId: RunId
  },
): CommandResult<null> =>
  withTransaction(context.db, (tx) => {
    const itemRepository = createItemRepository(tx)
    const sourceRunItems = new Map<RunId, ItemRecord[]>()
    const existingItems = input.existingItems ?? []
    const projectedSessionMessageIds = new Set<string>()
    const replayedAssistantSourceItemIds = new Set<string>()
    let sequence = (existingItems.at(-1)?.sequence ?? 0) + 1

    for (const existingItem of existingItems) {
      const sessionMessageId = readProjectedSessionMessageId(existingItem)

      if (sessionMessageId) {
        projectedSessionMessageIds.add(sessionMessageId)
      }
    }

    const getSourceRunItems = (sourceRunId: RunId): Result<ItemRecord[], DomainError> => {
      const cached = sourceRunItems.get(sourceRunId)

      if (cached) {
        return ok(cached)
      }

      const sourceItemsResult = itemRepository.listByRunId(context.tenantScope, sourceRunId)

      if (!sourceItemsResult.ok) {
        return sourceItemsResult
      }

      sourceRunItems.set(sourceRunId, sourceItemsResult.value)

      return sourceItemsResult
    }

    for (const message of input.messages) {
      if (projectedSessionMessageIds.has(message.id)) {
        continue
      }

      const role = toProjectedItemRole(message.authorKind)

      if (!role || message.content.length === 0) {
        continue
      }

      const metadata = message.metadata as {
        responseId?: string | null
        providerMessageId?: string | null
      } | null

      const responseId =
        typeof metadata?.responseId === 'string' && metadata.responseId.length > 0
          ? metadata.responseId
          : null

      let projectedContent = message.content

      if (role === 'assistant' && message.runId) {
        const sourceItemsResult = getSourceRunItems(message.runId)

        if (!sourceItemsResult.ok) {
          return sourceItemsResult
        }

        const sourceItems = sourceItemsResult.value
        const matchedSourceItem = findMatchedAssistantSourceItem(message, sourceItems)

        if (matchedSourceItem && !replayedAssistantSourceItemIds.has(matchedSourceItem.id)) {
          const generatedTail = listGeneratedTailSourceItems(sourceItems)
          const replayItems = generatedTail.filter((sourceItem) => {
            if (sourceItem.sequence >= matchedSourceItem.sequence) {
              return false
            }

            return (
              sourceItem.type === 'reasoning' ||
              sourceItem.type === 'function_call' ||
              sourceItem.type === 'function_call_output'
            )
          })

          for (const sourceItem of replayItems) {
            if (sourceItem.type === 'reasoning') {
              const reasoningResult = itemRepository.createReasoning(context.tenantScope, {
                createdAt: sourceItem.createdAt,
                id: asItemId(context.services.ids.create('itm')),
                providerPayload: toProjectedStructuredProviderPayload(sourceItem),
                runId: input.runId,
                sequence,
                summary: sourceItem.summary,
              })

              if (!reasoningResult.ok) {
                return reasoningResult
              }

              sequence += 1
              continue
            }

            if (
              sourceItem.type === 'function_call' &&
              sourceItem.callId &&
              sourceItem.name &&
              sourceItem.arguments
            ) {
              const functionCallResult = itemRepository.createFunctionCall(context.tenantScope, {
                argumentsJson: sourceItem.arguments,
                callId: sourceItem.callId,
                createdAt: sourceItem.createdAt,
                id: asItemId(context.services.ids.create('itm')),
                name: sourceItem.name,
                providerPayload: toProjectedStructuredProviderPayload(sourceItem),
                runId: input.runId,
                sequence,
              })

              if (!functionCallResult.ok) {
                return functionCallResult
              }

              sequence += 1
              continue
            }

            if (
              sourceItem.type === 'function_call_output' &&
              sourceItem.callId &&
              sourceItem.output
            ) {
              const functionCallOutputResult = itemRepository.createFunctionCallOutput(
                context.tenantScope,
                {
                  callId: sourceItem.callId,
                  createdAt: sourceItem.createdAt,
                  id: asItemId(context.services.ids.create('itm')),
                  output: sourceItem.output,
                  providerPayload: toProjectedStructuredProviderPayload(sourceItem),
                  runId: input.runId,
                  sequence,
                },
              )

              if (!functionCallOutputResult.ok) {
                return functionCallOutputResult
              }

              sequence += 1
            }
          }

          replayedAssistantSourceItemIds.add(matchedSourceItem.id)
        }

        if (matchedSourceItem?.content && matchedSourceItem.content.length > 0) {
          projectedContent = matchedSourceItem.content
        }
      }

      const itemId = asItemId(context.services.ids.create('itm'))
      const itemResult = itemRepository.createMessage(context.tenantScope, {
        content: projectedContent,
        createdAt: message.createdAt,
        id: itemId,
        providerPayload: {
          providerMessageId: metadata?.providerMessageId ?? null,
          responseId,
          sessionMessageId: message.id,
          source: SESSION_MESSAGE_PROJECTION_SOURCE,
        },
        role,
        runId: input.runId,
        sequence,
      })

      if (!itemResult.ok) {
        return itemResult
      }

      sequence += 1
    }

    return ok(null)
  })

export const listVisibleMessages = (
  context: CommandContext,
  run: RunRecord,
): Result<SessionMessageRecord[], DomainError> => {
  if (!run.threadId) {
    return run.parentRunId !== null
      ? ok([])
      : err({
          message: `run ${run.id} is missing a thread binding`,
          type: 'conflict',
        })
  }

  const sessionMessageRepository = createSessionMessageRepository(context.db)
  return sessionMessageRepository.listByThreadId(context.tenantScope, run.threadId)
}

export const listRunItems = (
  context: CommandContext,
  runId: RunId,
): Result<ItemRecord[], DomainError> =>
  createItemRepository(context.db).listByRunId(context.tenantScope, runId)

export const ensureProjectedThreadContext = (
  context: CommandContext,
  run: RunRecord,
  visibleMessages: SessionMessageRecord[],
): Result<ItemRecord[], DomainError> => {
  const existingItems = listRunItems(context, run.id)

  if (!existingItems.ok) {
    return existingItems
  }

  if (!isProjectionOnlyThreadContext(existingItems.value)) {
    return existingItems
  }

  const projection = projectVisibleMessagesToRunItems(context, {
    existingItems: existingItems.value,
    messages: visibleMessages,
    runId: run.id,
  })

  if (!projection.ok) {
    return projection
  }

  return listRunItems(context, run.id)
}
