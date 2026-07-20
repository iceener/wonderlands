import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildThreadInteractionRequestFields,
  resolveRequestedMaxOutputTokens,
  resolveRequestedModel,
  resolveRequestedModelAlias,
  resolveRequestedProvider,
  resolveRequestedReasoning,
  resolveRequestedTemperature,
  toInteractionRequestMetadata,
  toSortedActiveMcpToolNames,
} from '../src/application/context/request-fields'
import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import { asToolProfileId } from '../src/shared/ids'
import { createContext, createTool } from './fixtures/context/context-assembly'

const withConfig = (configSnapshot: Record<string, unknown>) => {
  const context = createContext()

  return {
    ...context,
    run: {
      ...context.run,
      configSnapshot,
    },
  }
}

const selectRequestFields = (
  request: ReturnType<typeof assembleThreadInteractionRequest>['request'],
) => ({
  ...(request.allowParallelToolCalls === undefined
    ? {}
    : { allowParallelToolCalls: request.allowParallelToolCalls }),
  maxOutputTokens: request.maxOutputTokens,
  metadata: request.metadata,
  model: request.model,
  modelAlias: request.modelAlias,
  ...(request.nativeTools === undefined ? {} : { nativeTools: request.nativeTools }),
  provider: request.provider,
  reasoning: request.reasoning,
  temperature: request.temperature,
  ...(request.toolChoice === undefined ? {} : { toolChoice: request.toolChoice }),
  ...(request.tools === undefined ? {} : { tools: request.tools }),
})

describe('request routing fields', () => {
  test('applies override, snapshot, and invalid-value precedence', () => {
    const configuredReasoning = { effort: 'xhigh', summary: 'detailed' }
    const invalidReasoning = [null, 'high', {}, { effort: 'invalid' }, { effort: 'max' }]
    const scenarios = [
      {
        context: withConfig({
          maxOutputTokens: 8_192,
          model: 'configured-model',
          modelAlias: 'configured-alias',
          provider: 'openai',
          reasoning: { effort: 'medium' },
          temperature: 0.8,
        }),
        expected: {
          maxOutputTokens: 0,
          model: 'override-model',
          modelAlias: 'override-alias',
          provider: 'google',
          reasoning: { effort: 'high', summary: 'concise' },
          temperature: 0,
        },
        overrides: {
          maxOutputTokens: 0,
          model: 'override-model',
          modelAlias: 'override-alias',
          provider: 'google' as const,
          reasoning: { effort: 'high' as const, summary: 'concise' as const },
          temperature: 0,
        },
      },
      {
        context: withConfig({
          maxOutputTokens: 4_096,
          model: 'configured-model',
          modelAlias: 'configured-alias',
          provider: 'openrouter',
          reasoning: configuredReasoning,
          temperature: 0.25,
        }),
        expected: {
          maxOutputTokens: 4_096,
          model: 'configured-model',
          modelAlias: 'configured-alias',
          provider: 'openrouter',
          reasoning: configuredReasoning,
          temperature: 0.25,
        },
        expectedReasoningReference: configuredReasoning,
        overrides: {},
      },
      ...invalidReasoning.map((reasoning) => ({
        context: withConfig({
          maxOutputTokens: '4096',
          model: '',
          modelAlias: 42,
          provider: 'unsupported',
          reasoning,
          temperature: '0.5',
        }),
        expected: {
          maxOutputTokens: undefined,
          model: undefined,
          modelAlias: undefined,
          provider: null,
          reasoning: undefined,
          temperature: undefined,
        },
        overrides: {},
      })),
    ]

    for (const { context, expected, expectedReasoningReference, overrides } of scenarios) {
      const resolvedReasoning = resolveRequestedReasoning(context, overrides)

      assert.deepEqual(
        {
          maxOutputTokens: resolveRequestedMaxOutputTokens(context, overrides),
          model: resolveRequestedModel(context, overrides),
          modelAlias: resolveRequestedModelAlias(context, overrides),
          provider: resolveRequestedProvider(context, overrides),
          reasoning: resolvedReasoning,
          temperature: resolveRequestedTemperature(context, overrides),
        },
        expected,
      )
      if (expectedReasoningReference) {
        assert.strictEqual(resolvedReasoning, expectedReasoningReference)
      }
    }
  })
})
describe('request metadata and fallback', () => {
  test('sorts active MCP names without mutating input and emits deterministic filtered metadata', () => {
    const tools = Object.freeze([
      createTool('zeta__lookup', 'mcp'),
      createTool('native_lookup'),
      createTool('alpha__read', 'mcp'),
      createTool('alpha__read', 'mcp'),
    ])
    const originalNames = tools.map((tool) => tool.name)
    const context = createContext()
    const run = {
      ...context.run,
      toolProfileId: asToolProfileId('tpf_request_fields'),
      workspaceRef: 'workspace/request-fields',
    }

    const names = toSortedActiveMcpToolNames(tools)

    assert.deepEqual(names, ['alpha__read', 'alpha__read', 'zeta__lookup'])
    assert.deepEqual(
      tools.map((tool) => tool.name),
      originalNames,
    )
    assert.deepEqual(toInteractionRequestMetadata(run, names), {
      mcpActiveToolCount: '3',
      runId: 'run_context_characterization',
      sessionId: 'ses_context_characterization',
      tenantId: 'ten_context_characterization',
      threadId: 'thr_context_characterization',
      toolProfileId: 'tpf_request_fields',
      workspaceRef: 'workspace/request-fields',
    })
    assert.deepEqual(toInteractionRequestMetadata(context.run, []), {
      runId: 'run_context_characterization',
      sessionId: 'ses_context_characterization',
      tenantId: 'ten_context_characterization',
      threadId: 'thr_context_characterization',
    })
  })
})

test('combined request fields delegate tooling and match the current assembler shape', () => {
  const context = withConfig({
    maxOutputTokens: 2_048,
    model: 'configured-model',
    modelAlias: 'configured-alias',
    provider: 'openai',
    reasoning: { effort: 'low' },
    temperature: 0.4,
  })
  const activeTools: readonly ToolSpec[] = Object.freeze([
    createTool('search_tools'),
    createTool('docs__search', 'mcp'),
  ])
  const nativeTools = Object.freeze(['web_search'] as const)
  const overrides = Object.freeze({ model: 'override-model' })

  const fields = buildThreadInteractionRequestFields({
    activeTools,
    context,
    mcpMode: 'code',
    nativeTools,
    overrides,
  })
  const assembled = assembleThreadInteractionRequest({
    activeTools: [...activeTools],
    context,
    mcpMode: 'code',
    nativeTools: [...nativeTools],
    overrides,
  })

  assert.deepEqual(fields, selectRequestFields(assembled.request))
  assert.deepEqual(
    activeTools.map((tool) => tool.name),
    ['search_tools', 'docs__search'],
  )
  assert.deepEqual(nativeTools, ['web_search'])
  assert.deepEqual(overrides, { model: 'override-model' })
  assert.deepEqual(
    fields.tools?.map((tool) => tool.name),
    ['search_tools'],
  )
  assert.deepEqual(fields.nativeTools, ['web_search'])
})
