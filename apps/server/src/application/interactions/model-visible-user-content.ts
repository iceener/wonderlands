import type { AiMessageContent } from '../../domain/ai/types'
import type {
  SessionMessageContentPart,
  SessionMessageRecord,
} from '../../domain/sessions/session-message-repository'
import type { FileId, SessionMessageId } from '../../shared/ids'
import type { VisibleFileContextEntry } from '../files/file-context'

interface MarkdownImageReference {
  end: number
  raw: string
  start: number
  url: string
}

const LOCAL_URL_BASE = 'https://local.invalid'
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])
const DURABLE_FILE_PREFIXES = ['/api/files/', '/v1/files/']

const isEscaped = (value: string, index: number): boolean => {
  let backslashCount = 0

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1
  }

  return backslashCount % 2 === 1
}

const findClosingBracket = (value: string, start: number): number => {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === ']' && !isEscaped(value, index)) {
      return index
    }
  }

  return -1
}

const findClosingParen = (value: string, start: number): number => {
  let depth = 0

  for (let index = start; index < value.length; index += 1) {
    const character = value[index]

    if (character === '\\' && !isEscaped(value, index)) {
      index += 1
      continue
    }

    if (character === '(') {
      depth += 1
      continue
    }

    if (character !== ')' || isEscaped(value, index)) {
      continue
    }

    if (depth === 0) {
      return index
    }

    depth -= 1
  }

  return -1
}

const readImageDestination = (value: string): string => {
  const trimmed = value.trim()

  if (trimmed.startsWith('<')) {
    const closingIndex = trimmed.indexOf('>')

    if (closingIndex > 1) {
      return trimmed.slice(1, closingIndex).trim()
    }
  }

  let depth = 0

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]

    if (character === '\\' && !isEscaped(trimmed, index)) {
      index += 1
      continue
    }

    if (character === '(') {
      depth += 1
      continue
    }

    if (character === ')' && depth > 0) {
      depth -= 1
      continue
    }

    if (/\s/.test(character) && depth === 0) {
      return trimmed.slice(0, index).trim()
    }
  }

  return trimmed
}

export const listMarkdownImageReferences = (markdown: string): MarkdownImageReference[] => {
  const references: MarkdownImageReference[] = []
  const source = markdown ?? ''

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '!' || source[index + 1] !== '[' || isEscaped(source, index)) {
      continue
    }

    const altEnd = findClosingBracket(source, index + 2)

    if (altEnd === -1 || source[altEnd + 1] !== '(') {
      continue
    }

    const destinationStart = altEnd + 2
    const destinationEnd = findClosingParen(source, destinationStart)

    if (destinationEnd === -1) {
      continue
    }

    const raw = source.slice(index, destinationEnd + 1)
    const url = readImageDestination(source.slice(destinationStart, destinationEnd))

    if (!url) {
      continue
    }

    references.push({
      end: destinationEnd + 1,
      raw,
      start: index,
      url,
    })

    index = destinationEnd
  }

  return references
}

const readUploadedFileId = (value: string): FileId | null => {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  try {
    const parsed = trimmed.startsWith('/') ? new URL(trimmed, LOCAL_URL_BASE) : new URL(trimmed)

    if (
      !trimmed.startsWith('/') &&
      !LOCALHOST_HOSTNAMES.has(parsed.hostname) &&
      parsed.origin !== LOCAL_URL_BASE
    ) {
      return null
    }

    const matchedPrefix = DURABLE_FILE_PREFIXES.find((prefix) => parsed.pathname.startsWith(prefix))

    if (!matchedPrefix) {
      return null
    }

    const remainder = parsed.pathname.slice(matchedPrefix.length)
    const [rawFileId = '', suffix = ''] = remainder.split('/', 2)

    if (!rawFileId || suffix !== 'content') {
      return null
    }

    return decodeURIComponent(rawFileId) as FileId
  } catch {
    return null
  }
}

const normalizeRemoteImageUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

const appendText = (content: AiMessageContent[], text: string): void => {
  if (text.length === 0) {
    return
  }

  const previous = content.at(-1)

  if (previous?.type === 'text') {
    previous.text += text
    return
  }

  content.push({
    text,
    type: 'text',
  })
}

const toInlineImagePart = (
  reference: MarkdownImageReference,
  imageFilesById: ReadonlyMap<FileId, VisibleFileContextEntry>,
): Extract<AiMessageContent, { type: 'image_url' }> | null => {
  const uploadedFileId = readUploadedFileId(reference.url)

  if (uploadedFileId) {
    const uploaded = imageFilesById.get(uploadedFileId)

    if (uploaded?.dataUrl) {
      return {
        ...(uploaded.mimeType ? { mimeType: uploaded.mimeType } : {}),
        type: 'image_url',
        url: uploaded.dataUrl,
      }
    }
  }

  const remoteUrl = normalizeRemoteImageUrl(reference.url)

  if (!remoteUrl) {
    return null
  }

  return {
    type: 'image_url',
    url: remoteUrl,
  }
}

export const buildModelVisibleMessageContent = (
  parts: SessionMessageContentPart[],
  imageFilesById: ReadonlyMap<FileId, VisibleFileContextEntry> = new Map(),
): AiMessageContent[] => {
  const content: AiMessageContent[] = []

  for (const part of parts) {
    if (part.type !== 'text') {
      continue
    }

    const references = listMarkdownImageReferences(part.text)

    if (references.length === 0) {
      appendText(content, part.text)
      continue
    }

    let cursor = 0

    for (const reference of references) {
      appendText(content, part.text.slice(cursor, reference.start))

      const imagePart = toInlineImagePart(reference, imageFilesById)

      if (imagePart) {
        content.push(imagePart)
      } else {
        appendText(content, reference.raw)
      }

      cursor = reference.end
    }

    appendText(content, part.text.slice(cursor))
  }

  return content
}

export const groupInlineImageFilesByMessageId = (
  visibleFiles: VisibleFileContextEntry[],
): Map<SessionMessageId, Map<FileId, VisibleFileContextEntry>> => {
  const grouped = new Map<SessionMessageId, Map<FileId, VisibleFileContextEntry>>()

  for (const entry of visibleFiles) {
    if (!entry.messageId || !entry.dataUrl || !entry.mimeType?.startsWith('image/')) {
      continue
    }

    let messageFiles = grouped.get(entry.messageId)

    if (!messageFiles) {
      messageFiles = new Map<FileId, VisibleFileContextEntry>()
      grouped.set(entry.messageId, messageFiles)
    }

    messageFiles.set(entry.fileId, entry)
  }

  return grouped
}

export const collectInlineReferencedUploadedFileIds = (
  visibleMessages: SessionMessageRecord[],
): Set<FileId> => {
  const referenced = new Set<FileId>()

  for (const message of visibleMessages) {
    for (const part of message.content) {
      if (part.type !== 'text') {
        continue
      }

      for (const reference of listMarkdownImageReferences(part.text)) {
        const fileId = readUploadedFileId(reference.url)

        if (fileId) {
          referenced.add(fileId)
        }
      }
    }
  }

  return referenced
}
