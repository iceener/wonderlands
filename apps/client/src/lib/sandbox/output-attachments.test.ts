import type { Block } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { extractSandboxOutputAttachments } from './output-attachments'

const at = '2026-04-06T12:00:00.000Z'

describe('extractSandboxOutputAttachments', () => {
  test('dedupes duplicate display names with numeric suffixes', () => {
    const blocks: Block[] = [
      {
        args: null,
        createdAt: at,
        id: 'tool:call_1',
        name: 'execute',
        output: {
          files: [
            {
              fileId: 'fil_1',
              mimeType: 'image/png',
              originalFilename: 'image.png',
              sandboxPath: '/output/alpha.png',
              sizeBytes: 1,
            },
            {
              fileId: 'fil_2',
              mimeType: 'image/png',
              originalFilename: 'image.png',
              sandboxPath: '/output/beta.png',
              sizeBytes: 2,
            },
            {
              fileId: 'fil_3',
              mimeType: 'image/png',
              originalFilename: 'image.png',
              sandboxPath: '/output/gamma.png',
              sizeBytes: 3,
            },
          ],
        },
        status: 'complete',
        toolCallId: 'call_1',
        type: 'tool_interaction',
      },
    ]

    expect(extractSandboxOutputAttachments(blocks).map((attachment) => attachment.name)).toEqual([
      'image.png',
      'image (2).png',
      'image (3).png',
    ])
  })
})
