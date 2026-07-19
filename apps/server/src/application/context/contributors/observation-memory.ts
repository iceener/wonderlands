import type { ObservationMemoryContent } from '../../../domain/memory/memory-record-repository'
import { toTextContent } from '../../interactions/build-run-interaction-request'
import { formatObservationMemoryText } from '../../memory/observe-summary'
import type { ContextContributor } from '../contracts'

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
  id: 'observation-memory',
  order: 10,
}
