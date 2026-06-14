export type DomainError =
  | { type: 'validation'; message: string }
  | { type: 'auth'; message: string }
  | { type: 'permission'; message: string }
  | { type: 'not_found'; message: string }
  | { type: 'conflict'; message: string }
  | { type: 'capacity'; message: string }
  | {
      type: 'provider'
      provider: string
      message: string
      retryable?: boolean
      statusCode?: number
    }
  | { type: 'timeout'; message: string }

export class DomainErrorException extends Error {
  constructor(public readonly domainError: DomainError) {
    super(domainError.message)
    this.name = 'DomainErrorException'
  }
}

export const isDomainErrorException = (value: unknown): value is DomainErrorException =>
  value instanceof DomainErrorException

export const toHttpStatus = (error: DomainError): number => {
  switch (error.type) {
    case 'validation':
      return 400
    case 'auth':
      return 401
    case 'permission':
      return 403
    case 'not_found':
      return 404
    case 'conflict':
      return 409
    case 'capacity':
      return 429
    case 'provider':
      return 502
    case 'timeout':
      return 504
  }
}
