import type { createItemRepository } from '../../adapters/persistence/sqlite/runtime/item-repository'
import type { createToolExecutionRepository } from '../../adapters/persistence/sqlite/runtime/tool-execution-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import type { ItemId, RunId } from '../../shared/ids'
import type { CommandContext } from '../commands/command-context'
import type { createEventStore } from '../commands/event-store'
import { appendDomainEvent, resolveRunEventThreadId, unwrapOrThrow } from './run-events'

type ToolExecutionScopedRun = Pick<
  RunRecord,
  'id' | 'sessionId' | 'threadId' | 'parentRunId' | 'rootRunId'
> & {
  configSnapshot?: Record<string, unknown> | null
}

interface PersistToolExecutionOutputInput {
  callId: string
  completedAt: string
  durationMs: number | null
  itemId: ItemId
  itemRepository: ReturnType<typeof createItemRepository>
  output: unknown
  runId: RunId
  scope: CommandContext['tenantScope']
  sequence: number
  tool: string
  toolExecutionRepository: ReturnType<typeof createToolExecutionRepository>
}

export const serializeToolOutput = (value: unknown): string => JSON.stringify(value ?? null)

export const toToolArgs = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export const toToolErrorOutput = (
  error: string | DomainError,
  input?: {
    details?: unknown
    message?: string
  },
) =>
  typeof error === 'string'
    ? {
        ...(input?.details !== undefined ? { details: input.details } : {}),
        error: {
          message: input?.message ?? error,
          type: 'conflict' as const,
        },
        ok: false,
      }
    : {
        ...(input?.details !== undefined ? { details: input.details } : {}),
        error:
          error.type === 'provider'
            ? {
                message: input?.message ?? error.message,
                provider: error.provider,
                type: error.type,
              }
            : { message: input?.message ?? error.message, type: error.type },
        ok: false,
      }

export const toToolExecutionEventPayload = (
  run: ToolExecutionScopedRun,
  input: {
    callId: string
    tool: string
  },
  payload: Record<string, unknown> = {},
): Record<string, unknown> => ({
  callId: input.callId,
  ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
  rootRunId: run.rootRunId,
  runId: run.id,
  sessionId: run.sessionId,
  threadId: resolveRunEventThreadId(run),
  tool: input.tool,
  ...payload,
})

export const appendToolConfirmationRejectedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  run: ToolExecutionScopedRun,
  input: {
    callId: string
    tool: string
    waitId: string
  },
) =>
  appendDomainEvent(context, eventStore, {
    aggregateId: input.callId,
    aggregateType: 'tool_execution',
    payload: toToolExecutionEventPayload(run, input, {
      waitId: input.waitId,
    }),
    type: 'tool.confirmation_rejected',
  })

export const appendToolConfirmationGrantedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  run: ToolExecutionScopedRun,
  input: {
    callId: string
    fingerprint?: string
    remembered?: boolean
    tool: string
    waitId: string
  },
) =>
  appendDomainEvent(context, eventStore, {
    aggregateId: input.callId,
    aggregateType: 'tool_execution',
    payload: toToolExecutionEventPayload(run, input, {
      ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
      ...(input.remembered !== undefined ? { remembered: input.remembered } : {}),
      waitId: input.waitId,
    }),
    type: 'tool.confirmation_granted',
  })

export const appendToolFailedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  run: ToolExecutionScopedRun,
  input: {
    appsMeta?: Record<string, unknown>
    callId: string
    error: unknown
    tool: string
    turn?: number
  },
) =>
  appendDomainEvent(context, eventStore, {
    aggregateId: input.callId,
    aggregateType: 'tool_execution',
    payload: toToolExecutionEventPayload(run, input, {
      ...(input.appsMeta ? { appsMeta: input.appsMeta } : {}),
      error: input.error,
      ...(input.turn !== undefined ? { turn: input.turn } : {}),
    }),
    type: 'tool.failed',
  })

export const appendToolCompletedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  run: ToolExecutionScopedRun,
  input: {
    appsMeta?: Record<string, unknown>
    callId: string
    outcome: unknown
    tool: string
    turn?: number
  },
) =>
  appendDomainEvent(context, eventStore, {
    aggregateId: input.callId,
    aggregateType: 'tool_execution',
    payload: toToolExecutionEventPayload(run, input, {
      ...(input.appsMeta ? { appsMeta: input.appsMeta } : {}),
      outcome: input.outcome,
      ...(input.turn !== undefined ? { turn: input.turn } : {}),
    }),
    type: 'tool.completed',
  })

export const persistFailedToolExecutionWithOutput = (
  input: PersistToolExecutionOutputInput & {
    errorText: string
  },
): void => {
  unwrapOrThrow(
    input.toolExecutionRepository.fail(input.scope, {
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      errorText: input.errorText,
      id: input.callId,
      outcomeJson: input.output,
    }),
  )

  unwrapOrThrow(
    input.itemRepository.createFunctionCallOutput(input.scope, {
      callId: input.callId,
      createdAt: input.completedAt,
      id: input.itemId,
      output: serializeToolOutput(input.output),
      providerPayload: {
        isError: true,
        name: input.tool,
      },
      runId: input.runId,
      sequence: input.sequence,
    }),
  )
}

export const persistCompletedToolExecutionWithOutput = (
  input: PersistToolExecutionOutputInput,
): void => {
  unwrapOrThrow(
    input.toolExecutionRepository.complete(input.scope, {
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      id: input.callId,
      outcomeJson: input.output,
    }),
  )

  unwrapOrThrow(
    input.itemRepository.createFunctionCallOutput(input.scope, {
      callId: input.callId,
      createdAt: input.completedAt,
      id: input.itemId,
      output: serializeToolOutput(input.output),
      providerPayload: {
        isError: false,
        name: input.tool,
      },
      runId: input.runId,
      sequence: input.sequence,
    }),
  )
}
