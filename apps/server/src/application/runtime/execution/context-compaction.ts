import type { AppConfig } from '../../../app/config'
import type { RepositoryDatabase } from '../../../domain/database-port'
import {
  type ContextSummaryRecord,
  createContextSummaryRepository,
} from '../../../domain/runtime/context-summary-repository'
import type { ItemRecord } from '../../../domain/runtime/item-repository'
import type { RunDependencyRecord } from '../../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { DomainError } from '../../../shared/errors'
import { ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'
import { toItemMessages, toTextContent } from '../../interactions/build-run-interaction-request'
import { estimateMessageTokens } from '../../interactions/context-bundle'
import { resolveContextWindowForModel } from '../../system/models-catalog'

const SUMMARY_MODEL_KEY = 'main_thread_compaction_v1'
const SUMMARY_TEXT_LIMIT = 160
const SUMMARY_LINE_LIMIT = 12

interface ContextCompactionDeps {
  config: Pick<AppConfig, 'ai' | 'memory'>
  createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  db: RepositoryDatabase
  nowIso: () => string
  scope: TenantScope
}

const truncate = (value: string): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()

  if (normalized.length <= SUMMARY_TEXT_LIMIT) {
    return normalized
  }

  return `${normalized.slice(0, SUMMARY_TEXT_LIMIT - 1)}…`
}

const summarizeHeadItems = (items: ItemRecord[]): string => {
  const functionCallNames = new Map<string, string>()

  for (const item of items) {
    if (item.type === 'function_call' && item.callId && item.name) {
      functionCallNames.set(item.callId, item.name)
    }
  }

  const lines: string[] = []

  for (const item of items) {
    if (lines.length >= SUMMARY_LINE_LIMIT) {
      break
    }

    if (item.type === 'message' && item.role && item.content && item.content.length > 0) {
      const text = truncate(item.content.map((part) => part.text).join(' '))

      if (text.length > 0) {
        lines.push(`${item.role}: ${text}`)
      }

      continue
    }

    if (item.type === 'function_call' && item.callId && item.name && item.arguments) {
      lines.push(`tool_call ${item.name}: ${truncate(item.arguments)}`)
      continue
    }

    if (item.type === 'function_call_output' && item.callId && item.output) {
      const providerPayload = item.providerPayload as {
        name?: string | null
      } | null
      const name = providerPayload?.name ?? functionCallNames.get(item.callId) ?? item.callId

      lines.push(`tool_result ${name}: ${truncate(item.output)}`)
      continue
    }

    if (item.type === 'reasoning' && item.summary) {
      lines.push(`reasoning: ${truncate(JSON.stringify(item.summary))}`)
    }
  }

  if (lines.length === 0) {
    return ''
  }

  if (items.length > lines.length) {
    lines.push(`... ${items.length - lines.length} earlier items compacted`)
  }

  return `Summary of earlier main-thread context:\n${lines.map((line) => `- ${line}`).join('\n')}`
}

const toSummaryMessageTokens = (content: string): number =>
  estimateMessageTokens({
    content: [toTextContent(content)],
    role: 'developer',
  })

const getItemTokenCount = (item: ItemRecord): number => {
  const messages = toItemMessages([item])

  if (messages.length === 0) {
    return 0
  }

  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
}

const findFunctionCallIndex = (items: ItemRecord[], callId: string): number =>
  items.findIndex((item) => item.type === 'function_call' && item.callId === callId)

const findFunctionResultIndex = (items: ItemRecord[], callId: string): number =>
  items.findIndex((item) => item.type === 'function_call_output' && item.callId === callId)

const adjustTailStartForBoundaries = (
  items: ItemRecord[],
  initialTailStart: number,
  pendingWaits: RunDependencyRecord[],
): number => {
  let tailStart = initialTailStart
  const pendingWaitCallIds = new Set(pendingWaits.map((wait) => wait.callId))
  let changed = true

  while (changed) {
    changed = false

    for (const callId of pendingWaitCallIds) {
      const callIndex = findFunctionCallIndex(items, callId)

      if (callIndex >= 0 && callIndex < tailStart) {
        tailStart = callIndex
        changed = true
      }
    }

    for (let index = tailStart; index < items.length; index += 1) {
      const item = items[index]

      if (item?.type !== 'function_call_output' || !item.callId) {
        continue
      }

      const callIndex = findFunctionCallIndex(items, item.callId)

      if (callIndex >= 0 && callIndex < tailStart) {
        tailStart = callIndex
        changed = true
      }
    }

    for (let index = 0; index < tailStart; index += 1) {
      const item = items[index]

      if (item?.type !== 'function_call' || !item.callId) {
        continue
      }

      const resultIndex = findFunctionResultIndex(items, item.callId)

      if (resultIndex >= tailStart) {
        tailStart = index
        changed = true
      }
    }
  }

  return tailStart
}

const computeTailStart = (
  items: ItemRecord[],
  pendingWaits: RunDependencyRecord[],
  activeTailTokenTarget: number,
): number => {
  if (items.length <= 1) {
    return 0
  }

  let tailStart = items.length - 1
  let tailTokens = getItemTokenCount(items[tailStart]!)

  for (let index = items.length - 2; index >= 0; index -= 1) {
    const nextTokens = getItemTokenCount(items[index]!)

    if (tailTokens + nextTokens > activeTailTokenTarget) {
      break
    }

    tailTokens += nextTokens
    tailStart = index
  }

  return adjustTailStartForBoundaries(items, tailStart, pendingWaits)
}

const getUnsummarizedItems = (
  items: ItemRecord[],
  latestSummary: ContextSummaryRecord | null,
): ItemRecord[] => {
  if (!latestSummary) {
    return items
  }

  return items.filter((item) => item.sequence > latestSummary.throughSequence)
}

const shouldCompact = (
  items: ItemRecord[],
  thresholds: {
    rawInputTokenThreshold: number
    rawItemThreshold: number
  },
): boolean => {
  if (items.length > thresholds.rawItemThreshold) {
    return true
  }

  const rawTokens = toItemMessages(items).reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  )

  return rawTokens > thresholds.rawInputTokenThreshold
}

const resolveCompactionThresholds = (
  config: Pick<AppConfig, 'ai' | 'memory'>,
  run: RunRecord,
): {
  activeTailTokenTarget: number
  rawInputTokenThreshold: number
  rawItemThreshold: number
} => {
  const configuredModel =
    typeof run.configSnapshot.model === 'string' && run.configSnapshot.model.length > 0
      ? run.configSnapshot.model
      : config.ai.defaults.model
  const contextWindow = resolveContextWindowForModel(configuredModel)
  const rawInputTokenThreshold = Math.max(
    1,
    Math.floor(contextWindow * config.memory.compaction.triggerRatio),
  )

  return {
    activeTailTokenTarget: Math.max(
      1,
      Math.floor(rawInputTokenThreshold * config.memory.compaction.tailRatio),
    ),
    rawInputTokenThreshold,
    rawItemThreshold: config.memory.compaction.rawItemThreshold,
  }
}

export const maybeCompactMainThreadContext = (
  deps: ContextCompactionDeps,
  run: RunRecord,
  items: ItemRecord[],
  pendingWaits: RunDependencyRecord[],
): Result<ContextSummaryRecord | null, DomainError> => {
  if (run.parentRunId !== null) {
    return ok(null)
  }

  const summaryRepository = createContextSummaryRepository(deps.db)
  const latestSummary = summaryRepository.getLatestByRunId(deps.scope, run.id)

  if (!latestSummary.ok) {
    return latestSummary
  }

  const unsummarizedItems = getUnsummarizedItems(items, latestSummary.value)
  const compactionThresholds = resolveCompactionThresholds(deps.config, run)

  if (!shouldCompact(unsummarizedItems, compactionThresholds)) {
    return ok(latestSummary.value)
  }

  const tailStart = computeTailStart(
    unsummarizedItems,
    pendingWaits,
    compactionThresholds.activeTailTokenTarget,
  )

  if (tailStart <= 0) {
    return ok(latestSummary.value)
  }

  const headItems = unsummarizedItems.slice(0, tailStart)
  const content = summarizeHeadItems(headItems)

  if (content.length === 0) {
    return ok(latestSummary.value)
  }

  const tokensBefore = toItemMessages(headItems).reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  )
  const tokensAfter = toSummaryMessageTokens(content)

  if (tokensAfter >= tokensBefore) {
    return ok(latestSummary.value)
  }

  return summaryRepository.create(deps.scope, {
    content,
    createdAt: deps.nowIso(),
    fromSequence: headItems[0]!.sequence,
    id: deps.createId('sum'),
    modelKey: SUMMARY_MODEL_KEY,
    previousSummaryId: latestSummary.value?.id ?? null,
    runId: run.id,
    throughSequence: headItems.at(-1)!.sequence,
    tokensAfter,
    tokensBefore,
    turnNumber: run.turnCount,
  })
}
