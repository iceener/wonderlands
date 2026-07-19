import { toTextContent } from '../../interactions/build-run-interaction-request'
import type { ContextContributor } from '../contracts'

export const summaryMemoryContributor: ContextContributor = {
  build: ({ context }) => [
    {
      kind: 'summary_memory',
      messages: context.summary
        ? [
            {
              content: [toTextContent(context.summary.content)],
              role: 'developer',
            },
          ]
        : [],
      volatility: 'stable',
    },
  ],
  id: 'summary-memory',
  order: 8,
}
