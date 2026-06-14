import type { MessageAttachment } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import type { AttachmentDraft } from '../stores/attachment-drafts.svelte'
import {
  collectLightboxableImages,
  imageAttachmentsToPreviewItems,
  imageDraftsToPreviewItems,
  isLightboxableImageSrc,
} from './preview-adapters'

describe('preview adapters', () => {
  test('maps image drafts to items using remote URL when present', () => {
    const drafts: AttachmentDraft[] = [
      {
        localId: 'a',
        file: new File([], 'a.png'),
        name: 'a.png',
        size: 1,
        mime: 'image/png',
        kind: 'image',
        objectUrl: 'blob:http://x/a',
        previewUrl: null,
        state: 'uploaded',
        remoteId: 'f1',
        remoteThumbnailUrl: null,
        remoteUrl: '/v1/files/f1/content',
        error: null,
      },
    ]

    expect(imageDraftsToPreviewItems(drafts)).toEqual([
      {
        kind: 'image',
        sourceUrl: '/v1/files/f1/content',
        alt: 'a.png',
        caption: 'a.png',
      },
    ])
  })

  test('falls back to preview and object URLs for pending drafts', () => {
    const drafts: AttachmentDraft[] = [
      {
        localId: 'b',
        file: new File([], 'b.jpg'),
        name: 'b.jpg',
        size: 2,
        mime: 'image/jpeg',
        kind: 'image',
        objectUrl: 'blob:http://x/b',
        previewUrl: 'blob:http://x/preview',
        state: 'ready',
        remoteId: null,
        remoteThumbnailUrl: null,
        remoteUrl: null,
        error: null,
      },
    ]

    expect(imageDraftsToPreviewItems(drafts)).toEqual([
      {
        kind: 'image',
        sourceUrl: 'blob:http://x/preview',
        alt: 'b.jpg',
        caption: 'b.jpg',
      },
    ])
  })

  test('maps only image attachments from messages', () => {
    const attachments: MessageAttachment[] = [
      {
        id: '1',
        name: 'pic.png',
        size: 3,
        mime: 'image/png',
        kind: 'image',
        url: '/v1/files/x/content',
        thumbnailUrl: '/v1/files/x/thumb',
      },
      {
        id: '2',
        name: 'doc.pdf',
        size: 4,
        mime: 'application/pdf',
        kind: 'file',
        url: '/v1/files/y/content',
      },
    ]

    expect(imageAttachmentsToPreviewItems(attachments)).toEqual([
      {
        kind: 'image',
        sourceUrl: '/v1/files/x/content',
        alt: 'pic.png',
        caption: 'pic.png',
      },
    ])
  })

  test('isLightboxableImageSrc filters transient URLs', () => {
    expect(isLightboxableImageSrc('')).toBe(false)
    expect(isLightboxableImageSrc('blob:http://localhost/x')).toBe(false)
    expect(isLightboxableImageSrc('data:image/png;base64,xx')).toBe(false)
    expect(isLightboxableImageSrc('/v1/files/a/content')).toBe(true)
    expect(isLightboxableImageSrc('https://example.com/x.png')).toBe(true)
  })

  test('collectLightboxableImages returns empty without a root', () => {
    expect(collectLightboxableImages(null)).toEqual({ items: [], elements: [] })
  })
})
