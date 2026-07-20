import { describe, expect, test } from 'vitest'
import { createComposerAttachmentStore } from './composer-attachments.svelte.js'

const createFile = (name: string, type: string, size = 1024): File =>
  new File([new Uint8Array(size)], name, { type })

describe('createComposerAttachmentStore', () => {
  test('submits durable attachments, retains their object URLs, and revokes them on disposal', async () => {
    const revokedUrls: string[] = []
    const store = createComposerAttachmentStore({
      createObjectUrl: () => 'blob:http://localhost/preview',
      randomUUID: () => 'draft-1',
      revokeObjectUrl: (url) => revokedUrls.push(url),
      uploadAttachment: async (file) => ({
        id: `fil-${file.name}`,
        kind: 'image',
        mime: file.type,
        name: file.name,
        size: file.size,
        thumbnailUrl: `/v1/files/fil-${file.name}/content`,
        url: `/v1/files/fil-${file.name}/content`,
      }),
    })

    store.addFiles([createFile('preview.png', 'image/png')])
    await Promise.resolve()

    expect(store.prepareForSubmit()).toEqual({
      ok: true,
      attachments: [
        {
          id: 'fil-preview.png',
          kind: 'image',
          mime: 'image/png',
          name: 'preview.png',
          size: 1024,
          thumbnailUrl: '/v1/files/fil-preview.png/content',
          url: '/v1/files/fil-preview.png/content',
        },
      ],
    })
    expect(store.drafts).toEqual([])
    expect(revokedUrls).toEqual([])

    store.dispose()
    expect(revokedUrls).toEqual(['blob:http://localhost/preview'])
  })

  test('blocks submission while uploading and succeeds once the upload settles', async () => {
    let releaseUpload!: () => void
    const pendingUpload = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    const store = createComposerAttachmentStore({
      createObjectUrl: () => 'blob:http://localhost/object-1',
      randomUUID: () => 'draft-1',
      uploadAttachment: async (file) => {
        await pendingUpload
        return {
          id: `fil-${file.name}`,
          kind: 'image',
          mime: file.type,
          name: file.name,
          size: file.size,
          thumbnailUrl: `/v1/files/fil-${file.name}/content`,
          url: `/v1/files/fil-${file.name}/content`,
        }
      },
    })

    store.addFiles([createFile('preview.png', 'image/png')])

    expect(store.prepareForSubmit()).toEqual({
      ok: false,
      error: 'Wait for preview.png to finish uploading before sending.',
    })

    releaseUpload()
    await pendingUpload
    await Promise.resolve()
    expect(store.prepareForSubmit()).toMatchObject({
      ok: true,
      attachments: [{ id: 'fil-preview.png' }],
    })
  })

  test('submits pre-uploaded picker attachments without revoking remote URLs', () => {
    const revokedUrls: string[] = []
    const store = createComposerAttachmentStore({
      randomUUID: () => 'draft-1',
      revokeObjectUrl: (url) => revokedUrls.push(url),
    })
    const attachment = {
      id: 'fil-picker-image',
      kind: 'image' as const,
      mime: 'image/png',
      name: 'picker-image.png',
      size: 4096,
      thumbnailUrl: '/v1/files/fil-picker-image/content',
      url: '/v1/files/fil-picker-image/content',
    }

    store.addUploadedAttachments([attachment])

    expect(store.prepareForSubmit()).toEqual({ ok: true, attachments: [attachment] })
    expect(store.drafts).toEqual([])

    store.dispose()
    expect(revokedUrls).toEqual([])
  })
})
