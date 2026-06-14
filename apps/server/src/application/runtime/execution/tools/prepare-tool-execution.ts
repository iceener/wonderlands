import type { AiToolCall } from '../../../../domain/ai/types'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import type { ToolContext } from '../../../../domain/tooling/tool-registry'
import type { CommandContext } from '../../../commands/command-context'
import type { ToolExecutionResult } from './tool-execution-types'

export const toToolContext = (
  context: CommandContext,
  run: RunRecord,
  toolCallId: string | null = null,
  abortSignal?: AbortSignal,
  input?: Pick<ToolContext, 'mcpCodeModeApprovedRuntimeNames' | 'sandboxDeleteWritebackApproved'>,
): ToolContext => ({
  abortSignal,
  config: context.config,
  createId: context.services.ids.create,
  db: context.db,
  ...(input?.mcpCodeModeApprovedRuntimeNames?.length
    ? { mcpCodeModeApprovedRuntimeNames: [...input.mcpCodeModeApprovedRuntimeNames] }
    : {}),
  nowIso: () => context.services.clock.nowIso(),
  requestId: context.requestId,
  run,
  ...(input?.sandboxDeleteWritebackApproved ? { sandboxDeleteWritebackApproved: true } : {}),
  services: context.services,
  tenantScope: context.tenantScope,
  toolCallId,
  traceId: context.traceId,
})

export const prepareToolExecution = (
  context: CommandContext,
  call: AiToolCall,
): ToolExecutionResult => {
  const tool = context.services.tools.get(call.name)

  return {
    call,
    domain: tool?.domain ?? 'system',
    startedAt: context.services.clock.nowIso(),
    tool,
    toolName: tool?.name ?? call.name,
  }
}
