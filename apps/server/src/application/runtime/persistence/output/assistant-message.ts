import { createSessionMessageRepository } from '../../../../adapters/persistence/sqlite/sessions/session-message-repository'
import type { AiProviderName } from '../../../../domain/ai/types'
import type { RepositoryDatabase } from '../../../../domain/database-port'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { asSessionMessageId, type SessionMessageId } from '../../../../shared/ids'
import { ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import { unwrapOrThrow } from '../../run-events'
import {
  isAiProviderName,
  isRecord,
  type PersistedAssistantTranscriptMetadata,
} from '../state/run-state-support'

interface PersistAssistantSnapshotMessageResult {
  assistantMessageId: SessionMessageId | null
  created: boolean
}

const readRunSnapshotMetadata = (
  run: RunRecord,
): {
  model: string | null
  provider: AiProviderName | null
  providerMessageId: string | null
  responseId: string | null
} => {
  if (!isRecord(run.resultJson)) {
    return {
      model: null,
      provider: null,
      providerMessageId: null,
      responseId: null,
    }
  }

  return {
    model:
      typeof run.resultJson.model === 'string' && run.resultJson.model.length > 0
        ? run.resultJson.model
        : null,
    provider: isAiProviderName(run.resultJson.provider) ? run.resultJson.provider : null,
    providerMessageId:
      typeof run.resultJson.providerMessageId === 'string' &&
      run.resultJson.providerMessageId.length > 0
        ? run.resultJson.providerMessageId
        : null,
    responseId:
      typeof run.resultJson.responseId === 'string' && run.resultJson.responseId.length > 0
        ? run.resultJson.responseId
        : null,
  }
}

export const persistAssistantSnapshotMessageInTransaction = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  input: {
    createdAt: string
    finishReason?: 'cancelled' | 'error' | 'stop' | 'waiting' | null
    outputText: string
    transcript: PersistedAssistantTranscriptMetadata | null
  },
): Result<PersistAssistantSnapshotMessageResult, DomainError> => {
  if (!run.threadId) {
    return ok({
      assistantMessageId: null,
      created: false,
    })
  }

  const existingAssistantMessageId =
    isRecord(run.resultJson) &&
    typeof run.resultJson.assistantMessageId === 'string' &&
    run.resultJson.assistantMessageId.length > 0
      ? asSessionMessageId(run.resultJson.assistantMessageId)
      : null

  if (existingAssistantMessageId) {
    return ok({
      assistantMessageId: existingAssistantMessageId,
      created: false,
    })
  }

  const outputText = input.outputText.trim()

  if (outputText.length === 0 && !input.transcript) {
    return ok({
      assistantMessageId: null,
      created: false,
    })
  }

  const sessionMessageRepository = createSessionMessageRepository(db)
  const nextMessageSequence = unwrapOrThrow(
    sessionMessageRepository.getNextSequence(context.tenantScope, run.threadId),
  )
  const snapshotMetadata = readRunSnapshotMetadata(run)
  const assistantMessageId = asSessionMessageId(context.services.ids.create('msg'))
  const metadata = {
    ...(input.finishReason ? { finishReason: input.finishReason } : {}),
    ...(snapshotMetadata.model ? { model: snapshotMetadata.model } : {}),
    ...(snapshotMetadata.provider ? { provider: snapshotMetadata.provider } : {}),
    ...(snapshotMetadata.providerMessageId
      ? { providerMessageId: snapshotMetadata.providerMessageId }
      : {}),
    ...(snapshotMetadata.responseId ? { responseId: snapshotMetadata.responseId } : {}),
    ...(input.transcript ? { transcript: input.transcript } : {}),
  }

  unwrapOrThrow(
    sessionMessageRepository.createAssistantMessage(context.tenantScope, {
      content: outputText.length > 0 ? [{ text: outputText, type: 'text' as const }] : [],
      createdAt: input.createdAt,
      id: assistantMessageId,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      runId: run.id,
      sequence: nextMessageSequence,
      sessionId: run.sessionId,
      threadId: run.threadId,
    }),
  )

  return ok({
    assistantMessageId,
    created: true,
  })
}
