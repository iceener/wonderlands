import { LangfuseAPIError } from '@langfuse/core'

import type { DomainError } from '../../../../shared/errors'

export const isRetryableLangfuseStatusCode = (statusCode: number | undefined): boolean => {
  if (statusCode === undefined) {
    return true
  }

  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500
}

export const toLangfuseProviderError = (
  prefix: string,
  error: unknown,
): Extract<DomainError, { type: 'provider' }> => {
  if (error instanceof LangfuseAPIError) {
    return {
      message: `${prefix}: ${error.message}`,
      provider: 'langfuse',
      retryable: isRetryableLangfuseStatusCode(error.statusCode),
      statusCode: error.statusCode,
      type: 'provider',
    }
  }

  return {
    message: error instanceof Error ? `${prefix}: ${error.message}` : prefix,
    provider: 'langfuse',
    retryable: true,
    type: 'provider',
  }
}
