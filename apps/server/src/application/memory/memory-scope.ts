import type { RunRecord } from '../../domain/runtime/run-repository'

export interface MemoryScopeSelector {
  scopeKind: 'run_local' | 'agent_profile'
  scopeRef: string
}

export const resolveWritableMemoryScope = (
  run: Pick<RunRecord, 'agentId' | 'id' | 'parentRunId'>,
): MemoryScopeSelector =>
  run.parentRunId === null && run.agentId
    ? {
        scopeKind: 'agent_profile',
        scopeRef: run.agentId,
      }
    : {
        scopeKind: 'run_local',
        scopeRef: run.id,
      }

export const resolveReadableMemoryScopes = (
  run: Pick<RunRecord, 'agentId' | 'id' | 'parentRunId'>,
): MemoryScopeSelector[] => {
  const writableScope = resolveWritableMemoryScope(run)

  if (writableScope.scopeKind === 'agent_profile') {
    return [
      writableScope,
      {
        scopeKind: 'run_local',
        scopeRef: run.id,
      },
    ]
  }

  return [writableScope]
}
