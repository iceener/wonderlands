import { isRecord } from '../../../../domain/ai/json-utils'
import { asString } from './normalization'

export const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export const toStructuredContentPart = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null
  }

  const type = asString(value.type)

  if (!type) {
    return null
  }

  if (type === 'text') {
    const text = asString(value.text)

    if (!text) {
      return null
    }

    return {
      ...(value.thought === true ? { thought: true } : {}),
      ...(asString(value.thoughtSignature) ? { thoughtSignature: value.thoughtSignature } : {}),
      text,
      type,
    }
  }

  if (type === 'image_url') {
    const url = asString(value.url)

    if (!url) {
      return null
    }

    return {
      ...(asString(value.mimeType) ? { mimeType: value.mimeType } : {}),
      image_url: {
        ...(asString(value.detail) ? { detail: value.detail } : {}),
        url,
      },
      type,
    }
  }

  if (type === 'image_file') {
    const fileId = asString(value.fileId)

    if (!fileId) {
      return null
    }

    return {
      ...(asString(value.detail) ? { detail: value.detail } : {}),
      ...(asString(value.mimeType) ? { mimeType: value.mimeType } : {}),
      fileId,
      type,
    }
  }

  if (type === 'file_url') {
    const url = asString(value.url)

    if (!url) {
      return null
    }

    return {
      ...(asString(value.filename) ? { filename: value.filename } : {}),
      ...(asString(value.mimeType) ? { mimeType: value.mimeType } : {}),
      type,
      url,
    }
  }

  if (type === 'file_id') {
    const fileId = asString(value.fileId)

    if (!fileId) {
      return null
    }

    return {
      ...(asString(value.filename) ? { filename: value.filename } : {}),
      ...(asString(value.mimeType) ? { mimeType: value.mimeType } : {}),
      fileId,
      type,
    }
  }

  if (type === 'function_call') {
    const callId = asString(value.callId)
    const name = asString(value.name)
    const argumentsJson = asString(value.argumentsJson)

    if (!callId || !name || !argumentsJson) {
      return null
    }

    return {
      arguments: tryParseJson(argumentsJson),
      argumentsJson,
      callId,
      name,
      ...(asString(value.thoughtSignature) ? { thoughtSignature: value.thoughtSignature } : {}),
      type,
    }
  }

  if (type === 'function_result') {
    const callId = asString(value.callId)
    const name = asString(value.name)
    const outputJson = asString(value.outputJson)

    if (!callId || !name || !outputJson) {
      return null
    }

    return {
      callId,
      ...(value.isError === true ? { isError: true } : {}),
      name,
      output: tryParseJson(outputJson),
      outputJson,
      type,
    }
  }

  if (type === 'reasoning') {
    const id = asString(value.id)

    if (!id) {
      return null
    }

    return {
      ...(value.encryptedContent !== undefined ? { encryptedContent: value.encryptedContent } : {}),
      id,
      summary: value.summary ?? null,
      ...(asString(value.text) ? { text: value.text } : {}),
      ...(value.thought === true ? { thought: true } : {}),
      type,
    }
  }

  return { ...value, type }
}

export const toStructuredMessages = (
  value: unknown,
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const messages: Array<Record<string, unknown>> = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const role = asString(entry.role)

    if (!role) {
      continue
    }

    if (Array.isArray(entry.content)) {
      const content = entry.content.flatMap((part) => {
        const normalized = toStructuredContentPart(part)
        return normalized ? [normalized] : []
      })

      if (content.length === 0) {
        continue
      }

      const phase = asString(entry.phase)
      const providerMessageId = asString(entry.providerMessageId)
      messages.push({
        content,
        ...(phase ? { phase } : {}),
        ...(providerMessageId ? { providerMessageId } : {}),
        role,
      })
      continue
    }

    const content = asString(entry.content)

    if (!content) {
      continue
    }

    const phase = asString(entry.phase)
    const providerMessageId = asString(entry.providerMessageId)
    messages.push({
      content,
      ...(phase ? { phase } : {}),
      ...(providerMessageId ? { providerMessageId } : {}),
      role,
    })
  }

  return messages.length > 0 ? messages : undefined
}

export const toStructuredGenerationTools = (
  value: unknown,
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const tools: Array<Record<string, unknown>> = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const kind = asString(entry.kind) ?? asString(entry.type)
    const name = asString(entry.name)

    if (!kind || !name) {
      continue
    }

    tools.push({
      ...(asString(entry.description) ? { description: entry.description } : {}),
      kind,
      name,
      ...(isRecord(entry.parameters) ? { parameters: entry.parameters } : {}),
      ...(typeof entry.strict === 'boolean' ? { strict: entry.strict } : {}),
      type: kind,
    })
  }

  return tools.length > 0 ? tools : undefined
}

export const toStructuredNativeTools = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const nativeTools = value.flatMap((entry) =>
    typeof entry === 'string' && entry.trim().length > 0 ? [entry] : [],
  )

  return nativeTools.length > 0 ? nativeTools : undefined
}

export const toStructuredGenerationOutputItems = (
  value: unknown,
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const outputItems: Array<Record<string, unknown>> = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const type = asString(entry.type)

    if (!type) {
      continue
    }

    if (type === 'message') {
      const role = asString(entry.role)
      const content = Array.isArray(entry.content)
        ? entry.content.flatMap((part) => {
            const normalized = toStructuredContentPart(part)
            return normalized ? [normalized] : []
          })
        : []

      if (!role || content.length === 0) {
        continue
      }

      outputItems.push({
        content,
        ...(asString(entry.phase) ? { phase: entry.phase } : {}),
        ...(asString(entry.providerMessageId)
          ? { providerMessageId: entry.providerMessageId }
          : {}),
        role,
        type,
      })
      continue
    }

    if (type === 'function_call') {
      const callId = asString(entry.callId)
      const name = asString(entry.name)
      const argumentsJson = asString(entry.argumentsJson)

      if (!callId || !name || !argumentsJson) {
        continue
      }

      outputItems.push({
        ...(entry.arguments !== undefined ? { arguments: entry.arguments } : {}),
        argumentsJson,
        callId,
        name,
        ...(asString(entry.providerItemId) ? { providerItemId: entry.providerItemId } : {}),
        ...(asString(entry.thoughtSignature) ? { thoughtSignature: entry.thoughtSignature } : {}),
        type,
      })
      continue
    }

    if (type === 'reasoning') {
      const id = asString(entry.id)

      if (!id) {
        continue
      }

      outputItems.push({
        ...(entry.encryptedContent !== undefined
          ? { encryptedContent: entry.encryptedContent }
          : {}),
        id,
        summary: entry.summary ?? null,
        ...(asString(entry.text) ? { text: entry.text } : {}),
        ...(entry.thought === true ? { thought: true } : {}),
        type,
      })
    }
  }

  return outputItems.length > 0 ? outputItems : undefined
}

export const hasNonMessageOutputItem = (items: readonly Record<string, unknown>[]): boolean =>
  items.some((item) => item.type !== 'message')

export const toStructuredGenerationToolCalls = (
  value: unknown,
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const toolCalls: Array<Record<string, unknown>> = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const callId = asString(entry.callId)
    const name = asString(entry.name)
    const argumentsJson = asString(entry.argumentsJson)

    if (!callId || !name || !argumentsJson) {
      continue
    }

    toolCalls.push({
      ...(entry.arguments !== undefined ? { arguments: entry.arguments } : {}),
      argumentsJson,
      callId,
      name,
      ...(asString(entry.providerItemId) ? { providerItemId: entry.providerItemId } : {}),
      ...(asString(entry.thoughtSignature) ? { thoughtSignature: entry.thoughtSignature } : {}),
      type: 'function_call',
    })
  }

  return toolCalls.length > 0 ? toolCalls : undefined
}
