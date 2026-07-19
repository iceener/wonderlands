import type { SessionMessageRecord } from '../../../domain/sessions/session-message-repository'
import type { VisibleFileContextEntry } from '../../files/file-context'
import { toVisibleMessages } from '../../interactions/build-run-interaction-request'
import type { ContextContributor, ContextContributorInput } from '../contracts'
import { toRunTranscriptMessages } from './run-transcript'

const latestVisibleHistoryTimestamp = (input: ContextContributorInput): string =>
  input.context.visibleMessages
    .map((message) => message.createdAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right) || left.localeCompare(right))
    .at(-1) ?? input.context.run.createdAt

const visibleHistoryCreatorRunId = (input: ContextContributorInput): string | null => {
  const runIds = [
    ...new Set(
      input.context.visibleMessages.flatMap((message) =>
        message.runId ? [String(message.runId)] : [],
      ),
    ),
  ].sort()

  return runIds.length === 1 ? (runIds[0] ?? null) : null
}

export const visibleHistoryFallbackContributor: ContextContributor = {
  build: (input) => [
    {
      kind: 'visible_message_history',
      messages:
        toRunTranscriptMessages(input).length === 0 && !input.context.summary
          ? toVisibleMessages(
              structuredClone(input.context.visibleMessages) as SessionMessageRecord[],
              structuredClone(input.context.visibleFiles) as VisibleFileContextEntry[],
            )
          : [],
      volatility: 'volatile',
    },
  ],
  describe: ({ input }) => ({
    authority: 'conversation',
    capturedAt: latestVisibleHistoryTimestamp(input),
    conflictKey: null,
    dedupeKey: 'visible-history-fallback',
    dependencies: [],
    expiresAt: null,
    priority: 0,
    provenance: {
      createdByRunId: visibleHistoryCreatorRunId(input),
      sourceIds: [
        ...input.context.visibleMessages.map((message) => String(message.id)),
        ...input.context.visibleFiles.map((file) => String(file.fileId)),
      ].sort(),
      sourceType: 'runtime',
      sourceVersion: null,
    },
    requirement: 'preferred',
    sensitivity: 'restricted',
    supersedes: [],
    transformation: { kind: 'none' },
    visibility: 'model',
  }),
  id: 'visible-history-fallback',
  order: 12,
}
