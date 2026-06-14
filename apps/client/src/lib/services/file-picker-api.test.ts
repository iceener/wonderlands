import { asSessionId, type BackendFilePickerResult } from '@wonderlands/contracts/chat'
import { afterEach, describe, expect, test } from 'vitest'
import { searchFilePicker } from './file-picker-api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('file picker api service', () => {
  test('queries the backend file-picker route with the active session id', async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = []
    const responseBody: BackendFilePickerResult[] = [
      {
        accessScope: null,
        depth: 1,
        extension: 'ts',
        fileId: null,
        label: 'index.ts',
        matchIndices: [0, 1, 2],
        mentionText: 'src/index.ts',
        mimeType: null,
        relativePath: 'src/index.ts',
        sizeBytes: null,
        source: 'workspace',
      },
    ]

    globalThis.fetch = (async (url, init) => {
      requests.push({ init, url: String(url) })

      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_picker', traceId: 'trace_picker' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(
      searchFilePicker('src ind', {
        limit: 30,
        sessionId: asSessionId('ses_picker'),
      }),
    ).resolves.toEqual(responseBody)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(
      '/api/file-picker/search?query=src+ind&limit=30&sessionId=ses_picker',
    )
    expect(requests[0]?.init?.credentials).toBe('include')
  })

  test('rejects invalid payloads from the backend file-picker route', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [{ nope: true }],
          meta: { requestId: 'req_invalid', traceId: 'trace_invalid' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )) as typeof fetch

    await expect(searchFilePicker('src')).rejects.toThrow(
      'File picker search returned an invalid payload.',
    )
  })
})
