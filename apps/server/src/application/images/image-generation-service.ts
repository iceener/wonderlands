import { resolveAiImageModelTarget } from '../../domain/ai/image-model-registry'
import type { AiImageProvider } from '../../domain/ai/image-provider'
import type {
  AiImageGenerateRequest,
  AiImageGenerateResponse,
  AiImageModelRegistry,
  AiImageOperationKind,
  ResolvedAiImageGenerateRequest,
} from '../../domain/ai/image-types'
import type { AiProviderName } from '../../domain/ai/types'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

export interface AiImageGenerationService {
  generate: (
    request: AiImageGenerateRequest,
  ) => Promise<Result<AiImageGenerateResponse, DomainError>>
  isOperationAvailable: (operation: AiImageOperationKind) => boolean
}

export interface CreateAiImageGenerationServiceOptions {
  providers: Partial<Record<AiProviderName, AiImageProvider>>
  registry: AiImageModelRegistry
}

const requireConfiguredProvider = (
  providers: Partial<Record<AiProviderName, AiImageProvider>>,
  providerName: AiProviderName,
): Result<AiImageProvider, DomainError> => {
  const provider = providers[providerName]

  if (!provider?.configured) {
    return err({
      message: `${providerName} image provider is not configured`,
      provider: providerName,
      type: 'provider',
    })
  }

  return ok(provider)
}

const resolveImageRequest = (
  registry: AiImageModelRegistry,
  request: AiImageGenerateRequest,
): Result<ResolvedAiImageGenerateRequest, DomainError> => {
  const target = resolveAiImageModelTarget(registry, {
    model: request.model,
    modelAlias: request.modelAlias,
    operation: request.operation,
    provider: request.provider,
  })

  if (!target.ok) {
    return target
  }

  return ok({
    ...request,
    model: target.value.model,
    provider: target.value.provider,
  })
}

export const createAiImageGenerationService = ({
  providers,
  registry,
}: CreateAiImageGenerationServiceOptions): AiImageGenerationService => ({
  generate: async (request) => {
    const resolvedRequest = resolveImageRequest(registry, request)

    if (!resolvedRequest.ok) {
      return resolvedRequest
    }

    const provider = requireConfiguredProvider(providers, resolvedRequest.value.provider)

    if (!provider.ok) {
      return provider
    }

    return provider.value.generate(resolvedRequest.value)
  },
  isOperationAvailable: (operation) => {
    const target = resolveAiImageModelTarget(registry, {
      model: undefined,
      modelAlias: undefined,
      operation,
      provider: undefined,
    })

    if (!target.ok) {
      return false
    }

    return Boolean(providers[target.value.provider]?.configured)
  },
})
