import { toTextContent } from '../../interactions/build-run-interaction-request'
import type { ContextContributor } from '../contracts'

const SUMMARY_MEMORY_SOURCE_VERSION = null

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
  describe: ({ input }) => {
    const summary = input.context.summary

    return {
      authority: 'summary',
      capturedAt: summary?.createdAt ?? input.context.run.createdAt,
      conflictKey: null,
      dedupeKey: 'summary-memory',
      dependencies: [],
      expiresAt: null,
      priority: 0,
      provenance: {
        createdByRunId: summary ? String(summary.runId) : null,
        sourceIds: summary ? [summary.id] : [],
        sourceType: 'memory_summary',
        sourceVersion: SUMMARY_MEMORY_SOURCE_VERSION,
      },
      requirement: 'preferred',
      sensitivity: 'private',
      supersedes: [],
      // ContextSummaryRecord has sequence bounds and a model key, but no durable source refs or
      // summarizer version. Calling that metadata "summarized" would overstate its provenance.
      transformation: { kind: 'none' },
      visibility: 'model',
    }
  },
  id: 'summary-memory',
  order: 8,
}
