import type { MessageAttachment } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { createAttachmentDraftStore } from './attachment-drafts.svelte.js'

const createFile = (name: string, type: string, contents = 'demo'): File =>
  new File([new TextEncoder().encode(contents)], name, { type })

const uploadedAttachment = (file: File): MessageAttachment => ({
  id: `fil:${file.name}`,
  kind: file.type.startsWith('image/') ? 'image' : 'file',
  mime: file.type || 'application/octet-stream',
  name: file.name,
  size: file.size,
  ...(file.type.startsWith('image/') ? { thumbnailUrl: `/v1/files/fil:${file.name}/content` } : {}),
  url: `/v1/files/fil:${file.name}/content`,
})

describe('createAttachmentDraftStore', () => {
  test('normalizes image, file, and unknown MIME drafts into durable attachments', async () => {
    let sequence = 0
    const store = createAttachmentDraftStore({
      createObjectUrl: (file) => `blob:${file.name}`,
      randomUUID: () => `draft-${++sequence}`,
      revokeObjectUrl: () => undefined,
      uploadAttachment: async (file) => uploadedAttachment(file),
    })

    store.addFiles([
      createFile('preview.png', 'image/png'),
      createFile('notes.txt', 'text/plain'),
      createFile('archive.bin', ''),
    ])
    await store.uploadPendingFiles()

    expect(
      store.drafts.map(({ kind, mime, previewUrl, state }) => ({
        kind,
        mime,
        previewUrl,
        state,
      })),
    ).toEqual([
      { kind: 'image', mime: 'image/png', previewUrl: 'blob:preview.png', state: 'uploaded' },
      { kind: 'file', mime: 'text/plain', previewUrl: null, state: 'uploaded' },
      { kind: 'file', mime: 'application/octet-stream', previewUrl: null, state: 'uploaded' },
    ])
    expect(store.toDraftAttachments()).toEqual([
      uploadedAttachment(createFile('preview.png', 'image/png')),
      uploadedAttachment(createFile('notes.txt', 'text/plain')),
      uploadedAttachment(createFile('archive.bin', '')),
    ])
  })

  test('removes or clears owned object URLs without revoking unrelated drafts', () => {
    const revokedUrls: string[] = []
    let sequence = 0
    const store = createAttachmentDraftStore({
      createObjectUrl: (file) => `blob:${file.name}`,
      randomUUID: () => `draft-${++sequence}`,
      revokeObjectUrl: (url) => revokedUrls.push(url),
    })

    store.addFiles([createFile('preview.png', 'image/png'), createFile('notes.txt', 'text/plain')])

    expect(store.removeDraft('draft-1')).toBe(true)
    expect(store.removeDraft('missing')).toBe(false)
    expect(revokedUrls).toEqual(['blob:preview.png'])

    store.clearAll()
    expect(store.drafts).toEqual([])
    expect(revokedUrls).toEqual(['blob:preview.png', 'blob:notes.txt'])
  })

  test('blocks submit serialization until pending uploads finish', async () => {
    let releaseUpload!: () => void
    const pendingUpload = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    const store = createAttachmentDraftStore({
      createObjectUrl: (file) => `blob:${file.name}`,
      randomUUID: () => 'draft-1',
      revokeObjectUrl: () => undefined,
      uploadAttachment: async (file) => {
        await pendingUpload
        return uploadedAttachment(file)
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
    expect(store.validateReadyForSubmit()).toEqual({ ok: true })
  })

  test('deduplicates pre-uploaded attachments without owning their remote URLs', () => {
    const revokedUrls: string[] = []
    const attachment = uploadedAttachment(createFile('vision.png', 'image/png'))
    const store = createAttachmentDraftStore({
      randomUUID: () => 'draft-1',
      revokeObjectUrl: (url) => revokedUrls.push(url),
    })

    store.addUploadedAttachments([attachment, attachment])

    expect(store.drafts).toHaveLength(1)
    expect(store.drafts[0]).toMatchObject({
      objectUrl: attachment.url,
      ownsObjectUrl: false,
      remoteId: attachment.id,
      state: 'uploaded',
    })
    expect(store.toDraftAttachments()).toEqual([attachment])

    store.removeDraft('draft-1')
    expect(revokedUrls).toEqual([])
  })
})
