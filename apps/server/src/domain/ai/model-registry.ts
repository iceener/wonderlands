import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { AiModelRegistry, AiModelTarget, AiProviderName } from './types'

interface ResolveAiModelInput {
  model?: string
  modelAlias?: string
  provider?: AiProviderName
}

const resolveDefaultTarget = (registry: AiModelRegistry): Result<AiModelTarget, DomainError> => {
  const target = registry.aliases[registry.defaultAlias]

  if (!target) {
    return err({
      message: `AI model registry is missing default alias "${registry.defaultAlias}"`,
      type: 'validation',
    })
  }

  return ok(target)
}

export const resolveAiModelTarget = (
  registry: AiModelRegistry,
  input: ResolveAiModelInput,
): Result<AiModelTarget, DomainError> => {
  if (input.model) {
    const defaultTarget = resolveDefaultTarget(registry)

    if (!defaultTarget.ok) {
      return defaultTarget
    }

    return ok({
      model: input.model,
      provider: input.provider ?? defaultTarget.value.provider,
    })
  }

  if (input.provider) {
    const providerDefaultAlias = `${input.provider}_default`
    const providerTarget = registry.aliases[providerDefaultAlias]

    if (!providerTarget) {
      return err({
        message: `AI model registry is missing provider default alias "${providerDefaultAlias}"`,
        type: 'validation',
      })
    }

    return ok(providerTarget)
  }

  const alias = input.modelAlias ?? registry.defaultAlias
  const target = registry.aliases[alias]

  if (!target) {
    return err({
      message: `Unknown AI model alias "${alias}"`,
      type: 'validation',
    })
  }

  return ok(target)
}
