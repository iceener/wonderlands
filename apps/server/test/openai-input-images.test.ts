import assert from 'node:assert/strict'
import { test } from 'vitest'
import { normalizeOpenAiInputImages } from '../src/adapters/ai/openai/openai-input-images'
import type { ResolvedAiInteractionRequest } from '../src/domain/ai/types'

const createRequest = (imageUrl: string): ResolvedAiInteractionRequest => ({
  messages: [
    {
      content: [
        { text: 'Describe the uploaded image.', type: 'text' },
        {
          detail: 'high',
          mimeType: 'image/png',
          type: 'image_url',
          url: imageUrl,
        },
      ],
      role: 'user',
    },
  ],
  model: 'gpt-5.4',
  provider: 'openai',
})

test('normalizeOpenAiInputImages uploads inline data URLs once and rewrites them to image_file content', async () => {
  const imageUrl = `data:image/png;base64,${Buffer.from('png test image').toString('base64')}`
  const request = createRequest(imageUrl)
  const uploadCalls: Array<{ purpose: string }> = []
  const client = {
    files: {
      create: async (input: { purpose: string }) => {
        uploadCalls.push({ purpose: input.purpose })

        return { id: 'file_vision_uploaded' }
      },
    },
  } as unknown as import('openai').default
  const uploadCache = new Map<string, Promise<string>>()

  const first = await normalizeOpenAiInputImages(client, request, {
    defaultTimeoutMs: 30_000,
    uploadCache,
  })
  const second = await normalizeOpenAiInputImages(client, createRequest(imageUrl), {
    defaultTimeoutMs: 30_000,
    uploadCache,
  })

  assert.equal(uploadCalls.length, 1)
  assert.deepEqual(first.messages[0]?.content[1], {
    detail: 'high',
    fileId: 'file_vision_uploaded',
    mimeType: 'image/png',
    type: 'image_file',
  })
  assert.deepEqual(second.messages[0]?.content[1], {
    detail: 'high',
    fileId: 'file_vision_uploaded',
    mimeType: 'image/png',
    type: 'image_file',
  })
  assert.deepEqual(request.messages[0]?.content[1], {
    detail: 'high',
    mimeType: 'image/png',
    type: 'image_url',
    url: imageUrl,
  })
})
