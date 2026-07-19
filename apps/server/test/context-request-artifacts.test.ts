import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import type { ContextArtifact, ContextContributorInput } from '../src/application/context/contracts'
import { buildRequestContextArtifacts } from '../src/application/context/request-artifacts'
import {
  buildThreadInteractionRequestFields,
  type ThreadInteractionRequestFields,
} from '../src/application/context/request-fields'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import { asAgentId, asAgentRevisionId, asToolProfileId } from '../src/shared/ids'
import {
  createContext,
  createTool,
  createVisibleMessage,
} from './fixtures/context/context-assembly'
import { scanContextSecurity } from './helpers/context-security-scanner'

const createInput = (
  activeTools: readonly ToolSpec[] = [],
  nativeTools: ContextContributorInput['nativeTools'] = [],
): ContextContributorInput => {
  const context = createContext()

  return {
    activeTools,
    context: {
      ...context,
      run: {
        ...context.run,
        agentId: asAgentId('agt_request_artifacts'),
        agentRevisionId: asAgentRevisionId('agr_request_artifacts'),
        toolProfileId: asToolProfileId('tpf_request_artifacts'),
      },
    },
    mcpCatalog: null,
    mcpMode: 'direct',
    nativeTools,
    overrides: {},
  }
}

const artifactMetadataOnly = ({ payload: _payload, ...metadata }: ContextArtifact): unknown =>
  metadata

const getArtifact = (
  artifacts: readonly ContextArtifact[],
  kind: ContextArtifact['payload']['kind'],
): ContextArtifact => {
  const artifact = artifacts.find((candidate) => candidate.payload.kind === kind)
  assert.ok(artifact)
  return artifact
}

describe('request-visible context artifacts', () => {
  test('uses deterministic semantic IDs without reordering the already-built request payload', () => {
    const alpha = createTool('alpha_search')
    const zeta = createTool('zeta_lookup')
    const firstInput = createInput([zeta, alpha], ['web_search'])
    const reorderedInput = createInput([alpha, zeta], ['web_search'])
    const firstFields = buildThreadInteractionRequestFields({
      activeTools: [...firstInput.activeTools] as ToolSpec[],
      context: firstInput.context,
      nativeTools: [...firstInput.nativeTools],
      overrides: firstInput.overrides,
    })
    const reorderedFields = buildThreadInteractionRequestFields({
      activeTools: [...reorderedInput.activeTools] as ToolSpec[],
      context: reorderedInput.context,
      nativeTools: [...reorderedInput.nativeTools],
      overrides: reorderedInput.overrides,
    })

    const first = buildRequestContextArtifacts(firstFields, firstInput)
    const reordered = buildRequestContextArtifacts(reorderedFields, reorderedInput)
    const firstTools = getArtifact(first, 'tools')
    const reorderedTools = getArtifact(reordered, 'tools')

    assert.equal(firstTools.id, reorderedTools.id)
    assert.match(firstTools.id, /^ctxa_[a-f0-9]{64}$/)
    assert.equal(getArtifact(first, 'native_tools').id, getArtifact(reordered, 'native_tools').id)
    assert.deepEqual(
      firstTools.payload.kind === 'tools' ? firstTools.payload.tools.map((tool) => tool.name) : [],
      ['zeta_lookup', 'alpha_search'],
    )
    assert.deepEqual(
      reorderedTools.payload.kind === 'tools'
        ? reorderedTools.payload.tools.map((tool) => tool.name)
        : [],
      ['alpha_search', 'zeta_lookup'],
    )
    assert.deepEqual(firstTools.provenance.sourceIds, [...firstTools.provenance.sourceIds].sort())
  })

  test('discriminates every non-empty request family and declares intentional policy metadata', () => {
    const activeTools = [createTool('search_tools')]
    const input = createInput(activeTools, ['web_search'])
    const fields = buildThreadInteractionRequestFields({
      activeTools,
      context: input.context,
      nativeTools: ['web_search'],
      overrides: {
        maxOutputTokens: 0,
        model: 'request-artifact-model',
        provider: 'openai',
        temperature: 0,
      },
    })
    const artifacts = buildRequestContextArtifacts(fields, input)

    assert.deepEqual(
      artifacts.map((artifact) => artifact.payload.kind),
      ['tools', 'native_tools', 'request_options', 'metadata'],
    )
    assert.deepEqual(
      artifacts.map((artifact) => artifact.layer),
      ['tool_context', 'tool_context', 'session_metadata', 'session_metadata'],
    )
    assert.ok(artifacts.every((artifact) => artifact.visibility === 'request'))
    assert.ok(artifacts.every((artifact) => artifact.metadataStatus === 'declared'))
    assert.ok(artifacts.every((artifact) => artifact.authority === 'agent_configuration'))
    assert.ok(artifacts.every((artifact) => artifact.capturedAt === input.context.run.createdAt))
    assert.ok(artifacts.every((artifact) => artifact.provenance.sourceType === 'runtime'))
    assert.ok(artifacts.every((artifact) => artifact.expiresAt === null))
    assert.ok(artifacts.every((artifact) => artifact.transformation.kind === 'none'))

    const tools = getArtifact(artifacts, 'tools')
    const nativeTools = getArtifact(artifacts, 'native_tools')
    const options = getArtifact(artifacts, 'request_options')
    const metadata = getArtifact(artifacts, 'metadata')

    assert.deepEqual(tools.payload.kind === 'tools' ? tools.payload.tools : [], fields.tools)
    assert.deepEqual(
      nativeTools.payload.kind === 'native_tools' ? nativeTools.payload.tools : [],
      fields.nativeTools,
    )
    assert.deepEqual(options.payload.kind === 'request_options' ? options.payload.options : {}, {
      allowParallelToolCalls: true,
      maxOutputTokens: 0,
      model: 'request-artifact-model',
      modelAlias: undefined,
      provider: 'openai',
      reasoning: undefined,
      temperature: 0,
      toolChoice: 'auto',
    })
    assert.deepEqual(
      metadata.payload.kind === 'metadata' ? metadata.payload.metadata : {},
      fields.metadata,
    )
    assert.deepEqual(
      artifacts.map((artifact) => artifact.requirement),
      ['mandatory', 'mandatory', 'mandatory', 'preferred'],
    )
    assert.deepEqual(
      artifacts.map((artifact) => artifact.volatility),
      ['stable', 'stable', 'volatile', 'volatile'],
    )
    assert.deepEqual(
      artifacts.map((artifact) => artifact.sensitivity),
      ['restricted', 'private', 'private', 'restricted'],
    )
  })

  test('omits empty families, preserves explicit undefined options, and never captures AbortSignal', () => {
    const input = createInput()

    assert.deepEqual(buildRequestContextArtifacts({}, input), [])

    const abortSignal = new AbortController().signal
    const fields = {
      abortSignal,
      model: undefined,
    } as ThreadInteractionRequestFields & { abortSignal: AbortSignal }
    const artifacts = buildRequestContextArtifacts(fields, input)
    const options = getArtifact(artifacts, 'request_options')

    assert.equal(artifacts.length, 1)
    assert.equal(options.payload.kind, 'request_options')
    if (options.payload.kind === 'request_options') {
      assert.equal(Object.hasOwn(options.payload.options, 'model'), true)
      assert.equal(options.payload.options.model, undefined)
      assert.equal(Object.hasOwn(options.payload.options, 'abortSignal'), false)
    }
    assert.doesNotMatch(JSON.stringify(options), /abortSignal/)
  })

  test('does not copy secrets, raw messages, or file bodies into artifact metadata', () => {
    const rawMessage = 'RAW_MESSAGE_DO_NOT_COPY'
    const rawFileBody = 'RAW_FILE_BODY_DO_NOT_COPY'
    const secret = 'sk_request_artifact_do_not_copy'
    const activeTools = [createTool('safe_lookup')]
    const input = createInput(activeTools)
    const context = {
      ...input.context,
      run: {
        ...input.context.run,
        configSnapshot: {
          authorization: `Bearer ${secret}`,
          model: 'safe-model',
        },
      },
      visibleFiles: [
        {
          dataUrl: null,
          fileId: 'fil_request_artifact_security',
          messageId: null,
          mimeType: 'text/plain',
          originalFilename: 'security.txt',
          textContent: rawFileBody,
        },
      ],
      visibleMessages: [createVisibleMessage({ text: rawMessage })],
    } as ContextContributorInput['context']
    const securityInput: ContextContributorInput = { ...input, context }
    const fields = buildThreadInteractionRequestFields({
      activeTools,
      context,
      nativeTools: [],
      overrides: {},
    })
    const artifacts = buildRequestContextArtifacts(fields, securityInput)
    const metadataJson = JSON.stringify(artifacts.map(artifactMetadataOnly))

    assert.doesNotMatch(metadataJson, new RegExp(secret))
    assert.doesNotMatch(metadataJson, new RegExp(rawMessage))
    assert.doesNotMatch(metadataJson, new RegExp(rawFileBody))
    assert.deepEqual(scanContextSecurity(artifacts.map(artifactMetadataOnly), 'manifest'), [])
  })

  test('is observational only and has no impact on request field construction', () => {
    const activeTools = Object.freeze([
      createTool('search_tools'),
      createTool('docs__search', 'mcp'),
    ])
    const nativeTools = Object.freeze(['web_search'] as const)
    const overrides = Object.freeze({ model: 'unchanged-model', temperature: 0 })
    const input: ContextContributorInput = {
      ...createInput(activeTools, nativeTools),
      mcpMode: 'code',
      overrides,
    }
    const buildFields = (): ThreadInteractionRequestFields =>
      buildThreadInteractionRequestFields({
        activeTools: [...activeTools],
        context: input.context,
        mcpMode: input.mcpMode,
        nativeTools: [...nativeTools],
        overrides,
      })
    const before = buildFields()
    const inputNames = activeTools.map((tool) => tool.name)

    buildRequestContextArtifacts(before, input)

    assert.deepEqual(buildFields(), before)
    assert.deepEqual(
      activeTools.map((tool) => tool.name),
      inputNames,
    )
    assert.deepEqual(nativeTools, ['web_search'])
    assert.deepEqual(overrides, { model: 'unchanged-model', temperature: 0 })
  })
})
