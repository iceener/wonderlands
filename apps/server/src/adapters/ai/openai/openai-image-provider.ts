import OpenAI, { toFile } from 'openai'
import type { ImagesResponse } from 'openai/resources/images'

import type { AiImageProvider } from '../../../domain/ai/image-provider'
import type {
  AiGeneratedImage,
  AiImageAspectRatio,
  AiImageGenerateResponse,
  AiImageReferenceInput,
  AiImageSize,
  ResolvedAiImageGenerateRequest,
} from '../../../domain/ai/image-types'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { toOpenAiDomainError } from './openai-domain-error'
import type { OpenAiProviderConfig } from './openai-provider'

const supportedOutputFormats = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const

const imageExtensions: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const portraitAspectRatios = new Set<AiImageAspectRatio>([
  '1:4',
  '1:8',
  '2:3',
  '3:4',
  '4:5',
  '9:16',
])
const landscapeAspectRatios = new Set<AiImageAspectRatio>([
  '16:9',
  '21:9',
  '3:2',
  '4:1',
  '4:3',
  '5:4',
  '8:1',
])

const resolveConfigured = (config: OpenAiProviderConfig): boolean => Boolean(config.apiKey)

const notConfiguredError = (): Result<never, DomainError> =>
  err({
    message: 'OpenAI image provider is not configured',
    provider: 'openai',
    type: 'provider',
  })

const toRequestOptions = (
  request: Pick<ResolvedAiImageGenerateRequest, 'abortSignal' | 'maxRetries' | 'timeoutMs'>,
  config: Pick<OpenAiProviderConfig, 'maxRetries' | 'timeoutMs'>,
) => ({
  ...(request.abortSignal ? { signal: request.abortSignal } : {}),
  maxRetries: request.maxRetries ?? config.maxRetries,
  timeout: request.timeoutMs ?? config.timeoutMs,
})

const toOpenAiSize = (
  aspectRatio: AiImageAspectRatio | undefined,
): '1024x1024' | '1024x1536' | '1536x1024' | undefined => {
  if (!aspectRatio || aspectRatio === '1:1') {
    return aspectRatio ? '1024x1024' : undefined
  }

  if (portraitAspectRatios.has(aspectRatio)) {
    return '1024x1536'
  }

  if (landscapeAspectRatios.has(aspectRatio)) {
    return '1536x1024'
  }

  return undefined
}

const toOpenAiQuality = (
  imageSize: AiImageSize | undefined,
): 'auto' | 'high' | 'low' | 'medium' | undefined => {
  switch (imageSize) {
    case '0.5K':
      return 'low'
    case '1K':
      return 'auto'
    case '2K':
      return 'medium'
    case '4K':
      return 'high'
    default:
      return undefined
  }
}

const toReferenceUpload = async (
  reference: AiImageReferenceInput,
  index: number,
): Promise<File> => {
  const extension = imageExtensions[reference.mimeType] ?? 'png'
  return toFile(
    Buffer.from(reference.dataBase64, 'base64'),
    `reference-${index + 1}.${extension}`,
    {
      type: reference.mimeType,
    },
  )
}

const toGeneratedImages = (
  response: ImagesResponse,
  defaultMimeType: AiGeneratedImage['mimeType'],
): AiGeneratedImage[] =>
  (response.data ?? []).flatMap((image) =>
    typeof image.b64_json === 'string' && image.b64_json.length > 0
      ? [
          {
            base64Data: image.b64_json,
            mimeType: defaultMimeType,
          },
        ]
      : [],
  )

const normalizeImageResponse = (
  request: ResolvedAiImageGenerateRequest,
  response: ImagesResponse,
): AiImageGenerateResponse => {
  const mimeType =
    (response.output_format ? supportedOutputFormats[response.output_format] : null) ?? 'image/png'
  const operation = request.references && request.references.length > 0 ? 'edit' : 'generate'

  return {
    images: toGeneratedImages(response, mimeType),
    model: request.model,
    operation,
    provider: 'openai',
    raw: response,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens ?? null,
          outputTokens: response.usage.output_tokens ?? null,
          totalTokens: response.usage.total_tokens ?? null,
        }
      : null,
  }
}

export const createOpenAiImageProvider = (config: OpenAiProviderConfig): AiImageProvider => {
  const configured = resolveConfigured(config)
  const client =
    configured && config.apiKey
      ? new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl ?? undefined,
          maxRetries: config.maxRetries,
          organization: config.organization ?? undefined,
          project: config.project ?? undefined,
          timeout: config.timeoutMs,
          webhookSecret: config.webhookSecret ?? undefined,
        })
      : null

  return {
    configured,
    generate: async (request) => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        const size = toOpenAiSize(request.aspectRatio)
        const quality = toOpenAiQuality(request.imageSize)

        const response =
          request.references && request.references.length > 0
            ? await client.images.edit(
                {
                  image: await Promise.all(
                    request.references.map((reference, index) =>
                      toReferenceUpload(reference, index),
                    ),
                  ),
                  model: request.model,
                  n: 1,
                  output_format: 'png',
                  prompt: request.prompt,
                  ...(quality ? { quality } : {}),
                  ...(size ? { size } : {}),
                },
                toRequestOptions(request, config),
              )
            : await client.images.generate(
                {
                  model: request.model,
                  n: 1,
                  output_format: 'png',
                  prompt: request.prompt,
                  ...(quality ? { quality } : {}),
                  ...(size ? { size } : {}),
                },
                toRequestOptions(request, config),
              )

        return ok(normalizeImageResponse(request, response))
      } catch (error) {
        return err(toOpenAiDomainError(error))
      }
    },
    name: 'openai',
  }
}
