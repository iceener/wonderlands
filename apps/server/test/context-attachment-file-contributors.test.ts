import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import { buildContextArtifacts } from '../src/application/context/artifacts'
import type {
  ContextArtifact,
  ContextArtifactMetadata,
  ContextContributor,
  ContextContributorInput,
} from '../src/application/context/contracts'
import { attachmentContextContributor } from '../src/application/context/contributors/attachment-context'
import { attachmentRulesContributor } from '../src/application/context/contributors/attachment-rules'
import { fileContextContributor } from '../src/application/context/contributors/file-context'
import type { AttachmentRefDescriptor } from '../src/application/files/attachment-ref-context'
import type { VisibleFileContextEntry } from '../src/application/files/file-context'
import type { ThreadContextData } from '../src/application/interactions/context-bundle'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import { asFileId, asSessionMessageId } from '../src/shared/ids'
import {
  createContext,
  createTool,
  createVisibleMessage,
} from './fixtures/context/context-assembly'

const attachmentFixture: AttachmentRefDescriptor = {
  fileId: asFileId('fil_attachment_context'),
  indexInMessageAll: 1,
  indexInMessageByKind: 1,
  internalPath: '/vault/attachments/2026/04/01/do/fil_attachment_context.md',
  kind: 'file',
  messageCreatedAt: '2026-04-01T12:00:00.000Z',
  messageId: asSessionMessageId('msg_attachment_context'),
  messageSequence: 3,
  mimeType: 'text/markdown',
  name: 'context.md',
  ref: '{{attachment:msg_msg_attachment_context:kind:file:index:1}}',
  renderUrl: '/api/files/fil_attachment_context/content',
  sourceMessageState: 'sealed',
}

const visibleFilesFixture: VisibleFileContextEntry[] = [
  {
    dataUrl: null,
    fileId: asFileId('fil_context_notes'),
    messageId: null,
    mimeType: 'text/plain',
    originalFilename: 'notes.txt',
    textContent: 'Attached file: notes.txt\nMIME: text/plain\n\nKeep this exact.',
  },
  {
    dataUrl: 'data:image/png;base64,AQID',
    fileId: asFileId('fil_inline_image'),
    messageId: asSessionMessageId('msg_file_context'),
    mimeType: 'image/png',
    originalFilename: 'inline.png',
    textContent: null,
  },
  {
    dataUrl: 'data:image/png;base64,BAUG',
    fileId: asFileId('fil_exposed_image'),
    messageId: asSessionMessageId('msg_file_context'),
    mimeType: 'image/png',
    originalFilename: 'exposed.png',
    textContent: null,
  },
]

const createInput = (
  options: {
    activeTools?: ToolSpec[]
    context?: ThreadContextData
    overrides?: ContextContributorInput['overrides']
  } = {},
): ContextContributorInput => ({
  activeTools: options.activeTools ?? [],
  context: options.context ?? createContext(),
  mcpCatalog: null,
  mcpMode: 'direct',
  nativeTools: [],
  overrides: options.overrides ?? {},
})

const toArtifactMetadata = (artifact: ContextArtifact): ContextArtifactMetadata => ({
  authority: artifact.authority,
  capturedAt: artifact.capturedAt,
  conflictKey: artifact.conflictKey,
  dedupeKey: artifact.dedupeKey,
  dependencies: artifact.dependencies,
  expiresAt: artifact.expiresAt,
  priority: artifact.priority,
  provenance: artifact.provenance,
  requirement: artifact.requirement,
  sensitivity: artifact.sensitivity,
  supersedes: artifact.supersedes,
  transformation: artifact.transformation,
  visibility: artifact.visibility,
})

const buildStrictArtifact = (
  contributor: ContextContributor,
  input: ContextContributorInput,
): ContextArtifact => {
  const [artifact] = buildContextArtifacts([contributor], input, { validationMode: 'strict' })

  assert.ok(artifact)

  return artifact
}

const createAttachmentInput = (activeTools: ToolSpec[]): ContextContributorInput =>
  createInput({
    activeTools,
    context: createContext({ attachmentRefs: [attachmentFixture] }),
  })

const createFileInput = (
  provider: unknown,
  activeTools: ToolSpec[] = [],
  overrides: ContextContributorInput['overrides'] = {},
): ContextContributorInput => {
  const base = createContext()

  return createInput({
    activeTools,
    context: createContext({
      run: {
        ...base.run,
        configSnapshot: { provider },
      },
      visibleFiles: visibleFilesFixture,
      visibleMessages: [
        createVisibleMessage({
          id: 'msg_file_context',
          sequence: 1,
          text: 'Inline ![upload](/v1/files/fil_inline_image/content) only once.',
        }),
      ],
    }),
    overrides,
  })
}

describe('attachment context contributors', () => {
  test('represents unavailable, workspace, and sandbox attachment access', () => {
    const scenarios = [
      {
        expected: 'Direct sandbox or workspace-files access is not available for this run.',
        forbidden: '/vault/attachments/',
        tools: [],
      },
      {
        expected: 'path: /vault/attachments/2026/04/01/do/fil_attachment_context.md',
        forbidden: 'execute.attachments[].fileId',
        tools: [createTool('files__fs_read', 'mcp')],
      },
      {
        expected: 'sandbox: use this ref in execute.attachments[].fileId',
        forbidden: 'path: /vault/attachments/',
        tools: [createTool('execute'), createTool('files__fs_read', 'mcp')],
      },
    ]

    for (const { expected, forbidden, tools } of scenarios) {
      const input = createAttachmentInput(tools)
      const contributions = [
        ...attachmentRulesContributor.build(input),
        ...attachmentContextContributor.build(input),
      ]
      const text = contributions
        .flatMap((entry) => entry.messages)
        .flatMap((message) =>
          message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
        )
        .join('\n')

      assert.equal(text.includes(expected), true)
      assert.equal(text.includes(forbidden), false)
    }
  })

  test('uses sorted durable attachment identities without leaking paths into provenance', () => {
    const earlierAttachment: AttachmentRefDescriptor = {
      ...attachmentFixture,
      fileId: asFileId('fil_attachment_earlier'),
      internalPath: '/vault/attachments/oauth=credential-must-not-leak/earlier.txt',
      messageCreatedAt: '2026-03-31T11:00:00.000Z',
      messageId: asSessionMessageId('msg_attachment_earlier'),
      messageSequence: 2,
      name: 'credential-must-not-leak.txt',
      ref: '{{attachment:msg_msg_attachment_earlier:kind:file:index:1}}',
      renderUrl: '/api/files/fil_attachment_earlier/content?token=credential-must-not-leak',
    }
    const input = createInput({
      context: createContext({ attachmentRefs: [attachmentFixture, earlierAttachment] }),
    })
    const reversedInput = createInput({
      context: createContext({ attachmentRefs: [earlierAttachment, attachmentFixture] }),
    })
    const rulesArtifact = buildStrictArtifact(attachmentRulesContributor, input)
    const contextArtifact = buildStrictArtifact(attachmentContextContributor, input)
    const reversedRulesArtifact = buildStrictArtifact(attachmentRulesContributor, reversedInput)
    const reversedContextArtifact = buildStrictArtifact(attachmentContextContributor, reversedInput)
    const expectedSourceIds = [
      'fil_attachment_context',
      'fil_attachment_earlier',
      'msg_attachment_context',
      'msg_attachment_earlier',
    ]

    assert.deepEqual(rulesArtifact.provenance.sourceIds, expectedSourceIds)
    assert.deepEqual(contextArtifact.provenance.sourceIds, expectedSourceIds)
    assert.equal(rulesArtifact.capturedAt, attachmentFixture.messageCreatedAt)
    assert.equal(contextArtifact.capturedAt, attachmentFixture.messageCreatedAt)
    assert.equal(contextArtifact.requirement, 'preferred')
    assert.equal(rulesArtifact.id, reversedRulesArtifact.id)
    assert.equal(contextArtifact.id, reversedContextArtifact.id)
    assert.match(rulesArtifact.id, /^ctxa_[a-f0-9]{64}$/)

    const metadataJson = JSON.stringify([
      toArtifactMetadata(rulesArtifact),
      toArtifactMetadata(contextArtifact),
    ])
    assert.equal(metadataJson.includes('/vault/'), false)
    assert.equal(metadataJson.includes('token='), false)
    assert.equal(metadataJson.includes('credential-must-not-leak'), false)
    assert.equal(metadataJson.includes('{{attachment:'), false)
  })
})

describe('file context contributor', () => {
  test('represents inline file content with unavailable, workspace, and sandbox access', () => {
    const scenarios = [
      { expectedMessages: 2, tools: [] },
      { expectedMessages: 1, tools: [createTool('files__fs_read', 'mcp')] },
      { expectedMessages: 1, tools: [createTool('execute')] },
    ]

    for (const { expectedMessages, tools } of scenarios) {
      const [contribution] = fileContextContributor.build(createFileInput('openai', tools))

      assert.equal(contribution?.messages.length, expectedMessages)
      assert.equal(
        contribution?.messages.some((message) =>
          message.content.some(
            (part) => part.type === 'image_url' && part.url === 'data:image/png;base64,BAUG',
          ),
        ),
        true,
      )
    }
  })

  test('collects inline uploaded ids and resolves an override before exposing images', () => {
    const input = createFileInput('google', [], { provider: 'openrouter' })
    const [contribution] = fileContextContributor.build(input)

    assert.deepEqual(contribution?.messages, [
      {
        content: [
          {
            text: 'Attached file: notes.txt\nMIME: text/plain\n\nKeep this exact.',
            type: 'text',
          },
        ],
        role: 'developer',
      },
      {
        content: [
          { text: 'Attached image: exposed.png', type: 'text' },
          {
            mimeType: 'image/png',
            type: 'image_url',
            url: 'data:image/png;base64,BAUG',
          },
        ],
        role: 'user',
      },
    ])
  })

  test('declares restricted file metadata using only sorted durable identities', () => {
    const input = createFileInput('openai')
    const artifact = buildStrictArtifact(fileContextContributor, input)

    assert.deepEqual(toArtifactMetadata(artifact), {
      authority: 'user_input',
      capturedAt: input.context.run.createdAt,
      conflictKey: null,
      dedupeKey: 'file-context',
      dependencies: [],
      expiresAt: null,
      priority: 80,
      provenance: {
        createdByRunId: String(input.context.run.id),
        sourceIds: [
          'fil_context_notes',
          'fil_exposed_image',
          'fil_inline_image',
          'msg_file_context',
        ],
        sourceType: 'file',
        sourceVersion: null,
      },
      requirement: 'preferred',
      sensitivity: 'restricted',
      supersedes: [],
      transformation: { kind: 'none' },
      visibility: 'model',
    })
    assert.equal(artifact.metadataStatus, 'declared')
    assert.match(artifact.id, /^ctxa_[a-f0-9]{64}$/)

    const metadataJson = JSON.stringify(toArtifactMetadata(artifact))
    assert.equal(metadataJson.includes('Keep this exact.'), false)
    assert.equal(metadataJson.includes('data:image/'), false)
    assert.equal(metadataJson.includes('notes.txt'), false)
  })

  test('keeps unreferenced run files optional and does not infer truncation byte counts', () => {
    const truncatedBodySentinel = 'complete-private-file-body [truncated]'
    const input = createInput({
      context: createContext({
        visibleFiles: [
          {
            dataUrl: null,
            fileId: asFileId('fil_unreferenced_truncated'),
            messageId: null,
            mimeType: 'text/plain',
            originalFilename: 'private.txt',
            textContent: truncatedBodySentinel,
          },
        ],
      }),
    })
    const artifact = buildStrictArtifact(fileContextContributor, input)
    const metadataJson = JSON.stringify(toArtifactMetadata(artifact))

    assert.equal(artifact.authority, 'conversation')
    assert.equal(artifact.requirement, 'optional')
    assert.deepEqual(artifact.transformation, { kind: 'none' })
    assert.deepEqual(artifact.provenance.sourceIds, ['fil_unreferenced_truncated'])
    assert.equal(metadataJson.includes(truncatedBodySentinel), false)
    assert.equal(metadataJson.includes('private.txt'), false)
  })
})
