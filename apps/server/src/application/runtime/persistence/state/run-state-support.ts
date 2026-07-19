import { flattenReasoningSummaryText } from '../../../../domain/ai/reasoning-summary'
import type {
  AiInteractionResponse,
  AiProviderName,
  AiWebReference,
} from '../../../../domain/ai/types'
import type { RepositoryDatabase } from '../../../../db/repository-database'
import type { DomainEventEnvelope } from '../../../../domain/events/domain-event'
import { createDomainEventRepository } from '../../../../adapters/persistence/sqlite/events/domain-event-repository'
import { createItemRepository } from '../../../../adapters/persistence/sqlite/runtime/item-repository'
import { createRunDependencyRepository } from '../../../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import { createRunRepository } from '../../../../adapters/persistence/sqlite/runtime/run-repository'
import { type DomainError, DomainErrorException } from '../../../../shared/errors'
import { asRunId } from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import { maybeCompactMainThreadContext } from '../../execution/context-compaction'
import { toToolArgs } from '../../tool-execution-persistence'

interface PersistedAssistantToolApprovalMetadata {
  description: string | null
  remembered: boolean | null
  status: 'approved' | 'rejected'
  targetRef: string | null
  waitId: string
}

interface PersistedAssistantToolAppsMetaMetadata {
  csp?: Record<string, unknown> | null
  permissions?: Record<string, unknown> | null
  resourceUri: string
  serverId: string
}

interface PersistedAssistantToolBlockMetadata {
  args: Record<string, unknown> | null
  approval?: PersistedAssistantToolApprovalMetadata
  appsMeta?: PersistedAssistantToolAppsMetaMetadata | null
  childRunId?: string
  confirmation?: {
    description: string | null
    targetRef: string | null
    waitId: string
  }
  createdAt: string
  finishedAt?: string
  id: string
  name: string
  output?: unknown
  sourceRunId?: string
  status: 'running' | 'awaiting_confirmation' | 'complete' | 'error'
  toolCallId: string
  type: 'tool_interaction'
}

interface PersistedAssistantThinkingBlockMetadata {
  content: string
  createdAt: string
  id: string
  sourceRunId?: string
  status: 'thinking' | 'done'
  title: string
  type: 'thinking'
}

interface PersistedAssistantTextBlockMetadata {
  content: string
  createdAt: string
  id: string
  sourceRunId?: string
  type: 'text'
}

interface PersistedAssistantWebSearchBlockMetadata {
  createdAt: string
  finishedAt?: string
  id: string
  patterns: string[]
  provider: AiProviderName
  queries: string[]
  references: AiWebReference[]
  responseId: string | null
  searchId: string
  sourceRunId?: string
  status: 'in_progress' | 'searching' | 'completed' | 'failed'
  targetUrls: string[]
  type: 'web_search'
}

type PersistedAssistantTranscriptBlockMetadata =
  | PersistedAssistantThinkingBlockMetadata
  | PersistedAssistantTextBlockMetadata
  | PersistedAssistantToolBlockMetadata
  | PersistedAssistantWebSearchBlockMetadata

type RunTranscriptEvent = DomainEventEnvelope<unknown> & { eventNo: number }

export interface PersistedAssistantTranscriptMetadata {
  blocks: PersistedAssistantTranscriptBlockMetadata[]
  toolBlocks: PersistedAssistantToolBlockMetadata[]
  webSearchBlocks: PersistedAssistantWebSearchBlockMetadata[]
  version: 2
}

const isFailedSandboxOutcome = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { sandboxExecutionId?: unknown }).sandboxExecutionId === 'string' &&
  ((value as { status?: unknown }).status === 'failed' ||
    (value as { status?: unknown }).status === 'cancelled')

const toPersistedAppsMeta = (
  value: unknown,
): PersistedAssistantToolAppsMetaMetadata | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.resourceUri !== 'string' ||
    candidate.resourceUri.trim().length === 0 ||
    typeof candidate.serverId !== 'string' ||
    candidate.serverId.trim().length === 0
  ) {
    return undefined
  }

  return {
    ...(typeof candidate.csp === 'object' && candidate.csp !== null && !Array.isArray(candidate.csp)
      ? { csp: candidate.csp as Record<string, unknown> }
      : {}),
    ...(typeof candidate.permissions === 'object' &&
    candidate.permissions !== null &&
    !Array.isArray(candidate.permissions)
      ? { permissions: candidate.permissions as Record<string, unknown> }
      : {}),
    resourceUri: candidate.resourceUri,
    serverId: candidate.serverId,
  }
}

const dedupeStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isAiProviderName = (value: unknown): value is AiProviderName =>
  value === 'openai' || value === 'google' || value === 'openrouter'

const dedupeWebReferences = (references: AiWebReference[]): AiWebReference[] => {
  const byUrl = new Map<string, AiWebReference>()

  for (const reference of references) {
    const existing = byUrl.get(reference.url)

    if (!existing) {
      byUrl.set(reference.url, reference)
      continue
    }

    byUrl.set(reference.url, {
      domain: existing.domain ?? reference.domain,
      title: existing.title ?? reference.title,
      url: reference.url,
    })
  }

  return [...byUrl.values()]
}

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const toPersistedWebReferences = (value: unknown): AiWebReference[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return dedupeWebReferences(
    value.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return []
      }

      const reference = entry as Partial<AiWebReference>

      if (typeof reference.url !== 'string' || reference.url.length === 0) {
        return []
      }

      return [
        {
          domain: typeof reference.domain === 'string' ? reference.domain : null,
          title: typeof reference.title === 'string' ? reference.title : null,
          url: reference.url,
        },
      ]
    }),
  )
}

const toPersistedWebSearchStatus = (
  value: unknown,
): PersistedAssistantWebSearchBlockMetadata['status'] =>
  value === 'failed' || value === 'completed' || value === 'searching' || value === 'in_progress'
    ? value
    : 'in_progress'

const mergePersistedWebSearchStatus = (
  current: PersistedAssistantWebSearchBlockMetadata['status'],
  next: PersistedAssistantWebSearchBlockMetadata['status'],
): PersistedAssistantWebSearchBlockMetadata['status'] => {
  const rank: Record<PersistedAssistantWebSearchBlockMetadata['status'], number> = {
    in_progress: 0,
    searching: 1,
    completed: 2,
    failed: 3,
  }

  return rank[next] >= rank[current] ? next : current
}

const listRunTranscriptEvents = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  category: 'all' | 'telemetry' = 'all',
): Result<RunTranscriptEvent[], DomainError> =>
  createDomainEventRepository(db).listAfterCursor(context.tenantScope, {
    category,
    runId: run.id,
  })

const buildOutputTextFromTranscriptEvents = (events: RunTranscriptEvent[]): string => {
  let outputText = ''

  for (const event of events) {
    if (event.type === 'stream.delta') {
      const payload =
        typeof event.payload === 'object' && event.payload !== null
          ? (event.payload as Record<string, unknown>)
          : null

      if (payload && typeof payload.delta === 'string') {
        outputText += payload.delta
      }

      continue
    }

    if (outputText.length > 0) {
      continue
    }

    if (event.type === 'stream.done' || event.type === 'generation.completed') {
      const payload =
        typeof event.payload === 'object' && event.payload !== null
          ? (event.payload as Record<string, unknown>)
          : null

      if (payload && typeof payload.text === 'string' && payload.text.length > 0) {
        outputText = payload.text
        continue
      }

      if (payload && typeof payload.outputText === 'string' && payload.outputText.length > 0) {
        outputText = payload.outputText
      }
    }
  }

  return outputText
}

const compareTranscriptBlockOrder = (
  left: Pick<PersistedAssistantTranscriptBlockMetadata, 'createdAt' | 'id'>,
  right: Pick<PersistedAssistantTranscriptBlockMetadata, 'createdAt' | 'id'>,
): number => {
  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime) || leftTime === rightTime) {
    return left.id.localeCompare(right.id)
  }

  return leftTime - rightTime
}

export const readRunOutputText = (run: RunRecord): string => {
  if (!run.resultJson || typeof run.resultJson !== 'object') {
    return ''
  }

  const candidate = run.resultJson as {
    outputText?: unknown
  }

  return typeof candidate.outputText === 'string' ? candidate.outputText : ''
}

const collectAssistantTranscriptBlocks = (
  context: CommandContext,
  db: RepositoryDatabase,
  input: {
    persistTextBlocks: boolean
    response: AiInteractionResponse | null
    run: RunRecord
    sourceRunId?: string
    visitedRunIds: Set<string>
  },
): Result<PersistedAssistantTranscriptBlockMetadata[], DomainError> => {
  const currentRunId = String(input.run.id)
  if (input.visitedRunIds.has(currentRunId)) {
    return ok([])
  }

  input.visitedRunIds.add(currentRunId)

  const transcriptEvents = listRunTranscriptEvents(context, db, input.run, 'all')

  if (!transcriptEvents.ok) {
    return transcriptEvents
  }

  const runRepository = createRunRepository(db)
  const childRuns = runRepository.listByParentRunId(context.tenantScope, input.run.id)

  if (!childRuns.ok) {
    return childRuns
  }

  const childRunsBySourceCallId = new Map<string, RunRecord>()
  for (const childRun of childRuns.value) {
    if (!childRun.sourceCallId || childRunsBySourceCallId.has(childRun.sourceCallId)) {
      continue
    }

    childRunsBySourceCallId.set(childRun.sourceCallId, childRun)
  }

  const blocks: PersistedAssistantTranscriptBlockMetadata[] = []
  const thinkingById = new Map<string, PersistedAssistantThinkingBlockMetadata>()
  const toolByCallId = new Map<string, PersistedAssistantToolBlockMetadata>()
  const webSearchById = new Map<string, PersistedAssistantWebSearchBlockMetadata>()
  let currentTextBlock: PersistedAssistantTextBlockMetadata | null = null

  const toPayloadRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

  const closeTextBlock = () => {
    currentTextBlock = null
  }

  const ensureThinkingBlock = (
    itemId: string,
    createdAt: string,
  ): PersistedAssistantThinkingBlockMetadata => {
    const existing = thinkingById.get(itemId)

    if (existing) {
      return existing
    }

    const next: PersistedAssistantThinkingBlockMetadata = {
      content: '',
      createdAt,
      id: `thinking:${itemId}`,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      status: 'thinking',
      title: 'Reasoning',
      type: 'thinking',
    }
    thinkingById.set(itemId, next)
    blocks.push(next)
    return next
  }

  const ensureTextBlock = (
    eventNo: number,
    createdAt: string,
  ): PersistedAssistantTextBlockMetadata | null => {
    if (!input.persistTextBlocks) {
      return null
    }

    if (currentTextBlock) {
      return currentTextBlock
    }

    const next: PersistedAssistantTextBlockMetadata = {
      content: '',
      createdAt,
      id: `text:${input.sourceRunId ?? currentRunId}:${eventNo}`,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      type: 'text',
    }
    currentTextBlock = next
    blocks.push(next)
    return next
  }

  const ensureToolBlock = (
    callId: string,
    createdAt: string,
    toolName: string,
  ): PersistedAssistantToolBlockMetadata => {
    const existing = toolByCallId.get(callId)

    if (existing) {
      if (toolName.trim().length > 0) {
        existing.name = toolName
      }
      return existing
    }

    const next: PersistedAssistantToolBlockMetadata = {
      args: null,
      createdAt,
      id: `tool:${callId}`,
      name: toolName,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      status: 'running',
      toolCallId: callId,
      type: 'tool_interaction',
    }
    toolByCallId.set(callId, next)
    blocks.push(next)
    return next
  }

  const ensureWebSearchBlock = (
    searchId: string,
    createdAt: string,
    provider: AiProviderName,
  ): PersistedAssistantWebSearchBlockMetadata => {
    const existing = webSearchById.get(searchId)

    if (existing) {
      existing.provider = provider
      return existing
    }

    const next: PersistedAssistantWebSearchBlockMetadata = {
      createdAt,
      id: `web_search:${searchId}`,
      patterns: [],
      provider,
      queries: [],
      references: [],
      responseId: null,
      searchId,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      status: 'in_progress',
      targetUrls: [],
      type: 'web_search',
    }
    webSearchById.set(searchId, next)
    blocks.push(next)
    return next
  }

  for (const event of transcriptEvents.value) {
    const payload = toPayloadRecord(event.payload)

    if (!payload) {
      continue
    }

    if (event.type === 'stream.delta') {
      const block = ensureTextBlock(event.eventNo, event.createdAt)
      if (block && typeof payload.delta === 'string') {
        block.content += payload.delta
      }
      continue
    }

    if (event.type !== 'progress.reported') {
      closeTextBlock()
    }

    if (event.type === 'reasoning.summary.delta' || event.type === 'reasoning.summary.done') {
      if (typeof payload.itemId !== 'string' || typeof payload.text !== 'string') {
        continue
      }

      const block = ensureThinkingBlock(payload.itemId, event.createdAt)
      block.content = payload.text
      block.status = event.type === 'reasoning.summary.done' ? 'done' : 'thinking'
      continue
    }

    if (event.type === 'web_search.progress') {
      if (typeof payload.searchId !== 'string') {
        continue
      }

      const block = ensureWebSearchBlock(
        payload.searchId,
        event.createdAt,
        isAiProviderName(payload.provider) ? payload.provider : 'openai',
      )

      const nextStatus = toPersistedWebSearchStatus(payload.status)

      block.patterns = dedupeStrings([...block.patterns, ...toStringArray(payload.patterns)])
      block.provider = isAiProviderName(payload.provider) ? payload.provider : 'openai'
      block.queries = dedupeStrings([...block.queries, ...toStringArray(payload.queries)])
      block.references = dedupeWebReferences([
        ...block.references,
        ...toPersistedWebReferences(payload.references),
      ])
      block.responseId =
        block.responseId ?? (typeof payload.responseId === 'string' ? payload.responseId : null)
      block.status = mergePersistedWebSearchStatus(block.status, nextStatus)
      block.targetUrls = dedupeStrings([...block.targetUrls, ...toStringArray(payload.targetUrls)])

      if (nextStatus === 'completed' || nextStatus === 'failed') {
        block.finishedAt = event.createdAt
      }
      continue
    }

    if (
      event.type === 'tool.called' ||
      event.type === 'tool.waiting' ||
      event.type === 'tool.confirmation_requested' ||
      event.type === 'tool.confirmation_granted' ||
      event.type === 'tool.confirmation_rejected' ||
      event.type === 'tool.completed' ||
      event.type === 'tool.failed'
    ) {
      if (typeof payload.callId !== 'string') {
        continue
      }

      const block = ensureToolBlock(
        payload.callId,
        event.createdAt,
        typeof payload.tool === 'string' && payload.tool.trim().length > 0
          ? payload.tool
          : 'unknown_tool',
      )
      const persistedAppsMeta = toPersistedAppsMeta(payload.appsMeta)

      if (persistedAppsMeta) {
        block.appsMeta = persistedAppsMeta
      }

      if (event.type === 'tool.called') {
        block.args = toToolArgs(payload.args)
        block.status = 'running'
        continue
      }

      if (event.type === 'tool.waiting') {
        block.args = toToolArgs(payload.args) ?? block.args
        if (typeof payload.waitTargetRunId === 'string' && payload.waitTargetRunId.length > 0) {
          block.childRunId = payload.waitTargetRunId
        }
        block.status = 'running'
        continue
      }

      if (event.type === 'tool.confirmation_requested') {
        block.args = toToolArgs(payload.args)
        block.confirmation = {
          description: typeof payload.description === 'string' ? payload.description : null,
          targetRef: typeof payload.waitTargetRef === 'string' ? payload.waitTargetRef : null,
          waitId: typeof payload.waitId === 'string' ? payload.waitId : '',
        }
        block.status = 'awaiting_confirmation'
        continue
      }

      if (event.type === 'tool.confirmation_granted') {
        block.approval = {
          description: block.confirmation?.description ?? null,
          remembered: typeof payload.remembered === 'boolean' ? payload.remembered : null,
          status: 'approved',
          targetRef: block.confirmation?.targetRef ?? null,
          waitId: typeof payload.waitId === 'string' ? payload.waitId : '',
        }
        block.confirmation = undefined
        block.status = 'running'
        continue
      }

      if (event.type === 'tool.confirmation_rejected') {
        block.approval = {
          description: block.confirmation?.description ?? null,
          remembered: null,
          status: 'rejected',
          targetRef: block.confirmation?.targetRef ?? null,
          waitId: typeof payload.waitId === 'string' ? payload.waitId : '',
        }
        block.confirmation = undefined
        block.status = 'error'
        continue
      }

      if (event.type === 'tool.completed') {
        if (Object.hasOwn(payload, 'outcome')) {
          block.output = payload.outcome
        }
        block.confirmation = undefined
        block.finishedAt = event.createdAt
        block.status = isFailedSandboxOutcome(payload.outcome) ? 'error' : 'complete'
        continue
      }

      if (Object.hasOwn(payload, 'error')) {
        block.output = payload.error
      }
      block.confirmation = undefined
      block.finishedAt = event.createdAt
      block.status = 'error'
    }
  }

  for (const outputItem of input.response?.output ?? []) {
    if (outputItem.type !== 'reasoning' || thinkingById.has(outputItem.id)) {
      continue
    }

    const content =
      typeof outputItem.text === 'string' && outputItem.text.trim().length > 0
        ? outputItem.text.trim()
        : flattenReasoningSummaryText(outputItem.summary)

    if (content.length === 0) {
      continue
    }

    const block = ensureThinkingBlock(outputItem.id, input.run.completedAt ?? input.run.updatedAt)
    block.content = content
    block.status = 'done'
  }

  for (const webSearch of input.response?.webSearches ?? []) {
    const block = ensureWebSearchBlock(
      webSearch.id,
      input.run.completedAt ?? input.run.updatedAt,
      webSearch.provider,
    )
    block.patterns = dedupeStrings([...block.patterns, ...webSearch.patterns])
    block.provider = webSearch.provider
    block.queries = dedupeStrings([...block.queries, ...webSearch.queries])
    block.references = dedupeWebReferences([...block.references, ...webSearch.references])
    block.responseId = block.responseId ?? webSearch.responseId
    block.status = mergePersistedWebSearchStatus(block.status, webSearch.status)
    block.targetUrls = dedupeStrings([...block.targetUrls, ...webSearch.targetUrls])

    if (block.status === 'completed' || block.status === 'failed') {
      block.finishedAt = block.finishedAt ?? input.run.completedAt ?? input.run.updatedAt
    }
  }

  if (input.persistTextBlocks && !blocks.some((block) => block.type === 'text')) {
    const outputText =
      buildOutputTextFromTranscriptEvents(transcriptEvents.value) || readRunOutputText(input.run)
    if (outputText.trim().length > 0) {
      blocks.push({
        content: outputText,
        createdAt: input.run.completedAt ?? input.run.updatedAt,
        id: `text:${input.sourceRunId ?? currentRunId}:persisted`,
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
        type: 'text',
      })
    }
  }

  const childRunsById = new Map<string, RunRecord>()

  for (const block of toolByCallId.values()) {
    if (block.name !== 'delegate_to_agent') {
      continue
    }

    const sourcedChildRun = childRunsBySourceCallId.get(block.toolCallId)
    const childRunId = block.childRunId ?? sourcedChildRun?.id

    if (!childRunId) {
      continue
    }

    block.childRunId = childRunId

    if (sourcedChildRun && sourcedChildRun.id === childRunId) {
      childRunsById.set(childRunId, sourcedChildRun)
      continue
    }

    const childRun = runRepository.getById(context.tenantScope, asRunId(childRunId))
    if (!childRun.ok) {
      return childRun
    }

    childRunsById.set(childRunId, childRun.value)
  }

  for (const childRun of childRunsById.values()) {
    const childBlocks = collectAssistantTranscriptBlocks(context, db, {
      persistTextBlocks: true,
      response: null,
      run: childRun,
      sourceRunId: String(childRun.id),
      visitedRunIds: input.visitedRunIds,
    })

    if (!childBlocks.ok) {
      return childBlocks
    }

    blocks.push(...childBlocks.value)
  }

  return ok(blocks.sort(compareTranscriptBlockOrder))
}

export const buildAssistantTranscriptMetadata = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  response: AiInteractionResponse | null,
  createdAt: string,
): Result<PersistedAssistantTranscriptMetadata | null, DomainError> => {
  const blocks = collectAssistantTranscriptBlocks(context, db, {
    persistTextBlocks: false,
    response,
    run: {
      ...run,
      completedAt: run.completedAt ?? createdAt,
      updatedAt: createdAt,
    },
    visitedRunIds: new Set<string>(),
  })

  if (!blocks.ok) {
    return blocks
  }

  if (blocks.value.length === 0) {
    return ok(null)
  }

  return ok({
    blocks: blocks.value,
    toolBlocks: blocks.value.filter(
      (block): block is PersistedAssistantToolBlockMetadata => block.type === 'tool_interaction',
    ),
    version: 2,
    webSearchBlocks: blocks.value.filter(
      (block): block is PersistedAssistantWebSearchBlockMetadata => block.type === 'web_search',
    ),
  })
}

const readRunTranscriptMetadata = (run: RunRecord): PersistedAssistantTranscriptMetadata | null => {
  if (!isRecord(run.resultJson) || !isRecord(run.resultJson.transcript)) {
    return null
  }

  const transcript = run.resultJson.transcript

  return transcript.version === 2
    ? (transcript as unknown as PersistedAssistantTranscriptMetadata)
    : null
}

export const buildRunTranscriptSnapshot = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  input: {
    createdAt: string
    response?: AiInteractionResponse | null
  },
): Result<
  {
    outputText: string
    transcript: PersistedAssistantTranscriptMetadata | null
  },
  DomainError
> => {
  const telemetryEvents = listRunTranscriptEvents(context, db, run, 'telemetry')

  if (!telemetryEvents.ok) {
    return telemetryEvents
  }

  const transcript = buildAssistantTranscriptMetadata(
    context,
    db,
    run,
    input.response ?? null,
    input.createdAt,
  )

  if (!transcript.ok) {
    return transcript
  }

  return ok({
    outputText:
      buildOutputTextFromTranscriptEvents(telemetryEvents.value) || readRunOutputText(run),
    transcript: transcript.value ?? readRunTranscriptMetadata(run),
  })
}

export const compactRunContextAtBoundary = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
): Result<null, DomainError> => {
  const itemRepository = createItemRepository(db)
  const runDependencyRepository = createRunDependencyRepository(db)
  const items = itemRepository.listByRunId(context.tenantScope, run.id)

  if (!items.ok) {
    return items
  }

  const pendingWaits = runDependencyRepository.listPendingByRunId(context.tenantScope, run.id)

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  const compacted = maybeCompactMainThreadContext(
    {
      config: context.config,
      createId: context.services.ids.create,
      db,
      nowIso: () => context.services.clock.nowIso(),
      scope: context.tenantScope,
    },
    run,
    items.value,
    pendingWaits.value,
  )

  if (!compacted.ok) {
    return compacted
  }

  return ok(null)
}

export const toPersistenceFailure = (
  error: unknown,
  fallbackMessage: string,
): Result<never, DomainError> => {
  if (error instanceof DomainErrorException) {
    return err(error.domainError)
  }

  return err({
    message: error instanceof Error ? error.message : fallbackMessage,
    type: 'conflict',
  })
}
