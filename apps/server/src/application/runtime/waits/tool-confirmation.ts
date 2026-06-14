import type { RunDependencyRecord } from '../../../domain/runtime/run-dependency-repository'
import type { ToolExecutionRecord } from '../../../domain/runtime/tool-execution-repository'
import { isMcpCodeModeConfirmationTargetRef } from '../../mcp/code-mode'
import { isSandboxDeleteWritebackConfirmationTargetRef } from '../../sandbox/sandbox-delete-confirmation'

type WaitLike = Pick<RunDependencyRecord, 'targetKind' | 'type'> & {
  targetRef?: RunDependencyRecord['targetRef'] | undefined
}

type ToolLike = Pick<ToolExecutionRecord, 'domain' | 'tool'>

const sandboxConfirmationTools = new Set(['commit_sandbox_writeback'])

export const isHumanConfirmationWait = (wait: WaitLike): boolean =>
  wait.type === 'human' && wait.targetKind === 'human_response'

export const requiresConfirmationForToolWait = (wait: WaitLike, tool: ToolLike): boolean =>
  isHumanConfirmationWait(wait) &&
  (tool.domain === 'mcp' ||
    sandboxConfirmationTools.has(tool.tool) ||
    (tool.tool === 'execute' &&
      (isMcpCodeModeConfirmationTargetRef(wait.targetRef) ||
        isSandboxDeleteWritebackConfirmationTargetRef(wait.targetRef))))

export const isSandboxWritebackConfirmationWait = (wait: WaitLike, tool: ToolLike): boolean =>
  isHumanConfirmationWait(wait) && sandboxConfirmationTools.has(tool.tool)

export const isExecuteMcpConfirmationWait = (wait: WaitLike, tool: ToolLike): boolean =>
  isHumanConfirmationWait(wait) &&
  tool.tool === 'execute' &&
  isMcpCodeModeConfirmationTargetRef(wait.targetRef)

export const isExecuteSandboxDeleteConfirmationWait = (wait: WaitLike, tool: ToolLike): boolean =>
  isHumanConfirmationWait(wait) &&
  tool.tool === 'execute' &&
  isSandboxDeleteWritebackConfirmationTargetRef(wait.targetRef)
