import type { AiInteractionResponse } from '../../domain/ai/types'
import type { ItemContentPart } from '../../domain/runtime/item-repository'

const normalizeText = (value: string): string => value.trim()

export const normalizeAssistantMessageContent = (
  response: AiInteractionResponse,
): ItemContentPart[] | null => {
  const textParts = response.messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.content)
    .flatMap((part) =>
      part.type === 'text' ? [{ text: normalizeText(part.text), type: 'text' as const }] : [],
    )
    .filter((part) => part.text.length > 0)

  if (textParts.length > 0) {
    return textParts
  }

  const outputText = normalizeText(response.outputText)

  if (outputText.length === 0) {
    return null
  }

  return [{ text: outputText, type: 'text' as const }]
}

export const normalizeAssistantOutputText = (response: AiInteractionResponse): string => {
  const outputText = normalizeText(response.outputText)

  if (outputText.length > 0) {
    return outputText
  }

  const assistantContent = normalizeAssistantMessageContent(response)

  if (!assistantContent) {
    return ''
  }

  return normalizeText(assistantContent.map((part) => part.text).join('\n\n'))
}
