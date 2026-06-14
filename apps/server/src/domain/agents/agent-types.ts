import type { RunId } from '../../shared/ids'
import type { WaitTargetKind, WaitType } from '../tooling/tool-registry'

export const agentVisibilityValues = ['account_private', 'tenant_shared', 'system'] as const
export type AgentVisibility = (typeof agentVisibilityValues)[number]

export const agentKindValues = ['primary', 'specialist', 'derived'] as const
export type AgentKind = (typeof agentKindValues)[number]

export const agentStatusValues = ['active', 'archived', 'deleted'] as const
export type AgentStatus = (typeof agentStatusValues)[number]

export const delegationModeValues = ['async_join'] as const
export type DelegationMode = (typeof delegationModeValues)[number]

export const workspaceKindValues = ['account_root'] as const
export type WorkspaceKind = (typeof workspaceKindValues)[number]

export const workspaceStatusValues = ['active', 'archived', 'deleted'] as const
export type WorkspaceStatus = (typeof workspaceStatusValues)[number]

export interface ChildRunSuspendedWait {
  args: Record<string, unknown> | null
  description: string | null
  requiresApproval?: boolean
  targetKind: WaitTargetKind
  targetRef: string | null
  tool: string
  type: WaitType
  waitId: string
}

export type ChildRunResultEnvelope =
  | {
      childRunId: RunId
      kind: 'cancelled'
      result: unknown | null
    }
  | {
      childRunId: RunId
      generatedFileIds?: string[]
      kind: 'completed'
      result: unknown
      summary: string | null
    }
  | {
      childRunId: RunId
      error: unknown
      kind: 'failed'
    }
  | {
      childRunId: RunId
      kind: 'suspended'
      summary: string | null
      waits: ChildRunSuspendedWait[]
    }

export type ChildRunReplayOutput =
  | {
      kind: 'cancelled'
    }
  | {
      kind: 'completed'
      summary?: string
    }
  | {
      error?: unknown
      kind: 'failed'
    }
  | {
      childRunId: RunId
      kind: 'suspended'
      summary?: string
      waits: ChildRunSuspendedWait[]
    }

const toCompactChildRunReplayError = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return {
      message: value.trim(),
      type: 'conflict',
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as {
    code?: unknown
    message?: unknown
    provider?: unknown
    type?: unknown
  }
  const compact: Record<string, unknown> = {}

  if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
    compact.message = candidate.message.trim()
  }

  if (typeof candidate.type === 'string' && candidate.type.trim().length > 0) {
    compact.type = candidate.type.trim()
  }

  if (typeof candidate.provider === 'string' && candidate.provider.trim().length > 0) {
    compact.provider = candidate.provider.trim()
  }

  if (typeof candidate.code === 'string' && candidate.code.trim().length > 0) {
    compact.code = candidate.code.trim()
  }

  return Object.keys(compact).length > 0 ? compact : null
}

export const toChildRunReplayOutput = (output: unknown): ChildRunReplayOutput | null => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null
  }

  const candidate = output as {
    childRunId?: unknown
    error?: unknown
    kind?: unknown
    result?: unknown
    summary?: unknown
    waits?: unknown
  }

  const summary =
    typeof candidate.summary === 'string' && candidate.summary.trim().length > 0
      ? candidate.summary.trim()
      : null
  const resultOutputText =
    candidate.result &&
    typeof candidate.result === 'object' &&
    !Array.isArray(candidate.result) &&
    typeof (candidate.result as { outputText?: unknown }).outputText === 'string' &&
    (candidate.result as { outputText: string }).outputText.trim().length > 0
      ? (candidate.result as { outputText: string }).outputText.trim()
      : null
  const resolvedSummary = summary ?? resultOutputText

  const childRunId =
    typeof candidate.childRunId === 'string' && candidate.childRunId.length > 0
      ? (candidate.childRunId as RunId)
      : null
  const waits = Array.isArray(candidate.waits)
    ? candidate.waits.flatMap((wait) => {
        if (!wait || typeof wait !== 'object' || Array.isArray(wait)) {
          return []
        }

        const nextWait = wait as {
          args?: unknown
          description?: unknown
          requiresApproval?: unknown
          targetKind?: unknown
          targetRef?: unknown
          tool?: unknown
          type?: unknown
          waitId?: unknown
        }

        if (
          typeof nextWait.waitId !== 'string' ||
          typeof nextWait.tool !== 'string' ||
          typeof nextWait.type !== 'string' ||
          typeof nextWait.targetKind !== 'string'
        ) {
          return []
        }

        return [
          {
            args:
              nextWait.args && typeof nextWait.args === 'object' && !Array.isArray(nextWait.args)
                ? (nextWait.args as Record<string, unknown>)
                : null,
            description: typeof nextWait.description === 'string' ? nextWait.description : null,
            ...(nextWait.requiresApproval === true ? { requiresApproval: true } : {}),
            targetKind: nextWait.targetKind as WaitTargetKind,
            targetRef: typeof nextWait.targetRef === 'string' ? nextWait.targetRef : null,
            tool: nextWait.tool,
            type: nextWait.type as WaitType,
            waitId: nextWait.waitId,
          },
        ]
      })
    : []

  switch (candidate.kind) {
    case 'completed':
      return {
        kind: 'completed',
        ...(resolvedSummary ? { summary: resolvedSummary } : {}),
      }
    case 'cancelled':
      return {
        kind: 'cancelled',
      }
    case 'failed':
      return {
        ...(candidate.error !== undefined
          ? { error: toCompactChildRunReplayError(candidate.error) ?? undefined }
          : {}),
        kind: 'failed',
      }
    case 'suspended':
      return childRunId
        ? {
            childRunId,
            kind: 'suspended',
            ...(resolvedSummary ? { summary: resolvedSummary } : {}),
            waits,
          }
        : null
    default:
      return null
  }
}
