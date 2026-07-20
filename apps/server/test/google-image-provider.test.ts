import assert from 'node:assert/strict'
import type { Interactions } from '@google/genai-v2'
import { test } from 'vitest'

import {
  buildGoogleImageInteractionParams,
  normalizeGoogleImageResponse,
} from '../src/adapters/ai/google/google-image-provider'
import type { ResolvedAiImageGenerateRequest } from '../src/domain/ai/image-types'

const request: ResolvedAiImageGenerateRequest = {
  aspectRatio: '16:9',
  imageSize: '1K',
  model: 'gemini-3.1-flash-image',
  operation: 'generate',
  prompt: 'A pencil sketch of the sea',
}

type ContractCase = { name: string; run: () => void }
const contractCases: ContractCase[] = []
const contractCase = (name: string, run: () => void) => contractCases.push({ name, run })

contractCase('Google image request uses the v2 Interactions image response format', () => {
  assert.deepEqual(buildGoogleImageInteractionParams(request), {
    input: request.prompt,
    model: request.model,
    response_format: {
      aspect_ratio: '16:9',
      image_size: '1K',
      mime_type: 'image/jpeg',
      type: 'image',
    },
  })
})

contractCase('Google image response reads image content from model output steps', () => {
  const interaction = {
    id: 'interaction_test',
    model: request.model,
    status: 'completed',
    steps: [
      {
        content: [
          {
            data: Buffer.from('generated image').toString('base64'),
            mime_type: 'image/jpeg',
            type: 'image',
          },
        ],
        type: 'model_output',
      },
    ],
    usage: {
      total_input_tokens: 5,
      total_output_tokens: 7,
      total_tokens: 12,
    },
  } as Interactions.Interaction

  const response = normalizeGoogleImageResponse(request, interaction)

  assert.equal(response.images.length, 1)
  assert.equal(response.images[0]?.mimeType, 'image/jpeg')
  assert.equal(response.images[0]?.base64Data, Buffer.from('generated image').toString('base64'))
  assert.deepEqual(response.usage, {
    inputTokens: 5,
    outputTokens: 7,
    totalTokens: 12,
  })
})

test('Google image request and response contract matrix', () => {
  for (const contract of contractCases) {
    assert.doesNotThrow(contract.run, contract.name)
  }
})
