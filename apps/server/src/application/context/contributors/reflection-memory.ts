import type { ReflectionMemoryContent } from '../../../domain/memory/memory-record-repository'
import { toTextContent } from '../../interactions/build-run-interaction-request'
import { formatReflectionMemoryText } from '../../memory/reflect-run-local-memory'
import type { ContextContributor } from '../contracts'

export const reflectionMemoryContributor: ContextContributor = {
  build: ({ context }) => [
    {
      kind: 'run_local_memory',
      messages: context.activeReflection
        ? [
            {
              content: [
                toTextContent(
                  formatReflectionMemoryText(
                    context.activeReflection.content as ReflectionMemoryContent,
                  ),
                ),
              ],
              role: 'developer',
            },
          ]
        : [],
      volatility: 'stable',
    },
  ],
  id: 'reflection-memory',
  order: 9,
}
