import assert from 'node:assert/strict'
import { test } from 'vitest'

import { estimateMessageTokens } from '../src/application/interactions/context-bundle'

test('estimateMessageTokens treats inline images as bounded image inputs instead of raw base64 text', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(400_000)}`

  assert.equal(
    estimateMessageTokens({
      content: [
        {
          type: 'image_url',
          url: dataUrl,
        },
      ],
      role: 'user',
    }),
    513,
  )
  assert.equal(
    estimateMessageTokens({
      content: [
        {
          detail: 'high',
          fileId: 'file_vision_uploaded',
          type: 'image_file',
        },
      ],
      role: 'user',
    }),
    1025,
  )
})
