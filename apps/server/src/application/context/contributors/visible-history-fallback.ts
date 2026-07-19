import type { SessionMessageRecord } from '../../../domain/sessions/session-message-repository'
import type { VisibleFileContextEntry } from '../../files/file-context'
import { toVisibleMessages } from '../../interactions/build-run-interaction-request'
import type { ContextContributor } from '../contracts'
import { toRunTranscriptMessages } from './run-transcript'

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
  id: 'visible-history-fallback',
  order: 12,
}
