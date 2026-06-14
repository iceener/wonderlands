import { GoogleGenAI, type Interactions } from '@google/genai'

import type { AiImageProvider } from '../../../domain/ai/image-provider'
import type {
  AiImageGenerateResponse,
  AiImageReferenceInput,
  ResolvedAiImageGenerateRequest,
} from '../../../domain/ai/image-types'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { toGoogleDomainError } from './google-domain-error'
import type { GoogleProviderConfig } from './google-provider'

const resolveConfigured = (config: GoogleProviderConfig): boolean =>
  Boolean(config.apiKey) || (config.vertexai && Boolean(config.project) && Boolean(config.location))

const notConfiguredError = (): Result<never, DomainError> =>
  err({
    message: 'Google image provider is not configured',
    provider: 'google',
    type: 'provider',
  })

const toRequestOptions = (
  request: Pick<ResolvedAiImageGenerateRequest, 'abortSignal' | 'maxRetries' | 'timeoutMs'>,
  config: GoogleProviderConfig,
): {
  maxRetries: number
  signal?: AbortSignal
  timeout: number
} => ({
  ...(request.abortSignal ? { signal: request.abortSignal } : {}),
  maxRetries: request.maxRetries ?? config.maxRetries,
  timeout: request.timeoutMs ?? config.defaultHttpTimeoutMs,
})

const toInteractionImageInput = (reference: AiImageReferenceInput): Interactions.ImageContent => ({
  data: reference.dataBase64,
  mime_type:
    reference.mimeType === 'image/png' ||
    reference.mimeType === 'image/jpeg' ||
    reference.mimeType === 'image/webp' ||
    reference.mimeType === 'image/heic' ||
    reference.mimeType === 'image/heif' ||
    reference.mimeType === 'image/gif' ||
    reference.mimeType === 'image/bmp' ||
    reference.mimeType === 'image/tiff'
      ? reference.mimeType
      : 'image/png',
  type: 'image',
})

const toInteractionInput = (
  request: ResolvedAiImageGenerateRequest,
): string | Interactions.Content[] => {
  if (!request.references || request.references.length === 0) {
    return request.prompt
  }

  return [
    {
      text: request.prompt,
      type: 'text',
    },
    ...request.references.map((reference) => toInteractionImageInput(reference)),
  ]
}

const normalizeImageResponse = (
  request: ResolvedAiImageGenerateRequest,
  interaction: Interactions.Interaction,
): AiImageGenerateResponse => ({
  images: (interaction.outputs ?? [])
    .filter((output): output is Interactions.ImageContent => output.type === 'image')
    .flatMap((output) =>
      typeof output.data === 'string' && output.data.length > 0
        ? [
            {
              base64Data: output.data,
              mimeType: output.mime_type ?? 'image/png',
            },
          ]
        : [],
    ),
  model: request.model,
  operation: request.operation,
  provider: 'google',
  raw: interaction,
  usage: interaction.usage
    ? {
        inputTokens: interaction.usage.total_input_tokens ?? null,
        outputTokens: interaction.usage.total_output_tokens ?? null,
        totalTokens: interaction.usage.total_tokens ?? null,
      }
    : null,
})

export const createGoogleImageProvider = (config: GoogleProviderConfig): AiImageProvider => {
  const configured = resolveConfigured(config)
  const client = configured
    ? new GoogleGenAI({
        apiKey: config.apiKey ?? undefined,
        apiVersion: config.apiVersion ?? undefined,
        httpOptions: {
          baseUrl: config.baseUrl ?? undefined,
          retryOptions: {
            attempts: config.maxRetries + 1,
          },
          timeout: config.defaultHttpTimeoutMs,
        },
        location: config.location ?? undefined,
        project: config.project ?? undefined,
        vertexai: config.vertexai,
      })
    : null

  return {
    configured,
    generate: async (request) => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        const interaction = (await client.interactions.create(
          {
            generation_config:
              request.aspectRatio || request.imageSize
                ? {
                    image_config: {
                      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
                      ...(request.imageSize
                        ? {
                            image_size: request.imageSize === '0.5K' ? '512' : request.imageSize,
                          }
                        : {}),
                    },
                  }
                : undefined,
            input: toInteractionInput(request),
            model: request.model,
            response_modalities: ['image'],
          },
          toRequestOptions(request, config),
        )) as Interactions.Interaction

        return ok(normalizeImageResponse(request, interaction))
      } catch (error) {
        return err(toGoogleDomainError(error))
      }
    },
    name: 'google',
  }
}
