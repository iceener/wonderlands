import { asSessionId } from '@wonderlands/contracts/chat'
import { afterEach, describe, expect, test } from 'vitest'
import { uploadAttachment } from './attachment-api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('uploadAttachment', () => {
  test('posts multipart form data to the backend upload endpoint and returns a durable image attachment', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })

      return new Response(
        JSON.stringify({
          data: {
            accessScope: 'session_local',
            contentUrl: '/api/files/fil_preview/content',
            createdAt: '2026-03-29T12:00:00.000Z',
            id: 'fil_preview',
            mimeType: 'image/png',
            originalFilename: 'preview.png',
            sizeBytes: 1024,
            status: 'ready',
            title: null,
            uploadId: 'upl_preview',
          },
          meta: { requestId: 'req_upload', traceId: 'trace_upload' },
          ok: true,
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      )
    }) as typeof fetch

    const attachment = await uploadAttachment(
      new File([new Uint8Array(1024)], 'preview.png', { type: 'image/png' }),
      {
        accessScope: 'session_local',
        sessionId: asSessionId('ses_1'),
      },
    )

    expect(attachment).toEqual({
      id: 'fil_preview',
      kind: 'image',
      mime: 'image/png',
      name: 'preview.png',
      size: 1024,
      thumbnailUrl: '/api/files/fil_preview/content',
      url: '/api/files/fil_preview/content',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('/api/uploads')
    expect(requests[0]?.init?.credentials).toBe('include')
    expect(requests[0]?.init?.method).toBe('POST')
    expect(new Headers(requests[0]?.init?.headers).get('x-tenant-id')).toBe('ten_overment')

    const formData = requests[0]?.init?.body
    expect(formData).toBeInstanceOf(FormData)
    expect((formData as FormData).get('accessScope')).toBe('session_local')
    expect((formData as FormData).get('sessionId')).toBe('ses_1')
    expect((formData as FormData).get('file')).toBeInstanceOf(File)
  })

  test('maps non-image uploads into file attachments', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            accessScope: 'account_library',
            contentUrl: '/api/files/fil_notes/content',
            createdAt: '2026-03-29T12:00:00.000Z',
            id: 'fil_notes',
            mimeType: 'text/plain',
            originalFilename: 'notes.txt',
            sizeBytes: 12,
            status: 'ready',
            title: null,
            uploadId: 'upl_notes',
          },
          meta: { requestId: 'req_upload_2', traceId: 'trace_upload_2' },
          ok: true,
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch

    await expect(
      uploadAttachment(new File(['hello world'], 'notes.txt', { type: 'text/plain' }), {
        accessScope: 'account_library',
      }),
    ).resolves.toEqual({
      id: 'fil_notes',
      kind: 'file',
      mime: 'text/plain',
      name: 'notes.txt',
      size: 12,
      url: '/api/files/fil_notes/content',
    })
  })

  test('surfaces structured upload failures', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Only image uploads are supported.',
            type: 'validation',
          },
          meta: { requestId: 'req_error', traceId: 'trace_error' },
          ok: false,
        }),
        {
          status: 415,
          headers: { 'content-type': 'application/json' },
        },
      )) as typeof fetch

    await expect(
      uploadAttachment(new File([new Uint8Array(1)], 'notes.txt', { type: 'text/plain' }), {
        accessScope: 'account_library',
      }),
    ).rejects.toThrow('Only image uploads are supported.')
  })
})
