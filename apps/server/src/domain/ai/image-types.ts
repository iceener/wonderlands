import type { AiProviderName } from './types'

export type AiImageOperationKind = 'generate' | 'edit'
export type AiImageAspectRatio =
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9'
  | '1:8'
  | '8:1'
  | '1:4'
  | '4:1'
export type AiImageSize = '0.5K' | '1K' | '2K' | '4K'

export interface AiImageReferenceInput {
  dataBase64: string
  mimeType: string
}

export interface AiImageGenerateRequest {
  abortSignal?: AbortSignal
  aspectRatio?: AiImageAspectRatio
  imageSize?: AiImageSize
  maxRetries?: number
  model?: string
  modelAlias?: string
  operation: AiImageOperationKind
  prompt: string
  provider?: AiProviderName
  references?: AiImageReferenceInput[]
  timeoutMs?: number
}

export interface ResolvedAiImageGenerateRequest
  extends Omit<AiImageGenerateRequest, 'model' | 'provider'> {
  model: string
  provider: AiProviderName
}

export interface AiGeneratedImage {
  base64Data: string
  mimeType: string
}

export interface AiImageUsage {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
}

export interface AiImageGenerateResponse {
  images: AiGeneratedImage[]
  model: string
  operation: AiImageOperationKind
  provider: AiProviderName
  raw: unknown
  usage: AiImageUsage | null
}

export interface AiImageModelTarget {
  model: string
  provider: AiProviderName
}

export interface AiImageModelRegistry {
  aliases: Record<string, AiImageModelTarget>
  defaultAliases: {
    edit: string | null
    generate: string | null
  }
}
