import type { AiMessage, AiProviderName } from '../../../domain/ai/types'
import type { ItemRecord } from '../../../domain/runtime/item-repository'
import { toItemMessages } from '../../interactions/build-run-interaction-request'
import type { ContextContributor, ContextContributorInput } from '../contracts'

const resolveRequestedProvider = ({
  context,
  overrides,
}: ContextContributorInput): AiProviderName | null => {
  if (overrides.provider) {
    return overrides.provider
  }

  const provider = context.run.configSnapshot.provider

  return provider === 'openai' || provider === 'google' || provider === 'openrouter'
    ? provider
    : null
}

export const toRunTranscriptMessages = (input: ContextContributorInput): AiMessage[] =>
  toItemMessages(structuredClone(input.context.items) as ItemRecord[], {
    provider: resolveRequestedProvider(input),
  })

const latestTranscriptTimestamp = (input: ContextContributorInput): string =>
  input.context.items
    .map((item) => item.createdAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right) || left.localeCompare(right))
    .at(-1) ?? input.context.run.createdAt

export const runTranscriptContributor: ContextContributor = {
  build: (input) => [
    {
      kind: 'run_transcript',
      messages: toRunTranscriptMessages(input),
      volatility: 'volatile',
    },
  ],
  describe: ({ input }) => ({
    authority: 'conversation',
    capturedAt: latestTranscriptTimestamp(input),
    conflictKey: null,
    dedupeKey: 'run-transcript',
    dependencies: [],
    expiresAt: null,
    priority: 0,
    provenance: {
      createdByRunId: String(input.context.run.id),
      sourceIds: input.context.items.map((item) => String(item.id)).sort(),
      sourceType: 'runtime',
      sourceVersion: String(input.context.run.version),
    },
    // The legacy transcript remains one preferred artifact for projection parity. A future
    // granular representation must classify the current user turn and unresolved tool state as
    // mandatory rather than allowing this whole transcript to compete as one preferred block.
    requirement: 'preferred',
    sensitivity: 'restricted',
    supersedes: [],
    transformation: { kind: 'none' },
    visibility: 'model',
  }),
  id: 'run-transcript',
  order: 11,
}
