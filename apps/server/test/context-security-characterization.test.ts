import assert from 'node:assert/strict'
import { test } from 'vitest'

import { buildCreateInteractionParams } from '../src/adapters/ai/google/google-request'
import { createRequestBody as createOpenAiRequestBody } from '../src/adapters/ai/openai/openai-request'
import { createRequestBody as createOpenRouterRequestBody } from '../src/adapters/ai/openrouter/openrouter-request'
import type { VisibleFileContextEntry } from '../src/application/files/file-context'
import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import type { ThreadContextData } from '../src/application/interactions/context-bundle'
import type { ResolvedAiInteractionRequest } from '../src/domain/ai/types'
import type { ItemRecord } from '../src/domain/runtime/item-repository'
import {
  asAccountId,
  asFileId,
  asItemId,
  asRunId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
} from '../src/shared/ids'
import { scanContextSecurity } from './helpers/context-security-scanner'

const secretSentinels = {
  apiKey: 'sk-context-must-not-cross',
  authorization: 'Bearer context-must-not-cross',
  cookie: 'session=context-must-not-cross',
  oauthToken: 'oauth-context-must-not-cross',
  password: 'password-context-must-not-cross',
  storageKey: 'private/storage/context-must-not-cross',
} as const

const reasoningCiphertext = 'opaque-provider-reasoning-replay'
const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo='

const createSensitiveSourceContext = (): ThreadContextData => {
  const runId = asRunId('run_security_characterization')
  const tenantId = asTenantId('ten_security_characterization')
  const sessionId = asWorkSessionId('ses_security_characterization')
  const threadId = asSessionThreadId('thr_security_characterization')
  const reasoningItem: ItemRecord = {
    arguments: null,
    callId: null,
    content: null,
    createdAt: '2026-04-08T10:00:00.000Z',
    id: asItemId('itm_security_reasoning'),
    name: null,
    output: null,
    providerPayload: {
      encryptedContent: reasoningCiphertext,
      provider: 'openai',
      providerItemId: 'rs_security_replay',
      storageKey: secretSentinels.storageKey,
      accessToken: secretSentinels.oauthToken,
    },
    role: null,
    runId,
    sequence: 1,
    summary: [{ text: 'Reasoning summary safe for replay.', type: 'summary_text' }],
    tenantId,
    type: 'reasoning',
  }
  const visibleImage = {
    accountId: 'acc_internal_file_owner',
    body: new Uint8Array([137, 80, 78, 71]),
    dataUrl: imageDataUrl,
    fileId: asFileId('fil_security_image'),
    messageId: null,
    mimeType: 'image/png',
    originalFilename: 'diagram.png',
    storageKey: secretSentinels.storageKey,
    textContent: null,
  } satisfies VisibleFileContextEntry & {
    accountId: string
    body: Uint8Array
    storageKey: string
  }

  return {
    activeReflection: null,
    agentProfile: null,
    attachmentRefs: [],
    gardenContext: null,
    items: [reasoningItem],
    observations: [],
    pendingWaits: [],
    run: {
      actorAccountId: asAccountId('acc_internal_actor'),
      agentId: null,
      agentRevisionId: null,
      completedAt: null,
      configSnapshot: {
        apiKey: secretSentinels.apiKey,
        headers: {
          Authorization: secretSentinels.authorization,
          Cookie: secretSentinels.cookie,
        },
        model: 'gpt-5.4',
        oauth: {
          accessToken: secretSentinels.oauthToken,
        },
        password: secretSentinels.password,
        provider: 'openai',
      },
      createdAt: '2026-04-08T10:00:00.000Z',
      errorJson: {
        authorization: secretSentinels.authorization,
      },
      id: runId,
      jobId: null,
      lastProgressAt: '2026-04-08T10:00:00.000Z',
      parentRunId: null,
      resultJson: {
        cookie: secretSentinels.cookie,
      },
      rootRunId: runId,
      sessionId,
      sourceCallId: null,
      staleRecoveryCount: 0,
      startedAt: '2026-04-08T10:00:00.000Z',
      status: 'running',
      targetKind: 'assistant',
      task: 'Describe the attached diagram.',
      tenantId,
      threadId,
      toolProfileId: null,
      turnCount: 1,
      updatedAt: '2026-04-08T10:00:00.000Z',
      version: 1,
      workspaceId: null,
      workspaceRef: null,
    },
    summary: null,
    visibleFiles: [visibleImage],
    visibleMessages: [],
  }
}

const toFindingLabels = (value: unknown, surface: 'manifest' | 'provider_context'): string[] =>
  scanContextSecurity(value, surface)
    .map((finding) => `${finding.kind}:${finding.path}`)
    .sort()

test('security scanner recursively identifies forbidden credential and account fields by path', () => {
  const fixture = {
    auth: {
      headers: {
        Authorization: secretSentinels.authorization,
        'x-api-key': secretSentinels.apiKey,
      },
      password: secretSentinels.password,
    },
    files: [{ storageKey: secretSentinels.storageKey }],
    identity: {
      accountEmail: 'private@example.test',
      actorAccountId: 'acc_private',
    },
    oauth: {
      access_token: secretSentinels.oauthToken,
      refreshToken: secretSentinels.oauthToken,
    },
    sessions: [{ cookies: secretSentinels.cookie }],
  }

  assert.deepEqual(toFindingLabels(fixture, 'provider_context'), [
    'account_field:$.identity.accountEmail',
    'account_field:$.identity.actorAccountId',
    'credential_field:$.auth.headers.Authorization',
    'credential_field:$.auth.headers["x-api-key"]',
    'credential_field:$.auth.password',
    'credential_field:$.files[0].storageKey',
    'credential_field:$.oauth.access_token',
    'credential_field:$.oauth.refreshToken',
    'credential_field:$.sessions[0].cookies',
  ])
  assert.deepEqual(
    scanContextSecurity(
      { encryptedContent: reasoningCiphertext, id: 'rs_allowed', summary: [], type: 'reasoning' },
      'provider_context',
    ),
    [],
  )
  assert.deepEqual(
    toFindingLabels({ encryptedContent: 'opaque', type: 'message' }, 'provider_context'),
    ['encrypted_payload:$.encryptedContent'],
  )
})

test('provider-neutral assembly excludes unrelated source secrets and allows encrypted reasoning replay', () => {
  const result = assembleThreadInteractionRequest({
    activeTools: [],
    context: createSensitiveSourceContext(),
    nativeTools: [],
    overrides: {},
  })
  const serializedRequest = JSON.stringify(result.request)

  assert.deepEqual(scanContextSecurity(result.request, 'provider_context'), [])
  assert.equal(result.request.metadata?.tenantId, 'ten_security_characterization')
  assert.equal(Object.hasOwn(result.request.metadata ?? {}, 'accountId'), false)
  assert.equal(serializedRequest.includes(reasoningCiphertext), true)
  assert.equal(serializedRequest.includes(imageDataUrl), true)

  for (const secret of Object.values(secretSentinels)) {
    assert.equal(serializedRequest.includes(secret), false, `provider request leaked ${secret}`)
  }
})

test('provider adapters preserve only the allowlisted encrypted reasoning replay payload', () => {
  const assembled = assembleThreadInteractionRequest({
    activeTools: [],
    context: createSensitiveSourceContext(),
    nativeTools: [],
    overrides: {},
  }).request
  const openAiRequest: ResolvedAiInteractionRequest = {
    ...assembled,
    model: 'gpt-5.4',
    provider: 'openai',
  }
  const openRouterRequest: ResolvedAiInteractionRequest = {
    ...assembled,
    model: 'openai/gpt-5.4',
    provider: 'openrouter',
  }
  const googleRequest: ResolvedAiInteractionRequest = {
    ...assembled,
    messages: assembled.messages.map((message) => ({
      ...message,
      content: message.content.filter((part) => part.type !== 'image_url'),
    })),
    model: 'gemini-2.5-flash',
    provider: 'google',
  }
  const providerPayloads = [
    createOpenAiRequestBody(
      openAiRequest,
      { defaultServiceTier: null, maxRetries: 0, timeoutMs: 1_000 },
      false,
    ),
    createOpenRouterRequestBody(
      openRouterRequest,
      {
        appCategories: null,
        appTitle: null,
        httpReferer: null,
        maxRetries: 0,
        timeoutMs: 1_000,
      },
      false,
    ),
    buildCreateInteractionParams(
      googleRequest,
      { defaultHttpTimeoutMs: 1_000, maxRetries: 0 },
      false,
    ),
  ]

  for (const payload of providerPayloads) {
    assert.deepEqual(scanContextSecurity(payload, 'provider_context'), [])
    const serializedPayload = JSON.stringify(payload)

    for (const secret of Object.values(secretSentinels)) {
      assert.equal(serializedPayload.includes(secret), false, `adapter payload leaked ${secret}`)
    }
  }

  assert.equal(JSON.stringify(providerPayloads[0]).includes(reasoningCiphertext), true)
  assert.equal(JSON.stringify(providerPayloads[1]).includes(reasoningCiphertext), true)
})
