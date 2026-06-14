import { createHash } from 'node:crypto'

import OpenAI from 'openai'

import type { ResolvedAiInteractionRequest } from '../../../domain/ai/types'
import { decodeDataUrl } from '../../../shared/data-url'
import { DomainErrorException } from '../../../shared/errors'

interface NormalizeOpenAiInputImagesOptions {
  defaultTimeoutMs: number
  uploadCache?: Map<string, Promise<string>>
}

const guessImageFileExtension = (mimeType: string | null): string => {
  if (!mimeType || !mimeType.includes('/')) {
    return 'bin'
  }

  const subtype = mimeType.split('/')[1]?.toLowerCase() ?? 'bin'

  switch (subtype) {
    case 'jpeg':
      return 'jpg'
    case 'svg+xml':
      return 'svg'
    default:
      return subtype
  }
}

const createUploadCacheKey = (url: string): string => createHash('sha256').update(url).digest('hex')

const uploadVisionImage = async (
  client: OpenAI,
  request: ResolvedAiInteractionRequest,
  url: string,
  mimeTypeHint: string | null | undefined,
  cache: Map<string, Promise<string>>,
  defaultTimeoutMs: number,
): Promise<string> => {
  const cacheKey = createUploadCacheKey(url)
  const cached = cache.get(cacheKey)

  if (cached) {
    return cached
  }

  const uploadPromise = (async () => {
    const decoded = decodeDataUrl(url)

    if (!decoded || !decoded.isBase64) {
      throw new DomainErrorException({
        message: 'OpenAI image uploads expect base64 data URLs for inline image content',
        type: 'validation',
      })
    }

    const mimeType = mimeTypeHint ?? decoded.mimeType ?? 'application/octet-stream'

    if (!mimeType.startsWith('image/')) {
      throw new DomainErrorException({
        message: `OpenAI inline image input must use an image MIME type, received "${mimeType}"`,
        type: 'validation',
      })
    }

    const upload = await OpenAI.toFile(
      decoded.body,
      `inline-image.${guessImageFileExtension(mimeType)}`,
      {
        type: mimeType,
      },
    )
    const uploadedFile = await client.files.create(
      {
        file: upload,
        purpose: 'vision',
      },
      {
        signal: request.abortSignal,
        timeout: request.timeoutMs ?? defaultTimeoutMs,
      },
    )

    return uploadedFile.id
  })()

  cache.set(cacheKey, uploadPromise)

  try {
    return await uploadPromise
  } catch (error) {
    cache.delete(cacheKey)
    throw error
  }
}

export const normalizeOpenAiInputImages = async (
  client: OpenAI,
  request: ResolvedAiInteractionRequest,
  options: NormalizeOpenAiInputImagesOptions,
): Promise<ResolvedAiInteractionRequest> => {
  const hasInlineImages = request.messages.some((message) =>
    message.content.some((part) => part.type === 'image_url' && part.url.startsWith('data:')),
  )

  if (!hasInlineImages) {
    return request
  }

  const uploadCache = options.uploadCache ?? new Map<string, Promise<string>>()
  const normalizedMessages = await Promise.all(
    request.messages.map(async (message) => {
      let changed = false
      const normalizedContent = await Promise.all(
        message.content.map(async (part) => {
          if (part.type !== 'image_url' || !part.url.startsWith('data:')) {
            return part
          }

          changed = true
          const fileId = await uploadVisionImage(
            client,
            request,
            part.url,
            part.mimeType,
            uploadCache,
            options.defaultTimeoutMs,
          )

          return {
            detail: part.detail,
            fileId,
            mimeType: part.mimeType,
            type: 'image_file' as const,
          }
        }),
      )

      return changed ? { ...message, content: normalizedContent } : message
    }),
  )

  return {
    ...request,
    messages: normalizedMessages,
  }
}
