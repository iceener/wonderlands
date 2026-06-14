import type { AiToolCall } from '../../../../domain/ai/types'
import type { ToolOutcome, ToolSpec } from '../../../../domain/tooling/tool-registry'
import type { DomainError } from '../../../../shared/errors'

export interface ToolExecutionResult {
  call: AiToolCall
  domain: ToolSpec['domain']
  error?: DomainError
  outcome?: ToolOutcome
  startedAt: string
  tool: ToolSpec | null
  toolName: string
}

export interface PendingRunWaitSummary {
  args: Record<string, unknown> | null
  callId: string
  createdAt: string
  description: string | null
  requiresApproval: boolean
  targetKind: string
  targetRef: string | null
  tool: string
  type: string
  waitId: string
}
