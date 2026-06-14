import { OpenRouter } from '@openrouter/sdk'
import type { ChatResult } from '@openrouter/sdk/models'

import type { AiImageProvider } from '../../../domain/ai/image-provider'
import type {
  AiGeneratedImage,
  AiImageGenerateResponse,
  AiImageReferenceInput,
  ResolvedAiImageGenerateRequest,
} from '../../../domain/ai/image-types'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { toOpenRouterDomainError } from './openrouter-domain-error'
import type { OpenRouterProviderConfig } from './openrouter-provider'

const resolveConfigured = (config: OpenRouterProviderConfig): boolean => Boolean(config.apiKey)

const notConfiguredError = (): Result<never, DomainError> =>
  err({
    message: 'OpenRouter image provider is not configured',
    provider: 'openrouter',
    type: 'provider',
  })

const toRequestOptions = (
  request: Pick<ResolvedAiImageGenerateRequest, 'abortSignal' | 'maxRetries' | 'timeoutMs'>,
  config: Pick<OpenRouterProviderConfig, 'maxRetries' | 'timeoutMs'>,
) => ({
  retries:
    (request.maxRetries ?? config.maxRetries) > 0
      ? {
          retryConnectionErrors: true,
          strategy: 'backoff' as const,
        }
      : {
          strategy: 'none' as const,
        },
  signal: request.abortSignal,
  timeoutMs: request.timeoutMs ?? config.timeoutMs,
})

const toDataUrl = (reference: AiImageReferenceInput): string =>
  `data:${reference.mimeType};base64,${reference.dataBase64}`

const toChatMessages = (
  request: ResolvedAiImageGenerateRequest,
): Array<
  | { content: string; role: 'user' }
  | {
      content: Array<
        { text: string; type: 'text' } | { imageUrl: { url: string }; type: 'image_url' }
      >
      role: 'user'
    }
> => {
  if (!request.references || request.references.length === 0) {
    return [
      {
        content: request.prompt,
        role: 'user',
      },
    ]
  }

  return [
    {
      content: [
        {
          text: request.prompt,
          type: 'text',
        },
        ...request.references.map((reference) => ({
          imageUrl: {
            url: toDataUrl(reference),
          },
          type: 'image_url' as const,
        })),
      ],
      role: 'user',
    },
  ]
}

const parseDataUrlImage = (url: string): AiGeneratedImage | null => {
  const match = url.match(/^data:(?<mimeType>[^;]+);base64,(?<base64Data>.+)$/u)

  if (!match?.groups?.mimeType || !match.groups.base64Data) {
    return null
  }

  return {
    base64Data: match.groups.base64Data,
    mimeType: match.groups.mimeType,
  }
}

const normalizeImageResponse = (
  request: ResolvedAiImageGenerateRequest,
  response: ChatResult,
): AiImageGenerateResponse => {
  const images = response.choices.flatMap((choice) =>
    (choice.message.images ?? []).flatMap((image) => {
      const url = image.imageUrl.url
      const parsed = parseDataUrlImage(url)

      return parsed ? [parsed] : []
    }),
  )
  const operation = request.references && request.references.length > 0 ? 'edit' : 'generate'

  return {
    images,
    model: request.model,
    operation,
    provider: 'openrouter',
    raw: response,
    usage: response.usage
      ? {
          inputTokens: response.usage.promptTokens ?? null,
          outputTokens: response.usage.completionTokens ?? null,
          totalTokens: response.usage.totalTokens ?? null,
        }
      : null,
  }
}

export const createOpenRouterImageProvider = (
  config: OpenRouterProviderConfig,
): AiImageProvider => {
  const configured = resolveConfigured(config)
  const client =
    configured && config.apiKey
      ? new OpenRouter({
          apiKey: config.apiKey,
          appCategories: config.appCategories ?? undefined,
          appTitle: config.appTitle ?? undefined,
          httpReferer: config.httpReferer ?? undefined,
          serverURL: config.baseUrl ?? undefined,
          timeoutMs: config.timeoutMs,
        })
      : null

  return {
    configured,
    generate: async (request) => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        const response = await client.chat.send(
          {
            appCategories: config.appCategories ?? undefined,
            appTitle: config.appTitle ?? undefined,
            chatRequest: {
              imageConfig:
                request.aspectRatio || request.imageSize
                  ? {
                      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
                      ...(request.imageSize ? { image_size: request.imageSize } : {}),
                    }
                  : undefined,
              messages: toChatMessages(request),
              model: request.model,
              modalities: ['image'],
              stream: false,
            },
            httpReferer: config.httpReferer ?? undefined,
          },
          toRequestOptions(request, config),
        )

        return ok(normalizeImageResponse(request, response))
      } catch (error) {
        return err(toOpenRouterDomainError(error))
      }
    },
    name: 'openrouter',
  }
}
