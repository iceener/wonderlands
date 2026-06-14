import type { MessageAttachment } from '@wonderlands/contracts/chat'
import {
  getModelVisibleImageComparisonKey,
  listMarkdownImageReferences,
} from '../../../shared/markdown-images'

export const filterInlineRenderedImageAttachments = (
  attachments: MessageAttachment[],
  markdown: string,
): MessageAttachment[] => {
  const inlineKeys = new Set(
    listMarkdownImageReferences(markdown)
      .map((reference) => getModelVisibleImageComparisonKey(reference.url))
      .filter((value): value is string => value !== null),
  )

  if (inlineKeys.size === 0) {
    return attachments
  }

  return attachments.filter((attachment) => {
    if (attachment.kind !== 'image') {
      return true
    }

    const comparisonKey = getModelVisibleImageComparisonKey(attachment.url)
    return comparisonKey ? !inlineKeys.has(comparisonKey) : true
  })
}
