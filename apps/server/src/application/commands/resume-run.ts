import { z } from 'zod'
import type { RunId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import type { ResumeRunOutput } from '../runtime/persistence/run-persistence'
import {
  type RunWaitResolutionInput,
  type RunWaitResolutionState,
  resolveRunWait,
} from '../runtime/waits/run-wait-resolution'
import type { CommandContext, CommandResult } from './command-context'

const resumeRunInputSchema = z
  .object({
    approve: z.boolean().optional(),
    errorMessage: z.string().trim().min(1).max(10_000).optional(),
    maxOutputTokens: z.number().int().positive().max(100_000).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    modelAlias: z.string().trim().min(1).max(200).optional(),
    output: z.unknown().optional(),
    provider: z.enum(['openai', 'google', 'openrouter']).optional(),
    rememberApproval: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    waitId: z.string().trim().min(1).max(200),
  })
  .refine(
    (value) =>
      value.approve !== undefined || value.output !== undefined || value.errorMessage !== undefined,
    {
      message: 'Either approve, output, or errorMessage is required',
    },
  )

export type ResumeRunInput = z.infer<typeof resumeRunInputSchema>
export type RuntimeResumeRunInput = RunWaitResolutionInput
export type ResumeRunResolutionState = RunWaitResolutionState

export const parseResumeRunInput = (input: unknown): CommandResult<ResumeRunInput> => {
  const parsed = resumeRunInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export { resolveRunWait }

export const createResumeRunCommand = () => ({
  execute: async (
    context: CommandContext,
    runId: RunId,
    input: RuntimeResumeRunInput,
  ): Promise<CommandResult<ResumeRunOutput>> => {
    const resolved = await resolveRunWait(context, runId, input)

    if (!resolved.ok) {
      return resolved
    }

    if (resolved.value.kind === 'waiting') {
      return ok(resolved.value.output)
    }

    context.services.multiagent.wake()
    void context.services.multiagent.processOneDecision().catch(() => undefined)

    return ok({
      runId,
      status: 'accepted',
    })
  },
})
