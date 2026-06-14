import { describe, expect, test } from 'vitest'
import { createAttachmentDraftStore } from './attachment-drafts.svelte.js'

const createFile = (name: string, type: string, contents = 'demo'): File =>
  new File([new TextEncoder().encode(contents)], name, { type })

describe('createAttachmentDraftStore', () => {
  test('uploads image and file drafts and exposes durable attachments once uploads finish', async () => {
    let seq = 0
    const store = createAttachmentDraftStore({
      createObjectUrl(file) {
        return `blob:${file.name}`
      },
      randomUUID: () => `draft-${++seq}`,
      revokeObjectUrl: () => undefined,
      uploadAttachment: async (file) => ({
        id: `fil:${file.name}`,
        kind: file.type.startsWith('image/') ? 'image' : 'file',
        mime: file.type,
        name: file.name,
        size: file.size,
        ...(file.type.startsWith('image/')
          ? {
              thumbnailUrl: `/v1/files/fil:${file.name}/content`,
            }
          : {}),
        url: `/v1/files/fil:${file.name}/content`,
      }),
    })

    store.addFiles([createFile('preview.png', 'image/png'), createFile('notes.txt', 'text/plain')])
    await store.uploadPendingFiles()

    expect(store.drafts).toHaveLength(2)
    expect(store.drafts[0]).toMatchObject({
      localId: 'draft-1',
      name: 'preview.png',
      mime: 'image/png',
      kind: 'image',
      objectUrl: 'blob:preview.png',
      previewUrl: 'blob:preview.png',
      remoteId: 'fil:preview.png',
      remoteUrl: '/v1/files/fil:preview.png/content',
      remoteThumbnailUrl: '/v1/files/fil:preview.png/content',
      state: 'uploaded',
    })
    expect(store.drafts[1]).toMatchObject({
      localId: 'draft-2',
      name: 'notes.txt',
      mime: expect.stringContaining('text/plain'),
      kind: 'file',
      objectUrl: 'blob:notes.txt',
      previewUrl: null,
      remoteId: 'fil:notes.txt',
      remoteUrl: '/v1/files/fil:notes.txt/content',
      state: 'uploaded',
    })
    const attachments = store.toDraftAttachments()
    expect(attachments).toHaveLength(2)
    expect(attachments[0]).toEqual({
      id: 'fil:preview.png',
      kind: 'image',
      mime: 'image/png',
      name: 'preview.png',
      size: store.drafts[0]?.size,
      thumbnailUrl: '/v1/files/fil:preview.png/content',
      url: '/v1/files/fil:preview.png/content',
    })
    expect(attachments[1]).toMatchObject({
      id: 'fil:notes.txt',
      kind: 'file',
      name: 'notes.txt',
      size: store.drafts[1]?.size,
      url: '/v1/files/fil:notes.txt/content',
    })
  })

  test('removes drafts and revokes only the removed object url', async () => {
    const revokedUrls: string[] = []
    const store = createAttachmentDraftStore({
      createObjectUrl(file) {
        return `blob:${file.name}`
      },
      randomUUID: (() => {
        let seq = 0
        return () => `draft-${++seq}`
      })(),
      revokeObjectUrl(url) {
        revokedUrls.push(url)
      },
    })

    store.addFiles([createFile('preview.png', 'image/png'), createFile('notes.txt', 'text/plain')])

    expect(store.removeDraft('draft-1')).toBe(true)
    expect(store.removeDraft('missing')).toBe(false)
    expect(store.drafts).toHaveLength(1)
    expect(store.drafts[0]?.localId).toBe('draft-2')
    expect(revokedUrls).toEqual(['blob:preview.png'])
  })

  test('clears all drafts and revokes every object url', async () => {
    const revokedUrls: string[] = []
    const store = createAttachmentDraftStore({
      createObjectUrl(file) {
        return `blob:${file.name}`
      },
      randomUUID: (() => {
        let seq = 0
        return () => `draft-${++seq}`
      })(),
      revokeObjectUrl(url) {
        revokedUrls.push(url)
      },
    })

    store.addFiles([createFile('preview.png', 'image/png'), createFile('notes.txt', 'text/plain')])
    store.clearAll()

    expect(store.drafts).toEqual([])
    expect(revokedUrls).toEqual(['blob:preview.png', 'blob:notes.txt'])
  })

  test('falls back to application/octet-stream for files without a mime type', async () => {
    const store = createAttachmentDraftStore({
      createObjectUrl(file) {
        return `blob:${file.name}`
      },
      randomUUID: () => 'draft-1',
      revokeObjectUrl: () => undefined,
      uploadAttachment: async (file) => ({
        id: 'fil:archive.bin',
        kind: 'file',
        mime: file.type || 'application/octet-stream',
        name: file.name,
        size: file.size,
        url: '/v1/files/fil:archive.bin/content',
      }),
    })

    store.addFiles([createFile('archive.bin', '')])
    await store.uploadPendingFiles()

    expect(store.drafts[0]).toMatchObject({
      mime: 'application/octet-stream',
      kind: 'file',
      remoteId: 'fil:archive.bin',
    })
    expect(store.toDraftAttachments()).toEqual([
      {
        id: 'fil:archive.bin',
        name: 'archive.bin',
        size: store.drafts[0]?.size,
        mime: 'application/octet-stream',
        kind: 'file',
        url: '/v1/files/fil:archive.bin/content',
      },
    ])
  })

  test('blocks submit serialization while uploads are pending', async () => {
    let releaseUpload!: () => void
    const uploadStarted = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    const store = createAttachmentDraftStore({
      createObjectUrl(file) {
        return `blob:${file.name}`
      },
      randomUUID: () => 'draft-1',
      revokeObjectUrl: () => undefined,
      uploadAttachment: async (file) => {
        await uploadStarted
        return {
          id: `fil:${file.name}`,
          kind: 'image',
          mime: file.type,
          name: file.name,
          size: file.size,
          thumbnailUrl: '/v1/files/fil:preview.png/content',
          url: '/v1/files/fil:preview.png/content',
        }
      },
    })

    store.addFiles([createFile('preview.png', 'image/png')])
    const uploadPromise = store.uploadPendingFiles()

    expect(store.validateReadyForSubmit()).toEqual({
      ok: false,
      error: 'Wait for preview.png to finish uploading before sending.',
    })

    releaseUpload()
    await uploadPromise

    expect(store.validateReadyForSubmit()).toEqual({
      ok: true,
    })
  })

  test('adds already-uploaded attachments without creating revokable object urls', async () => {
    const revokedUrls: string[] = []
    const store = createAttachmentDraftStore({
      randomUUID: (() => {
        let seq = 0
        return () => `draft-${++seq}`
      })(),
      revokeObjectUrl(url) {
        revokedUrls.push(url)
      },
    })

    store.addUploadedAttachments([
      {
        id: 'fil:vision.png',
        kind: 'image',
        mime: 'image/png',
        name: 'vision.png',
        size: 2048,
        thumbnailUrl: '/v1/files/fil:vision.png/content',
        url: '/v1/files/fil:vision.png/content',
      },
      {
        id: 'fil:vision.png',
        kind: 'image',
        mime: 'image/png',
        name: 'vision.png',
        size: 2048,
        thumbnailUrl: '/v1/files/fil:vision.png/content',
        url: '/v1/files/fil:vision.png/content',
      },
    ])

    expect(store.drafts).toHaveLength(1)
    expect(store.drafts[0]).toMatchObject({
      localId: 'draft-1',
      objectUrl: '/v1/files/fil:vision.png/content',
      ownsObjectUrl: false,
      previewUrl: '/v1/files/fil:vision.png/content',
      remoteId: 'fil:vision.png',
      remoteThumbnailUrl: '/v1/files/fil:vision.png/content',
      remoteUrl: '/v1/files/fil:vision.png/content',
      state: 'uploaded',
    })
    expect(store.toDraftAttachments()).toEqual([
      {
        id: 'fil:vision.png',
        kind: 'image',
        mime: 'image/png',
        name: 'vision.png',
        size: 2048,
        thumbnailUrl: '/v1/files/fil:vision.png/content',
        url: '/v1/files/fil:vision.png/content',
      },
    ])

    expect(store.removeDraft('draft-1')).toBe(true)
    expect(revokedUrls).toEqual([])
  })
})
