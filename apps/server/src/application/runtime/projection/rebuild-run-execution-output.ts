import type { AiProviderName, AiUsage } from '../../../domain/ai/types'
import { createItemRepository } from '../../../domain/runtime/item-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import { asSessionMessageId, type ItemId } from '../../../shared/ids'
import { ok } from '../../../shared/result'
import type { CommandContext, CommandResult } from '../../commands/command-context'
import type { RunExecutionOutput, WaitingRunPendingWait } from '../persistence/run-persistence'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isAiProviderName = (value: unknown): value is AiProviderName =>
  value === 'openai' || value === 'google' || value === 'openrouter'

const toUsage = (value: unknown): AiUsage | null => {
  if (!isRecord(value)) {
    return null
  }

  const candidate = value as Partial<AiUsage>

  return {
    cachedTokens: typeof candidate.cachedTokens === 'number' ? candidate.cachedTokens : null,
    inputTokens: typeof candidate.inputTokens === 'number' ? candidate.inputTokens : null,
    outputTokens: typeof candidate.outputTokens === 'number' ? candidate.outputTokens : null,
    reasoningTokens:
      typeof candidate.reasoningTokens === 'number' ? candidate.reasoningTokens : null,
    totalTokens: typeof candidate.totalTokens === 'number' ? candidate.totalTokens : null,
  }
}

const readLatestAssistantItemId = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<ItemId | null> => {
  const items = createItemRepository(context.db).listByRunId(context.tenantScope, run.id)

  if (!items.ok) {
    return items
  }

  const assistantItem = items.value
    .slice()
    .reverse()
    .find((item) => item.type === 'message' && item.role === 'assistant')

  return ok(assistantItem?.id ?? null)
}

export const rebuildRunExecutionOutput = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<RunExecutionOutput | null> => {
  if (!isRecord(run.resultJson)) {
    return ok(null)
  }

  if (run.status === 'completed') {
    const assistantItemId = readLatestAssistantItemId(context, run)

    if (!assistantItemId.ok) {
      return assistantItemId
    }

    const model = typeof run.resultJson.model === 'string' ? run.resultJson.model : null
    const outputText =
      typeof run.resultJson.outputText === 'string' ? run.resultJson.outputText : null
    const provider = isAiProviderName(run.resultJson.provider) ? run.resultJson.provider : null

    if (!model || outputText === null || !provider) {
      return ok(null)
    }

    return ok({
      assistantItemId: assistantItemId.value,
      assistantMessageId:
        typeof run.resultJson.assistantMessageId === 'string'
          ? asSessionMessageId(run.resultJson.assistantMessageId)
          : null,
      model,
      outputText,
      provider,
      responseId: typeof run.resultJson.responseId === 'string' ? run.resultJson.responseId : null,
      runId: run.id,
      status: 'completed',
      usage: toUsage(run.resultJson.usage),
    })
  }

  if (run.status === 'waiting') {
    const model = typeof run.resultJson.model === 'string' ? run.resultJson.model : null
    const outputText =
      typeof run.resultJson.outputText === 'string' ? run.resultJson.outputText : null
    const provider = isAiProviderName(run.resultJson.provider) ? run.resultJson.provider : null
    const pendingWaits = Array.isArray(run.resultJson.pendingWaits)
      ? (run.resultJson.pendingWaits as WaitingRunPendingWait[])
      : null
    const waitIds = Array.isArray(run.resultJson.waitIds)
      ? run.resultJson.waitIds.filter((value): value is string => typeof value === 'string')
      : null

    if (!model || outputText === null || !provider || !pendingWaits || !waitIds) {
      return ok(null)
    }

    return ok({
      assistantItemId: null,
      assistantMessageId: null,
      model,
      outputText,
      pendingWaits,
      provider,
      responseId: typeof run.resultJson.responseId === 'string' ? run.resultJson.responseId : null,
      runId: run.id,
      status: 'waiting',
      usage: toUsage(run.resultJson.usage),
      waitIds,
    })
  }

  return ok(null)
}
