import type { MessageAttachment } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { filterInlineRenderedImageAttachments } from './model-visible'

const imageAttachment = (overrides: Partial<MessageAttachment> = {}): MessageAttachment => ({
  id: 'attachment-1',
  name: 'preview.png',
  size: 1024,
  mime: 'image/png',
  kind: 'image',
  url: '/api/uploads/asset-1/preview.png',
  thumbnailUrl: '/api/uploads/asset-1/preview.png',
  ...overrides,
})

describe('filterInlineRenderedImageAttachments', () => {
  test('hides image attachments that already render inline in markdown', () => {
    const attachments = filterInlineRenderedImageAttachments(
      [
        imageAttachment(),
        imageAttachment({
          id: 'attachment-2',
          url: 'https://example.com/remote.png',
          thumbnailUrl: 'https://example.com/remote.png',
          name: 'remote.png',
        }),
        {
          id: 'attachment-3',
          name: 'notes.txt',
          size: 100,
          mime: 'text/plain',
          kind: 'file',
          url: 'blob:http://localhost/notes',
        },
      ],
      '![Inline](/api/uploads/asset-1/preview.png)\n\nText',
    )

    expect(attachments).toEqual([
      imageAttachment({
        id: 'attachment-2',
        url: 'https://example.com/remote.png',
        thumbnailUrl: 'https://example.com/remote.png',
        name: 'remote.png',
      }),
      {
        id: 'attachment-3',
        name: 'notes.txt',
        size: 100,
        mime: 'text/plain',
        kind: 'file',
        url: 'blob:http://localhost/notes',
      },
    ])
  })
})
