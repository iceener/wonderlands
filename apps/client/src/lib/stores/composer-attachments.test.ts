import { describe, expect, test } from 'vitest'
import { createComposerAttachmentStore } from './composer-attachments.svelte.js'

const createFile = (name: string, type: string, size = 1024): File =>
  new File([new Uint8Array(size)], name, { type })

describe('createComposerAttachmentStore', () => {
  test('prepares durable attachments and clears the visible tray without revoking submitted object urls', async () => {
    const revokedUrls: string[] = []
    let nextId = 1
    const store = createComposerAttachmentStore({
      createObjectUrl: () => `blob:http://localhost/object-${nextId++}`,
      randomUUID: () => `draft-${nextId++}`,
      revokeObjectUrl: (url) => {
        revokedUrls.push(url)
      },
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

    const result = store.prepareForSubmit()

    expect(result).toEqual({
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

    expect(revokedUrls).toEqual(['blob:http://localhost/object-1'])
  })

  test('reset clears both active and retained draft stores and starts with a fresh composer state', async () => {
    const revokedUrls: string[] = []
    let nextObjectUrl = 1
    let nextDraftId = 1
    const store = createComposerAttachmentStore({
      createObjectUrl: () => `blob:http://localhost/object-${nextObjectUrl++}`,
      randomUUID: () => `draft-${nextDraftId++}`,
      revokeObjectUrl: (url) => {
        revokedUrls.push(url)
      },
      uploadAttachment: async (file) => ({
        id: `fil-${file.name}`,
        kind: file.type.startsWith('image/') ? 'image' : 'file',
        mime: file.type || 'application/octet-stream',
        name: file.name,
        size: file.size,
        ...(file.type.startsWith('image/')
          ? {
              thumbnailUrl: `/v1/files/fil-${file.name}/content`,
            }
          : {}),
        url: `/v1/files/fil-${file.name}/content`,
      }),
    })

    store.addFiles([createFile('first.png', 'image/png')])
    await Promise.resolve()
    const firstAttachments = store.prepareForSubmit()
    expect(firstAttachments).toEqual({
      ok: true,
      attachments: [
        expect.objectContaining({
          id: 'fil-first.png',
        }),
      ],
    })

    store.addFiles([createFile('second.txt', 'text/plain')])
    await Promise.resolve()
    expect(store.drafts).toHaveLength(1)

    store.reset()

    expect(store.drafts).toEqual([])
    expect(revokedUrls.sort()).toEqual([
      'blob:http://localhost/object-1',
      'blob:http://localhost/object-2',
    ])
  })

  test('does not rotate the active store when there are no sendable attachments', async () => {
    let nextObjectUrl = 1
    const store = createComposerAttachmentStore({
      createObjectUrl: () => `blob:http://localhost/object-${nextObjectUrl++}`,
      randomUUID: () => 'draft-1',
    })

    expect(store.prepareForSubmit()).toEqual({
      ok: true,
      attachments: [],
    })

    store.addFiles([createFile('note.md', 'text/markdown')])

    expect(store.drafts).toHaveLength(1)
  })

  test('blocks submit while an upload is still pending', async () => {
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
    expect(store.error).toBe('Wait for preview.png to finish uploading before sending.')

    releaseUpload()
    await Promise.resolve()
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
  })

  test('keeps pre-uploaded picker attachments in the tray and returns them on submit', async () => {
    const revokedUrls: string[] = []
    let nextDraftId = 1
    const store = createComposerAttachmentStore({
      randomUUID: () => `draft-${nextDraftId++}`,
      revokeObjectUrl: (url) => {
        revokedUrls.push(url)
      },
    })

    store.addUploadedAttachments([
      {
        id: 'fil-picker-image',
        kind: 'image',
        mime: 'image/png',
        name: 'picker-image.png',
        size: 4096,
        thumbnailUrl: '/v1/files/fil-picker-image/content',
        url: '/v1/files/fil-picker-image/content',
      },
    ])

    expect(store.drafts).toHaveLength(1)
    expect(store.prepareForSubmit()).toEqual({
      ok: true,
      attachments: [
        {
          id: 'fil-picker-image',
          kind: 'image',
          mime: 'image/png',
          name: 'picker-image.png',
          size: 4096,
          thumbnailUrl: '/v1/files/fil-picker-image/content',
          url: '/v1/files/fil-picker-image/content',
        },
      ],
    })
    expect(store.drafts).toEqual([])

    store.dispose()

    expect(revokedUrls).toEqual([])
  })
})
