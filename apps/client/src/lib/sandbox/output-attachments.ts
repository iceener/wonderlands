import type { Block, MessageAttachment } from '@wonderlands/contracts/chat'
import type { BackendSandboxExecutionFile } from '../services/api'
import { toApiUrl } from '../services/backend'

const sandboxExecutionToolNames = new Set(['execute'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isSandboxExecutionToolName = (value: unknown): value is string =>
  typeof value === 'string' && sandboxExecutionToolNames.has(value)

export const isSandboxExecutionFile = (value: unknown): value is BackendSandboxExecutionFile =>
  isRecord(value) &&
  typeof value.fileId === 'string' &&
  (value.mimeType === null || typeof value.mimeType === 'string') &&
  (value.originalFilename === null || typeof value.originalFilename === 'string') &&
  typeof value.sandboxPath === 'string' &&
  (value.sizeBytes === null || typeof value.sizeBytes === 'number')

export const toSandboxFileAttachment = (file: BackendSandboxExecutionFile): MessageAttachment => {
  const mime = file.mimeType ?? 'application/octet-stream'
  const url = toApiUrl(`/files/${file.fileId}/content`)

  return {
    id: file.fileId,
    kind: mime.startsWith('image/') ? 'image' : 'file',
    mime,
    name: file.originalFilename ?? file.sandboxPath.split('/').pop() ?? file.fileId,
    size: file.sizeBytes ?? 0,
    thumbnailUrl: mime.startsWith('image/') ? url : undefined,
    url,
  }
}

const splitAttachmentDisplayName = (name: string): { extension: string; stem: string } => {
  const lastDot = name.lastIndexOf('.')

  if (lastDot <= 0) {
    return {
      extension: '',
      stem: name,
    }
  }

  return {
    extension: name.slice(lastDot),
    stem: name.slice(0, lastDot),
  }
}

const dedupeAttachmentDisplayNames = (
  attachments: readonly MessageAttachment[],
): MessageAttachment[] => {
  const usedNames = new Set<string>()

  return attachments.map((attachment) => {
    if (!usedNames.has(attachment.name)) {
      usedNames.add(attachment.name)
      return attachment
    }

    const { extension, stem } = splitAttachmentDisplayName(attachment.name)
    let index = 2
    let candidate = `${stem} (${index})${extension}`

    while (usedNames.has(candidate)) {
      index += 1
      candidate = `${stem} (${index})${extension}`
    }

    usedNames.add(candidate)
    return {
      ...attachment,
      name: candidate,
    }
  })
}

export const extractSandboxOutputAttachments = (blocks: readonly Block[]): MessageAttachment[] => {
  const attachments: MessageAttachment[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (block.type !== 'tool_interaction' || !isSandboxExecutionToolName(block.name)) {
      continue
    }

    if (!isRecord(block.output) || !Array.isArray(block.output.files)) {
      continue
    }

    for (const file of block.output.files) {
      if (!isSandboxExecutionFile(file) || seen.has(file.fileId)) {
        continue
      }

      seen.add(file.fileId)
      attachments.push(toSandboxFileAttachment(file))
    }
  }

  return dedupeAttachmentDisplayNames(attachments)
}
