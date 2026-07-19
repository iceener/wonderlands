import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildContextArtifacts,
  projectContextArtifactMessages,
} from '../src/application/context/artifacts'
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
import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import type {
  ContextLayerKind,
  ThreadContextData,
} from '../src/application/interactions/context-bundle'
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

const legacyContribution = (input: ContextContributorInput, kind: ContextLayerKind) => {
  const result = assembleThreadInteractionRequest({
    activeTools: input.activeTools as ToolSpec[],
    context: input.context as ThreadContextData,
    mcpCatalog: null,
    mcpMode: input.mcpMode,
    nativeTools: [...input.nativeTools],
    overrides: input.overrides,
  })
  const layer = result.bundle.layers.find((candidate) => candidate.kind === kind)

  assert.ok(layer)

  return [
    {
      kind: layer.kind,
      messages: layer.messages,
      volatility: layer.volatility,
    },
  ]
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
  test('retain layer identities, positions, volatility, and empty outputs', () => {
    const input = createInput()

    assert.deepEqual(
      [
        [attachmentRulesContributor.id, attachmentRulesContributor.order],
        [attachmentContextContributor.id, attachmentContextContributor.order],
      ],
      [
        ['attachment-rules', 5],
        ['attachment-context', 13],
      ],
    )
    assert.deepEqual(attachmentRulesContributor.build(input), [
      { kind: 'attachment_ref_rules', messages: [], volatility: 'stable' },
    ])
    assert.deepEqual(attachmentContextContributor.build(input), [
      { kind: 'attachment_ref_context', messages: [], volatility: 'volatile' },
    ])
  })

  test.each([
    { activeTools: [], name: 'no file-access capability' },
    { activeTools: [createTool('files__fs_read', 'mcp')], name: 'workspace file access' },
    {
      activeTools: [createTool('files.fs_read', 'mcp'), createTool('generate_image')],
      name: 'dotted workspace file access with image generation',
    },
    {
      activeTools: [createTool('execute'), createTool('files__fs_read', 'mcp')],
      name: 'sandbox access taking precedence over workspace access',
    },
    {
      activeTools: [createTool('execute'), createTool('generate_image')],
      name: 'sandbox execution with image generation',
    },
  ])('matches current exact rule and descriptor messages for $name', ({ activeTools }) => {
    const input = createAttachmentInput(activeTools)

    assert.deepEqual(
      attachmentRulesContributor.build(input),
      legacyContribution(input, 'attachment_ref_rules'),
    )
    assert.deepEqual(
      attachmentContextContributor.build(input),
      legacyContribution(input, 'attachment_ref_context'),
    )
  })

  test('declares complete strict metadata for empty attachment layers', () => {
    const input = createInput()
    const rulesArtifact = buildStrictArtifact(attachmentRulesContributor, input)
    const contextArtifact = buildStrictArtifact(attachmentContextContributor, input)

    assert.deepEqual(toArtifactMetadata(rulesArtifact), {
      authority: 'user_input',
      capturedAt: input.context.run.createdAt,
      conflictKey: null,
      dedupeKey: 'attachment-ref-rules',
      dependencies: [],
      expiresAt: null,
      priority: 100,
      provenance: {
        createdByRunId: String(input.context.run.id),
        sourceIds: [],
        sourceType: 'user_message',
        sourceVersion: null,
      },
      requirement: 'mandatory',
      sensitivity: 'private',
      supersedes: [],
      transformation: { kind: 'none' },
      visibility: 'model',
    })
    assert.deepEqual(toArtifactMetadata(contextArtifact), {
      authority: 'conversation',
      capturedAt: input.context.run.createdAt,
      conflictKey: null,
      dedupeKey: 'attachment-ref-context',
      dependencies: [],
      expiresAt: null,
      priority: 90,
      provenance: {
        createdByRunId: String(input.context.run.id),
        sourceIds: [],
        sourceType: 'user_message',
        sourceVersion: null,
      },
      requirement: 'optional',
      sensitivity: 'restricted',
      supersedes: [],
      transformation: { kind: 'none' },
      visibility: 'model',
    })
    assert.equal(rulesArtifact.metadataStatus, 'declared')
    assert.equal(contextArtifact.metadataStatus, 'declared')
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

  test('is deterministic and does not mutate immutable attachment inputs', () => {
    const activeTools = Object.freeze([
      Object.freeze(createTool('execute')),
      Object.freeze(createTool('generate_image')),
    ])
    const context = createContext({ attachmentRefs: [Object.freeze({ ...attachmentFixture })] })
    const input: ContextContributorInput = {
      ...createInput({ context }),
      activeTools,
    }
    const before = JSON.stringify(input)
    const firstRules = attachmentRulesContributor.build(input)
    const firstContext = attachmentContextContributor.build(input)

    assert.deepEqual(attachmentRulesContributor.build(input), firstRules)
    assert.deepEqual(attachmentContextContributor.build(input), firstContext)
    assert.equal(JSON.stringify(input), before)
  })
})

describe('file context contributor', () => {
  test('retains layer identity, position, volatility, and empty output', () => {
    const input = createInput()

    assert.equal(fileContextContributor.id, 'file-context')
    assert.equal(fileContextContributor.order, 14)
    assert.deepEqual(fileContextContributor.build(input), [
      { kind: 'file_context', messages: [], volatility: 'volatile' },
    ])
  })

  test.each([
    { activeTools: [], name: 'snapshot provider', overrides: {}, provider: 'openai' },
    {
      activeTools: [],
      name: 'provider override',
      overrides: { provider: 'openrouter' as const },
      provider: 'google',
    },
    {
      activeTools: [],
      name: 'override suppressing image exposure',
      overrides: { provider: 'google' as const },
      provider: 'openai',
    },
    {
      activeTools: [createTool('execute')],
      name: 'sandbox access',
      overrides: {},
      provider: 'openai',
    },
    {
      activeTools: [createTool('files__fs_read', 'mcp')],
      name: 'workspace file access',
      overrides: {},
      provider: 'openrouter',
    },
    { activeTools: [], name: 'unsupported snapshot provider', overrides: {}, provider: 'other' },
  ])('matches current provider, inline-reference, and access-mode behavior for $name', ({
    activeTools,
    overrides,
    provider,
  }) => {
    const input = createFileInput(provider, activeTools, overrides)

    assert.deepEqual(fileContextContributor.build(input), legacyContribution(input, 'file_context'))
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

  test('strict artifacts project to the exact legacy attachment and file contributions', () => {
    const input = createFileInput('openai')
    const contributors = [
      attachmentRulesContributor,
      attachmentContextContributor,
      fileContextContributor,
    ]
    const artifacts = buildContextArtifacts(contributors, input, { validationMode: 'strict' })
    const contributions = contributors.flatMap((contributor) => contributor.build(input))

    assert.deepEqual(projectContextArtifactMessages(artifacts), contributions)
  })

  test('is deterministic and leaves the input snapshot unchanged', () => {
    const input = createFileInput('openai', [createTool('execute')])
    const before = JSON.stringify(input)
    const first = fileContextContributor.build(input)

    assert.deepEqual(fileContextContributor.build(input), first)
    assert.equal(JSON.stringify(input), before)
  })
})
