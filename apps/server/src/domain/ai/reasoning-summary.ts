export const flattenReasoningSummaryText = (summary: unknown): string => {
  if (!Array.isArray(summary)) {
    return ''
  }

  const texts = summary.flatMap((part) => {
    if (
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'summary_text' &&
      'text' in part &&
      typeof part.text === 'string'
    ) {
      const text = part.text.trim()
      return text.length > 0 ? [text] : []
    }

    return []
  })

  return texts.join('\n\n').trim()
}
