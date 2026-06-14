import { resolveAiModelTarget } from '../../domain/ai/model-registry'
import type { AiProvider } from '../../domain/ai/provider'
import type {
  AiCancelRequest,
  AiCancelResult,
  AiInteractionRequest,
  AiInteractionResponse,
  AiModelRegistry,
  AiProviderName,
  AiStreamEvent,
  ResolvedAiInteractionRequest,
} from '../../domain/ai/types'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

export interface AiInteractionService {
  cancel: (request: AiCancelRequest) => Promise<Result<AiCancelResult, DomainError>>
  generate: (request: AiInteractionRequest) => Promise<Result<AiInteractionResponse, DomainError>>
  stream: (
    request: AiInteractionRequest,
  ) => Promise<Result<AsyncIterable<AiStreamEvent>, DomainError>>
}

export interface CreateAiInteractionServiceOptions {
  providers: Record<AiProviderName, AiProvider>
  registry: AiModelRegistry
}

const resolveInteractionRequest = (
  registry: AiModelRegistry,
  request: AiInteractionRequest,
): Result<ResolvedAiInteractionRequest, DomainError> => {
  const target = resolveAiModelTarget(registry, {
    model: request.model,
    modelAlias: request.modelAlias,
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

const requireConfiguredProvider = (
  providers: Record<AiProviderName, AiProvider>,
  providerName: AiProviderName,
): Result<AiProvider, DomainError> => {
  const provider = providers[providerName]

  if (!provider.configured) {
    return err({
      message: `${providerName} provider is not configured`,
      provider: providerName,
      type: 'provider',
    })
  }

  return ok(provider)
}

export const createAiInteractionService = ({
  providers,
  registry,
}: CreateAiInteractionServiceOptions): AiInteractionService => ({
  cancel: async (request) => {
    const provider = requireConfiguredProvider(providers, request.provider)

    if (!provider.ok) {
      return provider
    }

    return provider.value.cancel(request)
  },
  generate: async (request) => {
    const resolvedRequest = resolveInteractionRequest(registry, request)

    if (!resolvedRequest.ok) {
      return resolvedRequest
    }

    const provider = requireConfiguredProvider(providers, resolvedRequest.value.provider)

    if (!provider.ok) {
      return provider
    }

    return provider.value.generate(resolvedRequest.value)
  },
  stream: async (request) => {
    const resolvedRequest = resolveInteractionRequest(registry, request)

    if (!resolvedRequest.ok) {
      return resolvedRequest
    }

    const provider = requireConfiguredProvider(providers, resolvedRequest.value.provider)

    if (!provider.ok) {
      return provider
    }

    return provider.value.stream(resolvedRequest.value)
  },
})
