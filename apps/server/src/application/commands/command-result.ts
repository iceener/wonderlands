import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { Result } from '../../shared/result'

// Command APIs stay Result-based. This helper is only for transaction-local early exits.
export const unwrapCommandResultOrThrow = <TValue>(result: Result<TValue, DomainError>): TValue => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}
