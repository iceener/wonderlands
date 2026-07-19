import type { MessageAttachment } from '@wonderlands/contracts/chat'

export const cloneAttachments = (attachments: MessageAttachment[]): MessageAttachment[] =>
  attachments.map((attachment) => ({ ...attachment }))

export const mergeAttachments = (
  existing: MessageAttachment[],
  incoming: MessageAttachment[],
): MessageAttachment[] => {
  if (incoming.length === 0) {
    return cloneAttachments(existing)
  }

  const merged = cloneAttachments(existing)
  const seen = new Set(merged.map((attachment) => attachment.id))

  for (const attachment of incoming) {
    if (seen.has(attachment.id)) {
      continue
    }

    seen.add(attachment.id)
    merged.push({ ...attachment })
  }

  return merged
}

export const isMessageAttachment = (value: unknown): value is MessageAttachment => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const attachment = value as Partial<MessageAttachment>
  return (
    typeof attachment.id === 'string' &&
    typeof attachment.name === 'string' &&
    typeof attachment.size === 'number' &&
    typeof attachment.mime === 'string' &&
    (attachment.kind === 'image' || attachment.kind === 'file') &&
    typeof attachment.url === 'string' &&
    (attachment.thumbnailUrl === undefined || typeof attachment.thumbnailUrl === 'string')
  )
}

export const extractAttachmentsFromMetadata = (metadata: unknown): MessageAttachment[] => {
  if (typeof metadata !== 'object' || metadata === null) {
    return []
  }

  const raw = (metadata as Record<string, unknown>).attachments
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter(isMessageAttachment).map((attachment) => ({ ...attachment }))
}
