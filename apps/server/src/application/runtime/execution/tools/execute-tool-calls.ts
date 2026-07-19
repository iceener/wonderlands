import type { ToolContext, ToolSpec } from '../../../../application/tooling/tool-registry'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { ok, type Result } from '../../../../shared/result'
import { isToolAllowedForRun } from '../../../agents/agent-runtime-policy'
import type { CommandContext } from '../../../commands/command-context'
import { loadAttachmentRefDescriptors } from '../../../files/attachment-ref-context'
import { resolveAttachmentRefsForToolPolicy } from '../../../files/ref-resolution'
import { createSessionMessageRepository } from '../../../persistence/repositories'
import { toToolContext } from './prepare-tool-execution'
import type { ToolExecutionResult } from './tool-execution-types'

const toCancellationError = (abortSignal?: AbortSignal): DomainError => ({
  message: typeof abortSignal?.reason === 'string' ? abortSignal.reason : 'Run cancelled',
  type: 'conflict',
})

const resolveToolArguments = async (
  context: CommandContext,
  run: RunRecord,
  tool: ToolSpec,
  value: unknown,
): Promise<Result<unknown, DomainError>> => {
  if (tool.attachmentRefResolutionPolicy === 'none' || !run.threadId) {
    return ok(value)
  }

  const visibleMessages = createSessionMessageRepository(context.db).listByThreadId(
    context.tenantScope,
    run.threadId,
  )

  if (!visibleMessages.ok) {
    return visibleMessages
  }

  const descriptors = loadAttachmentRefDescriptors(context.db, context.tenantScope, {
    apiBasePath: context.config.api.basePath,
    visibleMessages: visibleMessages.value,
  })

  if (!descriptors.ok) {
    return descriptors
  }

  return resolveAttachmentRefsForToolPolicy({
    blobStore: context.services.files.blobStore,
    db: context.db,
    descriptors: descriptors.value,
    policy: tool.attachmentRefResolutionPolicy,
    scope: context.tenantScope,
    targetKeys: tool.attachmentRefTargetKeys,
    value,
  })
}

export const executeOneToolCall = async (
  context: CommandContext,
  run: RunRecord,
  prepared: ToolExecutionResult,
  abortSignal?: AbortSignal,
  toolContextInput?: Pick<
    ToolContext,
    'mcpCodeModeApprovedRuntimeNames' | 'sandboxDeleteWritebackApproved'
  >,
): Promise<ToolExecutionResult> => {
  const toolContext = toToolContext(
    context,
    run,
    prepared.call.callId,
    abortSignal,
    toolContextInput,
  )
  const { tool } = prepared

  if (abortSignal?.aborted) {
    return {
      ...prepared,
      error: toCancellationError(abortSignal),
    }
  }

  if (!tool) {
    return {
      ...prepared,
      error: {
        message: `Tool ${prepared.call.name} is not registered`,
        type: 'validation',
      },
    }
  }

  if (!isToolAllowedForRun(context.db, context.tenantScope, run, tool)) {
    return {
      ...prepared,
      error: {
        message: `Tool ${tool.name} is not allowed for agent revision ${run.agentRevisionId ?? 'unbound'}`,
        type: 'permission',
      },
    }
  }

  const resolvedArgs = await resolveToolArguments(context, run, tool, prepared.call.arguments)

  if (!resolvedArgs.ok) {
    return {
      ...prepared,
      error: resolvedArgs.error,
    }
  }

  const validated = tool.validateArgs
    ? tool.validateArgs(resolvedArgs.value)
    : ok(resolvedArgs.value)

  if (!validated.ok) {
    return {
      ...prepared,
      error: validated.error,
    }
  }

  try {
    const outcome = await tool.execute(toolContext, validated.value)

    if (abortSignal?.aborted) {
      return {
        ...prepared,
        error: toCancellationError(abortSignal),
      }
    }

    if (!outcome.ok) {
      return {
        ...prepared,
        error: outcome.error,
      }
    }

    return {
      ...prepared,
      outcome: outcome.value,
    }
  } catch (error) {
    if (abortSignal?.aborted) {
      return {
        ...prepared,
        error: toCancellationError(abortSignal),
      }
    }

    return {
      ...prepared,
      error: {
        message: error instanceof Error ? error.message : `Tool ${tool.name} failed unexpectedly`,
        type: 'conflict',
      },
    }
  }
}
