import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai'

import type { DomainError } from '../../../shared/errors'
import { DomainErrorException } from '../../../shared/errors'

interface OpenAiDomainErrorContext {
  requestFunctionToolNames?: string[]
}

const withToolContext = (message: string, context: OpenAiDomainErrorContext): string => {
  if (
    !message.includes('tools[') ||
    !Array.isArray(context.requestFunctionToolNames) ||
    context.requestFunctionToolNames.length === 0
  ) {
    return message
  }

  return `${message} Active function tools: ${context.requestFunctionToolNames.join(', ')}`
}

export const toOpenAiDomainError = (
  error: unknown,
  context: OpenAiDomainErrorContext = {},
): DomainError => {
  if (error instanceof DomainErrorException) {
    return error.domainError
  }

  if (error instanceof APIConnectionTimeoutError) {
    return {
      message: `OpenAI request timed out: ${error.message}`,
      type: 'timeout',
    }
  }

  if (error instanceof APIUserAbortError) {
    return {
      message: `OpenAI request was aborted: ${error.message}`,
      type: 'conflict',
    }
  }

  if (error instanceof RateLimitError) {
    return {
      message: `OpenAI rate limit reached: ${error.message}`,
      type: 'capacity',
    }
  }

  if (error instanceof AuthenticationError) {
    return {
      message: `OpenAI authentication failed: ${error.message}`,
      type: 'auth',
    }
  }

  if (error instanceof PermissionDeniedError) {
    return {
      message: `OpenAI permission denied: ${error.message}`,
      type: 'permission',
    }
  }

  if (error instanceof BadRequestError) {
    return {
      message: `OpenAI rejected the request: ${withToolContext(error.message, context)}`,
      type: 'validation',
    }
  }

  if (error instanceof NotFoundError) {
    return {
      message: `OpenAI resource not found: ${error.message}`,
      type: 'not_found',
    }
  }

  if (error instanceof ConflictError) {
    return {
      message: `OpenAI request conflicted with provider state: ${error.message}`,
      type: 'conflict',
    }
  }

  if (error instanceof APIConnectionError) {
    return {
      message: `OpenAI connection failed: ${error.message}`,
      provider: 'openai',
      type: 'provider',
    }
  }

  if (error instanceof APIError) {
    return {
      message: `OpenAI provider error: ${error.message}`,
      provider: 'openai',
      type: 'provider',
    }
  }

  const message = error instanceof Error ? error.message : 'Unknown OpenAI adapter failure'

  return {
    message,
    provider: 'openai',
    type: 'provider',
  }
}
