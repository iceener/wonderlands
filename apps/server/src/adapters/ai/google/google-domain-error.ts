import { ApiError } from '@google/genai'

import type { DomainError } from '../../../shared/errors'
import { DomainErrorException } from '../../../shared/errors'

const isGoogleTimeoutError = (error: Error): boolean =>
  error.name === 'APIConnectionTimeoutError' ||
  /request timed out/i.test(error.message) ||
  ('cause' in error && /timed? ?out/i.test(String(error.cause ?? '')))

export const toGoogleDomainError = (error: unknown): DomainError => {
  if (error instanceof DomainErrorException) {
    return error.domainError
  }

  if (error instanceof ApiError) {
    if (error.status === 400) {
      return {
        message: `Google GenAI rejected the request: ${error.message}`,
        type: 'validation',
      }
    }

    if (error.status === 401) {
      return {
        message: `Google GenAI authentication failed: ${error.message}`,
        type: 'auth',
      }
    }

    if (error.status === 403) {
      return {
        message: `Google GenAI permission denied: ${error.message}`,
        type: 'permission',
      }
    }

    if (error.status === 404) {
      return {
        message: `Google GenAI resource not found: ${error.message}`,
        type: 'not_found',
      }
    }

    if (error.status === 409) {
      return {
        message: `Google GenAI request conflicted with provider state: ${error.message}`,
        type: 'conflict',
      }
    }

    if (error.status === 429) {
      return {
        message: `Google GenAI rate limit reached: ${error.message}`,
        type: 'capacity',
      }
    }

    if (error.status === 408 || error.status === 504) {
      return {
        message: `Google GenAI request timed out: ${error.message}`,
        type: 'timeout',
      }
    }

    return {
      message: `Google GenAI provider error (${error.status}): ${error.message}`,
      provider: 'google',
      type: 'provider',
    }
  }

  if (error instanceof Error && isGoogleTimeoutError(error)) {
    return {
      message: `Google GenAI request timed out: ${error.message}`,
      type: 'timeout',
    }
  }

  if (error instanceof Error && error.name === 'APIConnectionError') {
    return {
      message: `Google GenAI connection failed: ${error.message}`,
      provider: 'google',
      type: 'provider',
    }
  }

  if (error instanceof Error && error.name === 'AbortError') {
    // The SDK's retry layer throws AbortError for non-retryable HTTP status codes
    // (e.g. "Non-retryable exception Bad Request sending request" for 400).
    // Distinguish these from user-initiated aborts.
    if (/non-retryable exception.*bad request/i.test(error.message)) {
      return {
        message: `Google GenAI rejected the request: ${error.message}`,
        type: 'validation',
      }
    }

    if (isGoogleTimeoutError(error)) {
      return {
        message: `Google GenAI request timed out: ${error.message}`,
        type: 'timeout',
      }
    }

    if (/non-retryable exception/i.test(error.message)) {
      return {
        message: `Google GenAI request failed: ${error.message}`,
        provider: 'google',
        type: 'provider',
      }
    }

    return {
      message: `Google GenAI request was aborted: ${error.message}`,
      type: 'conflict',
    }
  }

  const message = error instanceof Error ? error.message : 'Unknown Google GenAI adapter failure'

  return {
    message,
    provider: 'google',
    type: 'provider',
  }
}
