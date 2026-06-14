import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'

export interface BlobPutInput {
  data: Uint8Array
  storageKey: string
}

export interface BlobObject {
  byteLength: number
  storageKey: string
}

export interface BlobReadResult {
  body: Uint8Array
  storageKey: string
}

export interface BlobStore {
  delete: (storageKey: string) => Promise<Result<void, DomainError>>
  get: (storageKey: string) => Promise<Result<BlobReadResult, DomainError>>
  put: (input: BlobPutInput) => Promise<Result<BlobObject, DomainError>>
}
