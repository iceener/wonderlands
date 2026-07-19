import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import type {
  ContextArtifact,
  ContextArtifactPayload,
  ContextArtifactSensitivity,
} from '../src/application/context/contracts'
import {
  type ContextPolicyDecision,
  type ContextPolicyReasonCode,
  evaluateContextArtifactPolicy,
  evaluateContextArtifactsPolicy,
} from '../src/application/context/policy'

const now = '2026-07-19T12:00:00.000Z'

const createArtifact = (id: string, overrides: Partial<ContextArtifact> = {}): ContextArtifact => ({
  authority: 'conversation',
  capturedAt: '2026-07-19T11:00:00.000Z',
  conflictKey: null,
  dedupeKey: null,
  dependencies: [],
  estimatedTokens: 1,
  expiresAt: null,
  id,
  layer: 'visible_message_history',
  metadataStatus: 'declared',
  payload: {
    kind: 'messages',
    messages: [{ content: [{ text: 'Safe context.', type: 'text' }], role: 'user' }],
  },
  priority: 0,
  provenance: {
    createdByRunId: 'run_policy',
    sourceIds: ['msg_policy'],
    sourceType: 'user_message',
    sourceVersion: null,
  },
  requirement: 'preferred',
  sensitivity: 'private',
  supersedes: [],
  transformation: { kind: 'none' },
  visibility: 'model',
  volatility: 'stable',
  ...overrides,
})

const decide = (
  artifact: ContextArtifact,
  candidateIds: readonly string[] = [artifact.id],
): ContextPolicyDecision => evaluateContextArtifactPolicy(artifact, { candidateIds, now })

const reasonCodes = (decision: ContextPolicyDecision): ContextPolicyReasonCode[] =>
  decision.reasons.map(({ code }) => code)

const unsafePayload = (value: unknown): ContextArtifactPayload => value as ContextArtifactPayload

describe('context artifact policy', () => {
  test('allows public, private, and restricted candidates but rejects provider-visible secrets', () => {
    const expected = new Map<ContextArtifactSensitivity, ContextPolicyDecision['outcome']>([
      ['public', 'allow'],
      ['private', 'allow'],
      ['restricted', 'allow'],
      ['secret', 'reject'],
    ])

    for (const [sensitivity, outcome] of expected) {
      const decision = decide(createArtifact(`artifact_${sensitivity}`, { sensitivity }))
      assert.equal(decision.outcome, outcome)
      assert.deepEqual(
        reasonCodes(decision),
        sensitivity === 'secret' ? ['secret_provider_visibility'] : [],
      )
    }

    const requestSecret = createArtifact('request_secret', {
      payload: { kind: 'metadata', metadata: { traceId: 'safe_trace' } },
      sensitivity: 'secret',
      visibility: 'request',
    })
    assert.deepEqual(reasonCodes(decide(requestSecret)), ['secret_provider_visibility'])
  })

  test('fails closed on undeclared metadata in strict mode and permits explicit legacy shadow mode', () => {
    const artifact = createArtifact('legacy', { metadataStatus: 'legacy_shadow' })

    assert.deepEqual(reasonCodes(decide(artifact)), ['undeclared_metadata'])
    assert.equal(
      evaluateContextArtifactPolicy(artifact, {
        candidateIds: [artifact.id],
        now,
        validationMode: 'legacy-shadow',
      }).outcome,
      'allow',
    )
  })

  test('uses the injected instant for exact expiry boundaries', () => {
    const expired = createArtifact('expired', { expiresAt: '2026-07-19T11:59:59.999Z' })
    const atBoundary = createArtifact('at_boundary', { expiresAt: now })
    const notYetExpired = createArtifact('not_yet_expired', {
      expiresAt: '2026-07-19T12:00:00.001Z',
    })

    assert.deepEqual(reasonCodes(decide(expired)), ['expired'])
    assert.deepEqual(reasonCodes(decide(atBoundary)), ['expired'])
    assert.equal(decide(notYetExpired).outcome, 'allow')
    assert.throws(
      () => evaluateContextArtifactPolicy(notYetExpired, { candidateIds: [], now: 'not-a-time' }),
      /valid now timestamp/,
    )
    assert.throws(
      () => decide(createArtifact('bad_expiry', { expiresAt: 'not-a-time' })),
      /valid expiresAt/,
    )
  })

  test('validates dependencies against the complete candidate ID set, independent of order', () => {
    const dependency = createArtifact('dependency')
    const dependent = createArtifact('dependent', {
      dependencies: ['dependency', 'missing_one', 'missing_two'],
    })
    const decisions = evaluateContextArtifactsPolicy([dependent, dependency], { now })

    assert.equal(decisions[1]?.outcome, 'allow')
    assert.deepEqual(decisions[0]?.reasons, [
      { code: 'missing_dependency', dependencyId: 'missing_one' },
      { code: 'missing_dependency', dependencyId: 'missing_two' },
    ])
    assert.throws(
      () => evaluateContextArtifactsPolicy([dependency, createArtifact('dependency')], { now }),
      /Duplicate context policy candidate id/,
    )
  })

  test('rejects normalized credential key aliases in request-control metadata', () => {
    const aliases = [
      'Authorization',
      'auth-header',
      'x-api-key',
      'access_token',
      'oauthAccessToken',
      'refresh-token',
      'cookies',
      'password_hash',
      'client_secret',
      'secret_key',
      'session-cookie',
      'session_cookies',
      'encryption_key',
      'privateKey',
      'storage_key',
    ]

    for (const [index, alias] of aliases.entries()) {
      const artifact = createArtifact(`credential_${index}`, {
        payload: { kind: 'metadata', metadata: { [alias]: 'must-not-cross' } },
        visibility: 'request',
      })
      const decision = decide(artifact)

      assert.equal(decision.outcome, 'reject', alias)
      assert.deepEqual(reasonCodes(decision), ['unsafe_credential_field'], alias)
      assert.ok(decision.reasons[0]?.path?.includes(alias))
    }
  })

  test('rejects account identity and tenant membership fields while allowing tenant correlation IDs', () => {
    for (const key of [
      'accountEmail',
      'billingAccountEmail',
      'account_name',
      'accountDisplayName',
      'actorAccountId',
      'billing-account-id',
      'tenantMembership',
    ]) {
      const artifact = createArtifact(`account_${key}`, {
        payload: { kind: 'metadata', metadata: { [key]: 'private-identity' } },
        visibility: 'request',
      })
      assert.deepEqual(reasonCodes(decide(artifact)), ['unsafe_account_field'], key)
    }

    const tenantCorrelation = createArtifact('tenant_correlation', {
      payload: { kind: 'metadata', metadata: { tenantId: 'ten_policy' } },
      visibility: 'request',
    })
    assert.equal(decide(tenantCorrelation).outcome, 'allow')
  })

  test('rejects data URLs, file bodies, binary values, and encrypted content in controls and provenance', () => {
    const metadata = createArtifact('raw_metadata', {
      payload: unsafePayload({
        kind: 'metadata',
        metadata: {
          body: 'complete file body',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
      }),
      visibility: 'request',
    })
    assert.deepEqual(reasonCodes(decide(metadata)), [
      'unsafe_file_body',
      'unsafe_file_body',
      'unsafe_data_url',
    ])

    const requestOptions = createArtifact('raw_request', {
      payload: unsafePayload({
        kind: 'request_options',
        options: { transport: { rawBytes: new Uint8Array([1, 2, 3]) } },
      }),
      visibility: 'request',
    })
    assert.deepEqual(reasonCodes(decide(requestOptions)), ['unsafe_file_body'])

    const unsafeProvenance = createArtifact('raw_provenance', {
      provenance: {
        ...createArtifact('source').provenance,
        encryptedContent: 'opaque-but-not-a-model-message',
        storage_key: 'private/files/blob',
      } as ContextArtifact['provenance'],
    })
    assert.deepEqual(reasonCodes(decide(unsafeProvenance)), [
      'unsafe_encrypted_payload',
      'unsafe_credential_field',
    ])
  })

  test('does not scan arbitrary message text or serialized function arguments/results', () => {
    const legitimateMessages = createArtifact('legitimate_messages', {
      payload: {
        kind: 'messages',
        messages: [
          {
            content: [
              {
                text: 'Discuss apiKey, password, accountEmail, and data:text/plain safely.',
                type: 'text',
              },
              {
                argumentsJson:
                  '{"authorization":"user supplied example","body":"data:text/plain,hello"}',
                callId: 'call_policy',
                name: 'inspect_user_input',
                type: 'function_call',
              },
              {
                callId: 'call_policy',
                name: 'inspect_user_input',
                outputJson: '{"storageKey":"tool result text","accountId":"quoted value"}',
                type: 'function_result',
              },
              {
                detail: 'auto',
                type: 'image_url',
                url: 'data:image/png;base64,iVBORw0KGgo=',
              },
              {
                encryptedContent: 'opaque-provider-reasoning-replay',
                id: 'reasoning_policy',
                summary: [{ text: 'Safe reasoning summary.', type: 'summary_text' }],
                type: 'reasoning',
              },
            ],
            role: 'assistant',
          },
        ],
      },
    })

    assert.equal(decide(legitimateMessages).outcome, 'allow')
  })

  test('allows reasoning encryption only in model message payloads and still scans message structure', () => {
    const requestVisibleReasoning = createArtifact('request_reasoning', {
      payload: {
        kind: 'messages',
        messages: [
          {
            content: [
              {
                encryptedContent: 'opaque-provider-reasoning-replay',
                id: 'reasoning_request_policy',
                summary: [],
                type: 'reasoning',
              },
            ],
            role: 'assistant',
          },
        ],
      },
      visibility: 'request',
    })
    assert.deepEqual(reasonCodes(decide(requestVisibleReasoning)), ['unsafe_encrypted_payload'])

    const malformedText = createArtifact('malformed_text', {
      payload: unsafePayload({
        kind: 'messages',
        messages: [
          {
            content: [
              {
                encryptedContent: 'not-reasoning',
                text: 'hello',
                type: 'text',
              },
            ],
            role: 'user',
          },
        ],
      }),
    })
    assert.deepEqual(reasonCodes(decide(malformedText)), ['unsafe_encrypted_payload'])

    const structuralCredential = createArtifact('message_structural_credential', {
      payload: unsafePayload({
        kind: 'messages',
        messages: [
          {
            accountId: 'acc_private',
            content: [{ text: 'Normal message.', type: 'text' }],
            role: 'user',
          },
        ],
      }),
    })
    assert.deepEqual(reasonCodes(decide(structuralCredential)), ['unsafe_account_field'])
  })
})
