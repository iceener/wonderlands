import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type {
  AiImageGenerateRequest,
  AiImageModelRegistry,
  AiImageModelTarget,
  AiImageOperationKind,
} from './image-types'

const resolveDefaultAlias = (
  registry: AiImageModelRegistry,
  operation: AiImageOperationKind,
): Result<string, DomainError> => {
  const alias = registry.defaultAliases[operation]

  if (!alias) {
    return err({
      message: `Image generation is not configured for ${operation}`,
      provider: 'image',
      type: 'provider',
    })
  }

  return ok(alias)
}

export const resolveAiImageModelTarget = (
  registry: AiImageModelRegistry,
  input: Pick<AiImageGenerateRequest, 'model' | 'modelAlias' | 'operation' | 'provider'>,
): Result<AiImageModelTarget, DomainError> => {
  if (input.model) {
    if (!input.provider) {
      return err({
        message: 'Image generation requires a provider when model is specified directly',
        type: 'validation',
      })
    }

    return ok({
      model: input.model,
      provider: input.provider,
    })
  }

  const aliasResult = input.modelAlias
    ? ok(input.modelAlias)
    : resolveDefaultAlias(registry, input.operation)

  if (!aliasResult.ok) {
    return aliasResult
  }

  const target = registry.aliases[aliasResult.value]

  if (!target) {
    return err({
      message: `Image model registry is missing alias "${aliasResult.value}"`,
      provider: 'image',
      type: 'provider',
    })
  }

  if (input.provider && input.provider !== target.provider) {
    return err({
      message:
        `Image model alias "${aliasResult.value}" resolves to provider ${target.provider},` +
        ` not ${input.provider}`,
      type: 'validation',
    })
  }

  return ok(target)
}
