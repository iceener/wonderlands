import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type {
  AiCancelRequest,
  AiCancelResult,
  AiInteractionResponse,
  AiProviderName,
  AiStreamEvent,
  ResolvedAiInteractionRequest,
} from './types'

export interface AiProvider {
  cancel: (request: AiCancelRequest) => Promise<Result<AiCancelResult, DomainError>>
  configured: boolean
  generate: (
    request: ResolvedAiInteractionRequest,
  ) => Promise<Result<AiInteractionResponse, DomainError>>
  name: AiProviderName
  stream: (
    request: ResolvedAiInteractionRequest,
  ) => Promise<Result<AsyncIterable<AiStreamEvent>, DomainError>>
}
