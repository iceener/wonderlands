import { Buffer } from 'node:buffer'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

export interface NormalizedMcpToolOutput {
  content: Array<
    | { text: string; type: 'text' }
    | {
        resource: {
          mimeType?: string
          text: string
          uri: string
        }
        type: 'resource'
      }
    | {
        description?: string
        mimeType?: string
        name: string
        title?: string
        type: 'resource_link'
        uri: string
      }
  >
  meta: Record<string, unknown> | null
  ok: true
  structuredContent: Record<string, unknown> | null
}

const MAX_RESOURCE_TEXT_BYTES = 32_768
const MAX_TOOL_OUTPUT_BYTES = 131_072

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const extractErrorMessage = (result: CallToolResult): string => {
  const textParts = result.content
    .filter(
      (block): block is Extract<CallToolResult['content'][number], { type: 'text' }> =>
        block.type === 'text',
    )
    .map((block) => block.text.trim())
    .filter((value) => value.length > 0)

  return textParts.length > 0 ? textParts.join('\n') : 'MCP tool reported an error'
}

const normalizeContentBlock = (
  block: CallToolResult['content'][number],
): Result<NormalizedMcpToolOutput['content'][number], DomainError> => {
  switch (block.type) {
    case 'text':
      return ok({
        text: block.text,
        type: 'text',
      })
    case 'resource':
      if ('blob' in block.resource) {
        return err({
          message: 'MCP tool returned an inline binary resource, which is not supported yet',
          type: 'validation',
        })
      }

      if (Buffer.byteLength(block.resource.text, 'utf8') > MAX_RESOURCE_TEXT_BYTES) {
        return err({
          message: 'MCP tool returned a resource body that exceeds the current inline size limit',
          type: 'capacity',
        })
      }

      return ok({
        resource: {
          mimeType: block.resource.mimeType,
          text: block.resource.text,
          uri: block.resource.uri,
        },
        type: 'resource',
      })
    case 'resource_link':
      return ok({
        description: block.description,
        mimeType: block.mimeType,
        name: block.name,
        title: block.title,
        type: 'resource_link',
        uri: block.uri,
      })
    case 'audio':
    case 'image':
      return err({
        message: `MCP tool returned unsupported ${block.type} content`,
        type: 'validation',
      })
  }
}

export const normalizeMcpCallToolResult = (
  result: CallToolResult,
): Result<NormalizedMcpToolOutput, DomainError> => {
  if (result.isError) {
    return err({
      message: extractErrorMessage(result),
      type: 'conflict',
    })
  }

  const normalizedContent: NormalizedMcpToolOutput['content'] = []

  for (const block of result.content) {
    const normalizedBlock = normalizeContentBlock(block)

    if (!normalizedBlock.ok) {
      return normalizedBlock
    }

    normalizedContent.push(normalizedBlock.value)
  }

  const normalizedOutput: NormalizedMcpToolOutput = {
    content: normalizedContent,
    meta: isRecord(result._meta) ? result._meta : null,
    ok: true,
    structuredContent: isRecord(result.structuredContent) ? result.structuredContent : null,
  }

  if (Buffer.byteLength(JSON.stringify(normalizedOutput), 'utf8') > MAX_TOOL_OUTPUT_BYTES) {
    return err({
      message: 'MCP tool result exceeds the current serialized output limit',
      type: 'capacity',
    })
  }

  return ok(normalizedOutput)
}
