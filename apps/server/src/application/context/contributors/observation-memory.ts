import type { ObservationMemoryContent } from '../../../domain/memory/memory-record-repository'
import { toTextContent } from '../../interactions/build-run-interaction-request'
import { formatObservationMemoryText } from '../../memory/observe-summary'
import type { ContextContributor, ContextContributorInput } from '../contracts'

const latestObservationTimestamp = (input: ContextContributorInput): string =>
  input.context.observations
    .map((record) => record.createdAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right) || left.localeCompare(right))
    .at(-1) ?? input.context.run.createdAt

const observationCreatorRunId = (input: ContextContributorInput): string | null => {
  const runIds = [
    ...new Set(
      input.context.observations.flatMap((record) =>
        record.ownerRunId ? [String(record.ownerRunId)] : [],
      ),
    ),
  ].sort()

  return runIds.length === 1 ? (runIds[0] ?? null) : null
}

export const observationMemoryContributor: ContextContributor = {
  build: ({ context }) => [
    {
      kind: 'run_local_memory',
      messages: context.observations.map((record) => ({
        content: [
          toTextContent(formatObservationMemoryText(record.content as ObservationMemoryContent)),
        ],
        role: 'developer',
      })),
      volatility: 'stable',
    },
  ],
  describe: ({ input }) => ({
    authority: 'observation',
    capturedAt: latestObservationTimestamp(input),
    conflictKey: null,
    dedupeKey: 'observation-memory',
    dependencies: [],
    expiresAt: null,
    priority: 0,
    provenance: {
      createdByRunId: observationCreatorRunId(input),
      sourceIds: input.context.observations.map((record) => record.id).sort(),
      sourceType: 'memory_observation',
      sourceVersion: null,
    },
    requirement: 'preferred',
    sensitivity: 'private',
    supersedes: [],
    transformation: { kind: 'none' },
    visibility: 'model',
  }),
  id: 'observation-memory',
  order: 10,
}
