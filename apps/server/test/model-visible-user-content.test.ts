import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { VisibleFileContextEntry } from '../src/application/files/file-context'
import { toFileContextMessages } from '../src/application/files/file-context'
import { toVisibleMessages } from '../src/application/interactions/build-run-interaction-request'
import type { SessionMessageRecord } from '../src/domain/sessions/session-message-repository'
import {
  asFileId,
  asSessionMessageId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
} from '../src/shared/ids'

const createMessage = (id: string, text: string): SessionMessageRecord => ({
  authorAccountId: null,
  authorKind: 'user',
  content: [{ text, type: 'text' }],
  createdAt: '2026-03-30T12:00:00.000Z',
  id: asSessionMessageId(id),
  metadata: null,
  runId: null,
  sequence: 1,
  sessionId: asWorkSessionId('ses_1'),
  tenantId: asTenantId('ten_1'),
  threadId: asSessionThreadId('thr_1'),
})

const createImageEntry = (
  messageId: string,
  fileId: string,
  dataUrl = 'data:image/png;base64,abc123',
): VisibleFileContextEntry => ({
  dataUrl,
  fileId: asFileId(fileId),
  messageId: asSessionMessageId(messageId),
  mimeType: 'image/png',
  originalFilename: `${fileId}.png`,
  textContent: null,
})

test('visible user messages promote remote markdown images into multimodal content', () => {
  const messages = toVisibleMessages([
    createMessage(
      'msg_remote',
      'Describe this. ![Diagram](https://example.com/diagram.png#fragment) Thanks.',
    ),
  ])

  assert.deepEqual(messages, [
    {
      content: [
        { text: 'Describe this. ', type: 'text' },
        { type: 'image_url', url: 'https://example.com/diagram.png' },
        { text: ' Thanks.', type: 'text' },
      ],
      role: 'user',
    },
  ])
})

test('visible user messages reuse linked image bytes for inline uploaded markdown images', () => {
  const messages = toVisibleMessages(
    [createMessage('msg_inline', 'Look here ![Inline](/v1/files/fil_inline/content)')],
    [createImageEntry('msg_inline', 'fil_inline')],
  )

  assert.deepEqual(messages, [
    {
      content: [
        { text: 'Look here ', type: 'text' },
        {
          mimeType: 'image/png',
          type: 'image_url',
          url: 'data:image/png;base64,abc123',
        },
      ],
      role: 'user',
    },
  ])
})

test('visible user messages keep unsupported inline image markdown as text instead of dropping it', () => {
  const messages = toVisibleMessages([
    createMessage('msg_missing', 'Keep ![Inline](/v1/files/fil_missing/content) raw'),
  ])

  assert.deepEqual(messages, [
    {
      content: [
        {
          text: 'Keep ![Inline](/v1/files/fil_missing/content) raw',
          type: 'text',
        },
      ],
      role: 'user',
    },
  ])
})

test('file context skips image attachments already rendered inline in markdown', () => {
  const messages = toFileContextMessages(
    [
      createImageEntry('msg_inline', 'fil_inline'),
      {
        dataUrl: null,
        fileId: asFileId('fil_notes'),
        messageId: asSessionMessageId('msg_inline'),
        mimeType: 'text/plain',
        originalFilename: 'notes.txt',
        textContent: 'Attached file: notes.txt\nMIME: text/plain',
      },
    ],
    'openai',
    new Set([asFileId('fil_inline')]),
  )

  assert.deepEqual(messages, [
    {
      content: [{ text: 'Attached file: notes.txt\nMIME: text/plain', type: 'text' }],
      role: 'developer',
    },
  ])
})

test('file context omits non-image attachment text when sandbox or workspace file access exists', () => {
  const entry: VisibleFileContextEntry = {
    dataUrl: null,
    fileId: asFileId('fil_notes'),
    messageId: asSessionMessageId('msg_inline'),
    mimeType: 'text/plain',
    originalFilename: 'notes.txt',
    textContent: 'Attached file: notes.txt\nMIME: text/plain',
  }

  assert.deepEqual(toFileContextMessages([entry], 'openai', new Set(), 'sandbox'), [])
  assert.deepEqual(toFileContextMessages([entry], 'openai', new Set(), 'workspace_files'), [])
})
