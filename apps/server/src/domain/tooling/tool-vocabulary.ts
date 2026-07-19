import type { RunId } from '../../shared/ids'

/**
 * Domain-neutral tool/wait vocabulary shared by run, job dependency, tool
 * execution, and agent records. These types describe *what kind of tool a
 * run invoked* and *what a run is waiting on*, not how tools are registered
 * or executed, so they stay in `domain` even though the richer tool-registry
 * contracts (which depend on app config/runtime) live under
 * `application/tooling`.
 */
export type ToolDomain = 'native' | 'mcp' | 'provider' | 'system'

export type WaitType = 'agent' | 'tool' | 'mcp' | 'human' | 'upload'

export type WaitTargetKind =
  | 'run'
  | 'tool_execution'
  | 'mcp_operation'
  | 'human_response'
  | 'upload'
  | 'external'

export interface ToolWaitDescriptor {
  description?: string | null
  targetKind: WaitTargetKind
  targetRef?: string | null
  targetRunId?: RunId | null
  timeoutAt?: string | null
  type: WaitType
}
