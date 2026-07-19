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

export const runTranscriptContributor: ContextContributor = {
  build: (input) => [
    {
      kind: 'run_transcript',
      messages: toRunTranscriptMessages(input),
      volatility: 'volatile',
    },
  ],
  id: 'run-transcript',
  order: 11,
}
