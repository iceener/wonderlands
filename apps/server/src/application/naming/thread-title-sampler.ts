import type { SessionMessageRecord } from '../../domain/sessions/session-message-repository'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { ThreadNamingTrigger } from './thread-title-events'

const LARGE_TEXT_PASTE_METADATA_START = '<!-- large-paste:metadata:start -->'
const LARGE_TEXT_PASTE_METADATA_END = '<!-- large-paste:metadata:end -->'
const MAX_MESSAGE_LENGTH = 5_000
const MAX_COMBINED_LENGTH = 24_000
const OMITTED_MARKER = '\n\n[...]\n\n'

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const LARGE_TEXT_PASTE_METADATA_PATTERN = new RegExp(
  `${escapeRegex(LARGE_TEXT_PASTE_METADATA_START)}[\\s\\S]*?${escapeRegex(LARGE_TEXT_PASTE_METADATA_END)}`,
  'g',
)

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n')

const normalizeExcerpt = (value: string): string =>
  normalizeLineEndings(value).replace(/\s+/g, ' ').trim()

const stripLargeTextPasteHiddenMetadata = (value: string): string =>
  normalizeLineEndings(value).replace(LARGE_TEXT_PASTE_METADATA_PATTERN, '').trim()

const toMessageText = (message: SessionMessageRecord): string =>
  message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n')

const trimLongExcerpt = (value: string): string => {
  if (value.length <= MAX_MESSAGE_LENGTH) {
    return value
  }

  const segmentLength = Math.max(1, Math.floor(value.length * 0.3))

  return `${value.slice(0, segmentLength)}${OMITTED_MARKER}${value.slice(value.length - segmentLength)}`
}

const normalizeMessageText = (message: SessionMessageRecord): string => {
  const rawText = toMessageText(message)
  const visibleText =
    message.authorKind === 'user' ? stripLargeTextPasteHiddenMetadata(rawText) : rawText

  return normalizeExcerpt(visibleText)
}

const capCombinedSource = (value: string): string =>
  value.length <= MAX_COMBINED_LENGTH ? value : value.slice(0, MAX_COMBINED_LENGTH).trimEnd()

const sampleAutoFirstMessage = (messages: SessionMessageRecord[]): Result<string, DomainError> => {
  const firstUserMessage = messages.find((message) => message.authorKind === 'user')

  if (!firstUserMessage) {
    return err({
      message: 'thread naming could not find a first user message',
      type: 'validation',
    })
  }

  const visibleText = normalizeMessageText(firstUserMessage)

  if (!visibleText) {
    return err({
      message: 'thread naming first user message did not contain visible text',
      type: 'validation',
    })
  }

  return ok(trimLongExcerpt(visibleText))
}

const sampleManualRegenerate = (messages: SessionMessageRecord[]): Result<string, DomainError> => {
  const selectedMessages = [
    ...messages.slice(0, 3),
    ...messages.slice(Math.max(0, messages.length - 5)),
  ]
  const seenMessageIds = new Set<string>()
  const sections: string[] = []

  for (const message of selectedMessages) {
    if (seenMessageIds.has(message.id)) {
      continue
    }

    seenMessageIds.add(message.id)

    const visibleText = normalizeMessageText(message)

    if (!visibleText) {
      continue
    }

    sections.push(`${message.authorKind}:\n${trimLongExcerpt(visibleText)}`)
  }

  if (sections.length === 0) {
    return err({
      message: 'thread naming regenerate could not find any visible thread text',
      type: 'validation',
    })
  }

  return ok(capCombinedSource(sections.join('\n\n')))
}

export const sampleThreadTitleSourceText = (
  messages: SessionMessageRecord[],
  trigger: ThreadNamingTrigger,
): Result<string, DomainError> => {
  switch (trigger) {
    case 'auto_first_message':
      return sampleAutoFirstMessage(messages)
    case 'manual_regenerate':
      return sampleManualRegenerate(messages)
  }
}
