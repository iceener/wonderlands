import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type { AiImageGenerateResponse, ResolvedAiImageGenerateRequest } from './image-types'
import type { AiProviderName } from './types'

export interface AiImageProvider {
  configured: boolean
  generate: (
    request: ResolvedAiImageGenerateRequest,
  ) => Promise<Result<AiImageGenerateResponse, DomainError>>
  name: AiProviderName
}
