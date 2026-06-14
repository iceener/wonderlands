import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

import type { DomainError } from '../../shared/errors'

export const toMcpDomainError = (serverId: string, error: unknown): DomainError => {
  if (error instanceof StreamableHTTPError) {
    if (error.code === 408 || error.code === 504) {
      return {
        message: `MCP server ${serverId} timed out`,
        type: 'timeout',
      }
    }

    return {
      message: `MCP server ${serverId} returned HTTP ${error.code ?? 'unknown'}: ${error.message}`,
      provider: `mcp:${serverId}`,
      type: 'provider',
    }
  }

  if (error instanceof McpError) {
    switch (error.code) {
      case ErrorCode.RequestTimeout:
        return {
          message: `MCP request to ${serverId} timed out`,
          type: 'timeout',
        }
      case ErrorCode.InvalidParams:
        return {
          message: error.message,
          type: 'validation',
        }
      case ErrorCode.MethodNotFound:
        return {
          message: error.message,
          type: 'not_found',
        }
      default:
        return {
          message: error.message,
          provider: `mcp:${serverId}`,
          type: 'provider',
        }
    }
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || /timed? out/i.test(error.message)) {
      return {
        message: error.message,
        type: 'timeout',
      }
    }

    return {
      message: error.message,
      provider: `mcp:${serverId}`,
      type: 'provider',
    }
  }

  return {
    message: `Unknown MCP failure for server ${serverId}`,
    provider: `mcp:${serverId}`,
    type: 'provider',
  }
}
