import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import type { ContextArtifact, ContextArtifactPayload } from '../src/application/context/contracts'
import {
  type BuildContextManifestInput,
  buildContextManifest,
  type ContextManifestReasonCode,
} from '../src/application/context/manifest'
import { scanContextSecurity } from './helpers/context-security-scanner'

const payloadSecret = 'PAYLOAD_CONTENT_MUST_NEVER_ENTER_MANIFEST'
const fileSecret = 'COMPLETE_PRIVATE_FILE_CONTENT_MUST_NEVER_ENTER_MANIFEST'
const dataUrl = 'data:image/png;base64,MANIFEST_MUST_NOT_CONTAIN_THIS'
const encryptedReasoning = 'ENCRYPTED_REASONING_MUST_NEVER_ENTER_MANIFEST'
const toolSecret = 'TOOL_SCHEMA_ARGUMENT_RESULT_MUST_NEVER_ENTER_MANIFEST'

const artifact = (
  id: string,
  payload: ContextArtifactPayload,
  overrides: Partial<ContextArtifact> = {},
): ContextArtifact => ({
  authority: 'conversation',
  capturedAt: '2026-04-08T10:00:00.000Z',
  conflictKey: `conflict-${id}`,
  dedupeKey: `dedupe-${id}`,
  dependencies: [],
  estimatedTokens: 12,
  expiresAt: '2026-04-09T10:00:00.000Z',
  id,
  layer: 'visible_message_history',
  metadataStatus: 'declared',
  payload,
  priority: 10,
  provenance: {
    createdByRunId: 'run_artifact_builder',
    sourceIds: [`source-z-${id}`, `source-a-${id}`],
    sourceType: 'user_message',
    sourceVersion: 'source-version-is-not-exported',
  },
  requirement: 'preferred',
  sensitivity: 'private',
  supersedes: [],
  transformation: { kind: 'none' },
  visibility: 'model',
  volatility: 'volatile',
  ...overrides,
})

const sensitiveMessageArtifact = artifact(
  'ctxa_message',
  {
    kind: 'messages',
    messages: [
      {
        content: [
          { text: payloadSecret, type: 'text' },
          { imageUrl: dataUrl, type: 'image_url' },
        ],
        role: 'user',
      },
      {
        arguments: toolSecret,
        callId: 'call_secret',
        name: 'secret_tool',
        role: 'tool',
        status: 'completed',
        type: 'tool_call',
      },
    ] as ContextArtifactPayload extends { kind: 'messages'; messages: infer T } ? T : never,
  },
  {
    dependencies: [fileSecret],
    transformation: {
      fields: ['messages[*].encryptedContent'],
      kind: 'redacted',
    },
  },
)

const sensitiveToolArtifact = artifact(
  'ctxa_tool',
  {
    kind: 'tools',
    tools: [
      {
        description: toolSecret,
        inputSchema: {
          properties: {
            password: { description: toolSecret, type: 'string' },
          },
          type: 'object',
        },
        name: 'dangerous_tool',
      },
    ],
  },
  {
    authority: 'agent_configuration',
    layer: 'tool_context',
    provenance: {
      createdByRunId: null,
      sourceIds: ['tool-b', 'tool-a'],
      sourceType: 'runtime',
      sourceVersion: null,
    },
    transformation: {
      kind: 'summarized',
      sourceRefs: ['source-b', 'source-a'],
      summarizerVersion: 'safe-summarizer-v1',
    },
  },
)

const sensitiveOptionsArtifact = artifact('ctxa_options', {
  kind: 'request_options',
  options: {
    maxOutputTokens: 100,
    metadata: {
      encryptedContent: encryptedReasoning,
      fileBody: fileSecret,
      password: payloadSecret,
      toolArguments: toolSecret,
    },
  } as never,
})

const budget = {
  availableInputTokens: 1_000,
  consideredArtifactTokens: 36,
  droppedArtifactTokens: 12,
  inputTokenLimit: 1_200,
  reservedOutputTokens: 200,
  selectedArtifactTokens: 24,
} as const

const baseInput = (): BuildContextManifestInput => ({
  assemblerVersion: 'assembler-v2-shadow.1',
  budget,
  generatedAt: '2026-04-08T10:01:00.000Z',
  model: 'model-v1',
  persistenceId: 'manifest-row-1',
  provider: 'provider-a',
  runId: 'run-1',
  selectedArtifacts: [sensitiveToolArtifact, sensitiveMessageArtifact],
  threadId: 'thread-1',
  turn: 4,
})

const collectKeys = (value: unknown): string[] => {
  const keys: string[] = []

  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (typeof current !== 'object' || current === null) {
      return
    }
    for (const [key, entry] of Object.entries(current)) {
      keys.push(key)
      visit(entry)
    }
  }

  visit(value)
  return keys
}

describe('context/v2 redacted shadow manifest', () => {
  test('recursively exports only allowlisted metadata and never artifact content', () => {
    const manifest = buildContextManifest({
      ...baseInput(),
      dropped: [{ artifact: sensitiveOptionsArtifact, reasonCodes: ['provider_unsupported'] }],
    })
    const serialized = JSON.stringify(manifest)
    const forbiddenKeys = new Set([
      'arguments',
      'body',
      'content',
      'dataUrl',
      'encryptedContent',
      'fileBody',
      'inputSchema',
      'messages',
      'options',
      'output',
      'payload',
      'result',
      'schema',
      'textContent',
      'tools',
    ])

    assert.deepEqual(scanContextSecurity(manifest, 'manifest'), [])
    assert.deepEqual(
      [...new Set(collectKeys(manifest).filter((key) => forbiddenKeys.has(key)))].sort(),
      [],
    )
    for (const secret of [payloadSecret, fileSecret, dataUrl, encryptedReasoning, toolSecret]) {
      assert.equal(serialized.includes(secret), false, `manifest leaked ${secret}`)
    }

    assert.deepEqual(
      manifest.selected.map((entry) => entry.artifactId),
      ['ctxa_message', 'ctxa_tool'],
    )
    assert.deepEqual(
      manifest.selected.map((entry) => entry.payloadKind),
      ['messages', 'tools'],
    )
    assert.deepEqual(manifest.selected[0]?.source.ids, [
      'source-a-ctxa_message',
      'source-z-ctxa_message',
    ])
  })

  test('canonicalizes semantic sets and produces stable order and replay hash', () => {
    const reasonCodes: readonly ContextManifestReasonCode[] = [
      'not_relevant',
      'duplicate',
      'not_relevant',
    ]
    const first = buildContextManifest({
      ...baseInput(),
      conflicts: [
        {
          losers: [sensitiveOptionsArtifact, sensitiveToolArtifact],
          reasonCodes: ['conflict_lower_authority'],
          winner: sensitiveMessageArtifact,
        },
      ],
      dropped: [
        { artifact: sensitiveToolArtifact, reasonCodes: ['token_budget'] },
        { artifact: sensitiveOptionsArtifact, reasonCodes },
      ],
      selectedArtifacts: [sensitiveToolArtifact, sensitiveMessageArtifact],
    })
    const second = buildContextManifest({
      ...baseInput(),
      conflicts: [
        {
          losers: [sensitiveToolArtifact, sensitiveOptionsArtifact],
          reasonCodes: ['conflict_lower_authority'],
          winner: sensitiveMessageArtifact,
        },
      ],
      dropped: [
        { artifact: sensitiveOptionsArtifact, reasonCodes: [...reasonCodes].reverse() },
        { artifact: sensitiveToolArtifact, reasonCodes: ['token_budget'] },
      ],
      selectedArtifacts: [sensitiveMessageArtifact, sensitiveToolArtifact],
    })

    assert.equal(first.replayHash, second.replayHash)
    assert.match(first.replayHash, /^ctxm_[a-f0-9]{64}$/)
    assert.deepEqual(first.selected, second.selected)
    assert.deepEqual(first.dropped, second.dropped)
    assert.deepEqual(first.conflicts, second.conflicts)
    assert.deepEqual(first.dropped[0]?.reasonCodes, ['duplicate', 'not_relevant'])
    assert.deepEqual(
      first.conflicts[0]?.losers.map((entry) => entry.artifactId),
      ['ctxa_options', 'ctxa_tool'],
    )
  })

  test('excludes generated time and persistence coordinates from replay identity', () => {
    const first = buildContextManifest(baseInput())
    const replay = buildContextManifest({
      ...baseInput(),
      generatedAt: '2030-01-02T03:04:05.000Z',
      persistenceId: 'manifest-row-for-replay',
      runId: 'run-replay',
      threadId: 'thread-replay',
      turn: 99,
    })

    assert.equal(first.replayHash, replay.replayHash)
    assert.notDeepEqual(first.coordinates, replay.coordinates)
    assert.notEqual(first.generatedAt, replay.generatedAt)
    assert.notEqual(first.persistenceId, replay.persistenceId)
  })

  test('records selected, transformed, dropped, rejected, and conflict categories', () => {
    const truncated = artifact(
      'ctxa_truncated',
      { kind: 'metadata', metadata: {} },
      {
        transformation: { includedBytes: 20, kind: 'truncated', originalBytes: 100 },
      },
    )
    const manifest = buildContextManifest({
      ...baseInput(),
      conflicts: [
        {
          losers: [sensitiveOptionsArtifact],
          reasonCodes: ['conflict_lower_authority'],
          winner: sensitiveMessageArtifact,
        },
      ],
      dropped: [
        {
          artifact: sensitiveToolArtifact,
          reasonCodes: ['token_budget', 'missing_dependency'],
        },
      ],
      rejected: [
        {
          artifact: sensitiveOptionsArtifact,
          reasonCodes: ['policy_rejected', 'provider_unsupported'],
        },
      ],
      selectedArtifacts: [sensitiveMessageArtifact],
      transformed: [{ artifact: truncated, reasonCodes: ['token_budget'] }],
    })

    assert.deepEqual(
      manifest.selected.map((entry) => entry.artifactId),
      ['ctxa_message'],
    )
    assert.equal(manifest.transformed[0]?.artifact.transformation.kind, 'truncated')
    assert.deepEqual(manifest.dropped[0]?.reasonCodes, ['missing_dependency', 'token_budget'])
    assert.deepEqual(manifest.rejected[0]?.reasonCodes, ['policy_rejected', 'provider_unsupported'])
    assert.equal(manifest.conflicts[0]?.winner.artifactId, 'ctxa_message')
    assert.deepEqual(
      manifest.conflicts[0]?.losers.map((entry) => entry.artifactId),
      ['ctxa_options'],
    )
  })
})
