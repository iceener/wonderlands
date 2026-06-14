import { z } from 'zod'

export const rootRunTargetInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('assistant'),
  }),
  z.object({
    agentId: z.string().trim().min(1).max(200),
    kind: z.literal('agent'),
  }),
])

export type RootRunTargetInput = z.infer<typeof rootRunTargetInputSchema>

export interface ResolvedRootRunTargetSelection {
  agentId: string | null
  useAccountDefaultAgent: boolean
}

export const resolveRootRunTargetSelection = (input: {
  target?: RootRunTargetInput | undefined
}): ResolvedRootRunTargetSelection => {
  if (input.target) {
    if (input.target.kind === 'assistant') {
      return {
        agentId: null,
        useAccountDefaultAgent: false,
      }
    }

    return {
      agentId: input.target.agentId,
      useAccountDefaultAgent: false,
    }
  }

  return {
    agentId: null,
    useAccountDefaultAgent: true,
  }
}
