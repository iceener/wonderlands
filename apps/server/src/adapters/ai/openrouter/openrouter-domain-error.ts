import {
  BadGatewayResponseError,
  BadRequestResponseError,
  ConflictResponseError,
  ConnectionError,
  EdgeNetworkTimeoutResponseError,
  ForbiddenResponseError,
  InternalServerResponseError,
  InvalidRequestError,
  NotFoundResponseError,
  OpenRouterError,
  PayloadTooLargeResponseError,
  PaymentRequiredResponseError,
  ProviderOverloadedResponseError,
  RequestAbortedError,
  RequestTimeoutError,
  RequestTimeoutResponseError,
  ResponseValidationError,
  SDKValidationError,
  ServiceUnavailableResponseError,
  TooManyRequestsResponseError,
  UnauthorizedResponseError,
  UnprocessableEntityResponseError,
} from '@openrouter/sdk/models/errors'

import type { DomainError } from '../../../shared/errors'
import { DomainErrorException } from '../../../shared/errors'

const toProviderError = (
  message: string,
  options: {
    retryable?: boolean
    statusCode?: number
  } = {},
): DomainError => ({
  message,
  provider: 'openrouter',
  ...(options.retryable !== undefined ? { retryable: options.retryable } : {}),
  ...(options.statusCode !== undefined ? { statusCode: options.statusCode } : {}),
  type: 'provider',
})

export const toOpenRouterDomainError = (error: unknown): DomainError => {
  if (error instanceof DomainErrorException) {
    return error.domainError
  }

  if (error instanceof SDKValidationError || error instanceof InvalidRequestError) {
    return {
      message: `OpenRouter request is invalid: ${error.message}`,
      type: 'validation',
    }
  }

  if (error instanceof ResponseValidationError) {
    return toProviderError(`OpenRouter response validation failed: ${error.message}`)
  }

  if (error instanceof RequestTimeoutError || error instanceof RequestTimeoutResponseError) {
    return {
      message: `OpenRouter request timed out: ${error.message}`,
      type: 'timeout',
    }
  }

  if (error instanceof EdgeNetworkTimeoutResponseError) {
    return toProviderError(`OpenRouter edge network timed out: ${error.message}`, {
      retryable: true,
      statusCode: error.statusCode,
    })
  }

  if (error instanceof RequestAbortedError) {
    return {
      message: `OpenRouter request was aborted: ${error.message}`,
      type: 'conflict',
    }
  }

  if (error instanceof UnauthorizedResponseError) {
    return {
      message: `OpenRouter authentication failed: ${error.message}`,
      type: 'auth',
    }
  }

  if (error instanceof ForbiddenResponseError) {
    return {
      message: `OpenRouter permission denied: ${error.message}`,
      type: 'permission',
    }
  }

  if (
    error instanceof BadRequestResponseError ||
    error instanceof UnprocessableEntityResponseError
  ) {
    return {
      message: `OpenRouter rejected the request: ${error.message}`,
      type: 'validation',
    }
  }

  if (error instanceof PayloadTooLargeResponseError) {
    return {
      message: `OpenRouter request is too large: ${error.message}`,
      type: 'validation',
    }
  }

  if (error instanceof NotFoundResponseError) {
    return {
      message: `OpenRouter resource not found: ${error.message}`,
      type: 'not_found',
    }
  }

  if (error instanceof ConflictResponseError) {
    return {
      message: `OpenRouter request conflicted with provider state: ${error.message}`,
      type: 'conflict',
    }
  }

  if (error instanceof TooManyRequestsResponseError) {
    return {
      message: `OpenRouter rate limit reached: ${error.message}`,
      type: 'capacity',
    }
  }

  if (error instanceof PaymentRequiredResponseError) {
    return toProviderError(
      `OpenRouter credits or BYOK requirement blocked the request: ${error.message}`,
      {
        statusCode: error.statusCode,
      },
    )
  }

  if (
    error instanceof ProviderOverloadedResponseError ||
    error instanceof ServiceUnavailableResponseError ||
    error instanceof BadGatewayResponseError ||
    error instanceof InternalServerResponseError
  ) {
    return toProviderError(`OpenRouter provider error: ${error.message}`, {
      retryable: true,
      statusCode: error.statusCode,
    })
  }

  if (error instanceof ConnectionError) {
    return toProviderError(`OpenRouter connection failed: ${error.message}`, {
      retryable: true,
    })
  }

  if (error instanceof OpenRouterError) {
    return toProviderError(`OpenRouter provider error: ${error.message}`, {
      statusCode: error.statusCode,
    })
  }

  const message = error instanceof Error ? error.message : 'Unknown OpenRouter adapter failure'

  return toProviderError(message)
}
