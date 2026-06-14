import assert from 'node:assert/strict'
import { test } from 'vitest'

import { serializeTelemetryMessages } from '../src/application/runtime/run-telemetry'

test('serializeTelemetryMessages redacts inline data URLs before telemetry persistence', () => {
  const dataUrl = `data:image/png;base64,${Buffer.from('hello world').toString('base64')}`
  const serialized = serializeTelemetryMessages([
    {
      content: [
        {
          detail: 'high',
          mimeType: 'image/png',
          type: 'image_url',
          url: dataUrl,
        },
      ],
      role: 'user',
    },
  ])

  assert.deepEqual(serialized, [
    {
      content: [
        {
          detail: 'high',
          mimeType: 'image/png',
          type: 'image_url',
          url: '[data-url redacted; image/png; ~11 bytes]',
        },
      ],
      role: 'user',
    },
  ])
})
