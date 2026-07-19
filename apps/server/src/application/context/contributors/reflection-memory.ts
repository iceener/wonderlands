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
  describe: ({ input }) => {
    const reflection = input.context.activeReflection

    return {
      authority: 'reflection',
      capturedAt: reflection?.createdAt ?? input.context.run.createdAt,
      conflictKey: null,
      dedupeKey: 'reflection-memory',
      dependencies: [],
      expiresAt: null,
      priority: 0,
      provenance: {
        createdByRunId: reflection?.ownerRunId ? String(reflection.ownerRunId) : null,
        sourceIds: reflection ? [reflection.id] : [],
        sourceType: 'memory_reflection',
        sourceVersion: reflection ? String(reflection.generation) : null,
      },
      requirement: 'preferred',
      sensitivity: 'private',
      supersedes: [],
      transformation: { kind: 'none' },
      visibility: 'model',
    }
  },
  id: 'reflection-memory',
  order: 9,
}
