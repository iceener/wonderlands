import type {
  ContextArtifactDescriptionInput,
  ContextArtifactMetadata,
  ContextContributor,
} from '../contracts'

const describeReservedLayer = (
  contributorId: string,
  { input }: ContextArtifactDescriptionInput,
): ContextArtifactMetadata => ({
  authority: 'conversation',
  capturedAt: input.context.run.createdAt,
  conflictKey: null,
  dedupeKey: contributorId,
  dependencies: [],
  expiresAt: null,
  priority: 0,
  provenance: {
    createdByRunId: String(input.context.run.id),
    sourceIds: [String(input.context.run.id)],
    sourceType: 'runtime',
    sourceVersion: String(input.context.run.version),
  },
  requirement: 'optional',
  sensitivity: 'private',
  supersedes: [],
  transformation: { kind: 'none' },
  visibility: 'model',
})

export const systemPromptContributor: ContextContributor = {
  build: () => [
    {
      kind: 'system_prompt',
      messages: [],
      volatility: 'stable',
    },
  ],
  describe: (input) => describeReservedLayer('system-prompt', input),
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
  describe: (input) => describeReservedLayer('session-metadata', input),
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
  describe: (input) => describeReservedLayer('pending-waits', input),
  id: 'pending-waits',
  order: 15,
}
