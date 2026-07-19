import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import type { ContextContributorInput } from '../src/application/context/contracts'
import { buildContextContributions, contextContributors } from '../src/application/context/registry'
import {
  buildThreadInteractionRequestFields,
  toFallbackTaskMessages,
} from '../src/application/context/request-fields'
import {
  assembleThreadInteractionRequest,
  UNTHREADED_CONTEXT_MANIFEST_THREAD_ID,
} from '../src/application/interactions/assemble-thread-interaction-request'
import {
  createContextBudgetReport,
  createContextLayer,
  type ThreadContextData,
} from '../src/application/interactions/context-bundle'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import type { AiInteractionRequest, AiMessage } from '../src/domain/ai/types'
import {
  createContext,
  createTool,
  createVisibleMessage,
  textAndImageFilesFixture,
} from './fixtures/context/context-assembly'
import { scanContextSecurity } from './helpers/context-security-scanner'

interface ShadowFixture {
  readonly activeTools: ToolSpec[]
  readonly context: ThreadContextData
  readonly mcpCatalog: ContextContributorInput['mcpCatalog']
  readonly mcpMode: ContextContributorInput['mcpMode']
  readonly nativeTools: ContextContributorInput['nativeTools']
  readonly overrides: ContextContributorInput['overrides']
}

const fixture = (
  context: ThreadContextData,
  overrides: Partial<ShadowFixture> = {},
): ShadowFixture => ({
  activeTools: [],
  context,
  mcpCatalog: null,
  mcpMode: 'direct',
  nativeTools: [],
  overrides: {},
  ...overrides,
})

/** Independent reconstruction of the characterized pre-shadow assembly path. */
const assembleLegacyShape = (input: ShadowFixture) => {
  const contributorInput: ContextContributorInput = input
  const layers = buildContextContributions(contextContributors, contributorInput).map(
    ({ kind, messages, volatility }) =>
      createContextLayer(kind, volatility, messages as AiMessage[]),
  )
  const requestFields = buildThreadInteractionRequestFields(input)
  const assembledMessages = layers.flatMap((layer) => layer.messages)
  const request: AiInteractionRequest = {
    ...requestFields,
    messages:
      assembledMessages.length > 0 ? assembledMessages : toFallbackTaskMessages(input.context),
  }

  return {
    bundle: {
      ...input.context,
      budget: createContextBudgetReport(layers, requestFields.maxOutputTokens ?? null, request),
      layers,
    },
    request,
  }
}

const forbiddenManifestKeys = new Set([
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

const collectKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys)
  }
  if (typeof value !== 'object' || value === null) {
    return []
  }

  return Object.entries(value).flatMap(([key, entry]) => [key, ...collectKeys(entry)])
}

const rawMessage = 'SHADOW_ASSEMBLY_RAW_MESSAGE_MUST_BE_REDACTED'
const rawFile = 'Layer order matters.'
const rawDataUrl = 'data:image/png;base64,AQID'

const representativeFixtures: ReadonlyArray<readonly [string, () => ShadowFixture]> = [
  ['empty-layer task fallback', () => fixture(createContext())],
  [
    'messages, files, tools, native tools, and request controls',
    () => {
      const base = createContext()
      return fixture(
        createContext({
          run: {
            ...base.run,
            configSnapshot: {
              maxOutputTokens: 444,
              model: 'shadow-characterization-model',
              provider: 'openai',
            },
            turnCount: 3,
          },
          visibleFiles: textAndImageFilesFixture,
          visibleMessages: [createVisibleMessage({ text: rawMessage })],
        }),
        {
          activeTools: [createTool('shadow_lookup')],
          nativeTools: ['web_search'],
        },
      )
    },
  ],
]

describe('context v2 shadow assembly integration', () => {
  test.each(
    representativeFixtures,
  )('preserves the characterized request and bundle for %s', (_name, createFixture) => {
    const input = createFixture()
    const expected = assembleLegacyShape(input)
    const result = assembleThreadInteractionRequest(input)

    assert.deepEqual(result.request, expected.request)
    assert.deepEqual(result.bundle, expected.bundle)
    assert.ok(result.artifacts.every((artifact) => artifact.metadataStatus === 'declared'))
    assert.ok(result.policyDecisions.every((decision) => decision.outcome === 'allow'))
    assert.deepEqual(result.manifest.rejected, [])
    assert.deepEqual(
      new Set(result.manifest.selected.map((entry) => entry.artifactId)),
      new Set(result.artifacts.map((artifact) => artifact.id)),
    )
  })

  test('combines all declared artifact families and builds a deterministic redacted manifest', () => {
    const input = representativeFixtures[1]?.[1]()
    assert.ok(input)

    const first = assembleThreadInteractionRequest(input)
    const repeated = assembleThreadInteractionRequest(input)
    const artifactTokens = first.artifacts.reduce(
      (total, artifact) => total + artifact.estimatedTokens,
      0,
    )
    const serialized = JSON.stringify(first.manifest)

    assert.equal(first.artifacts.length, 19)
    assert.deepEqual(
      first.artifacts.map((artifact) => artifact.payload.kind),
      [
        ...Array.from({ length: 15 }, () => 'messages'),
        'tools',
        'native_tools',
        'request_options',
        'metadata',
      ],
    )
    assert.equal(first.manifest.assemblerVersion, 'context-assembly/v2-shadow-1')
    assert.equal(first.manifest.coordinates.turn, input.context.run.turnCount + 1)
    assert.equal(first.manifest.generatedAt, input.context.run.updatedAt)
    assert.equal(first.manifest.provider, 'openai')
    assert.equal(first.manifest.model, 'shadow-characterization-model')
    assert.deepEqual(first.manifest.budget, {
      availableInputTokens: null,
      consideredArtifactTokens: artifactTokens,
      droppedArtifactTokens: 0,
      inputTokenLimit: null,
      reservedOutputTokens: first.bundle.budget.reservedOutputTokens,
      selectedArtifactTokens: artifactTokens,
    })
    assert.deepEqual(first.artifacts, repeated.artifacts)
    assert.deepEqual(first.policyDecisions, repeated.policyDecisions)
    assert.deepEqual(first.manifest, repeated.manifest)
    assert.deepEqual(scanContextSecurity(first.manifest, 'manifest'), [])
    assert.deepEqual(
      [...new Set(collectKeys(first.manifest).filter((key) => forbiddenManifestKeys.has(key)))],
      [],
    )
    for (const rawContent of [rawMessage, rawFile, rawDataUrl]) {
      assert.equal(serialized.includes(rawContent), false)
    }
  })

  test('records a generic policy rejection without changing the legacy request or bundle', () => {
    const unsafeTool: ToolSpec = {
      ...createTool('credential_probe'),
      inputSchema: {
        additionalProperties: false,
        properties: { password: { type: 'string' } },
        required: ['password'],
        type: 'object',
      },
    }
    const input = fixture(createContext(), { activeTools: [unsafeTool] })
    const expected = assembleLegacyShape(input)
    const result = assembleThreadInteractionRequest(input)
    const rejectedDecisions = result.policyDecisions.filter(
      (decision) => decision.outcome === 'reject',
    )
    const toolsArtifact = result.artifacts.find((artifact) => artifact.payload.kind === 'tools')

    assert.ok(toolsArtifact)
    assert.deepEqual(result.request, expected.request)
    assert.deepEqual(result.bundle, expected.bundle)
    assert.equal(result.request.tools?.[0]?.name, 'credential_probe')
    assert.equal(rejectedDecisions.length, 1)
    assert.deepEqual(
      rejectedDecisions[0]?.reasons.map((reason) => reason.code),
      ['unsafe_credential_field'],
    )
    assert.equal(result.manifest.rejected.length, 1)
    assert.deepEqual(result.manifest.rejected[0]?.reasonCodes, ['policy_rejected'])
    assert.equal(result.manifest.rejected[0]?.artifact.artifactId, toolsArtifact.id)
    assert.equal(
      result.manifest.selected.some((entry) => entry.artifactId === toolsArtifact.id),
      false,
    )
  })

  test('uses nonempty routing fallbacks and confines the unthreaded sentinel to manifest coordinates', () => {
    const base = createContext()
    const input = fixture(
      createContext({
        run: {
          ...base.run,
          configSnapshot: {},
          threadId: null,
        },
      }),
    )
    const expected = assembleLegacyShape(input)
    const result = assembleThreadInteractionRequest(input)

    assert.deepEqual(result.request, expected.request)
    assert.deepEqual(result.bundle, expected.bundle)
    assert.equal(result.manifest.provider, 'provider-unspecified')
    assert.equal(result.manifest.model, 'model-unspecified')
    assert.equal(result.manifest.coordinates.threadId, UNTHREADED_CONTEXT_MANIFEST_THREAD_ID)
    assert.equal(
      JSON.stringify(result.request).includes(UNTHREADED_CONTEXT_MANIFEST_THREAD_ID),
      false,
    )
    assert.equal(
      JSON.stringify(result.bundle).includes(UNTHREADED_CONTEXT_MANIFEST_THREAD_ID),
      false,
    )
    assert.equal(
      JSON.stringify(result.artifacts).includes(UNTHREADED_CONTEXT_MANIFEST_THREAD_ID),
      false,
    )
  })
})
