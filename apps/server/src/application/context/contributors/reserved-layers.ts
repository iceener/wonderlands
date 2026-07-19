import type { ContextContributor } from '../contracts'

export const systemPromptContributor: ContextContributor = {
  build: () => [
    {
      kind: 'system_prompt',
      messages: [],
      volatility: 'stable',
    },
  ],
  id: 'system-prompt',
  order: 1,
}

export const sessionMetadataContributor: ContextContributor = {
  build: () => [
    {
      kind: 'session_metadata',
      messages: [],
      volatility: 'stable',
    },
  ],
  id: 'session-metadata',
  order: 7,
}

export const pendingWaitsContributor: ContextContributor = {
  build: () => [
    {
      kind: 'pending_waits',
      messages: [],
      volatility: 'volatile',
    },
  ],
  id: 'pending-waits',
  order: 15,
}
