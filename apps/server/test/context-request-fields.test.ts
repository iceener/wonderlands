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
  toFallbackTaskMessages,
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
  test('prefers every provided override over the run config snapshot, including numeric zero', () => {
    const context = withConfig({
      maxOutputTokens: 8_192,
      model: 'configured-model',
      modelAlias: 'configured-alias',
      provider: 'openai',
      reasoning: { effort: 'medium' },
      temperature: 0.8,
    })
    const overrides = {
      maxOutputTokens: 0,
      model: 'override-model',
      modelAlias: 'override-alias',
      provider: 'google' as const,
      reasoning: { effort: 'high' as const, summary: 'concise' as const },
      temperature: 0,
    }

    assert.equal(resolveRequestedProvider(context, overrides), 'google')
    assert.equal(resolveRequestedModel(context, overrides), 'override-model')
    assert.equal(resolveRequestedModelAlias(context, overrides), 'override-alias')
    assert.deepEqual(resolveRequestedReasoning(context, overrides), {
      effort: 'high',
      summary: 'concise',
    })
    assert.equal(resolveRequestedMaxOutputTokens(context, overrides), 0)
    assert.equal(resolveRequestedTemperature(context, overrides), 0)
  })

  test('uses valid config snapshot values when overrides are absent', () => {
    const reasoning = { effort: 'xhigh', summary: 'detailed' }
    const context = withConfig({
      maxOutputTokens: 4_096,
      model: 'configured-model',
      modelAlias: 'configured-alias',
      provider: 'openrouter',
      reasoning,
      temperature: 0.25,
    })

    assert.equal(resolveRequestedProvider(context, {}), 'openrouter')
    assert.equal(resolveRequestedModel(context, {}), 'configured-model')
    assert.equal(resolveRequestedModelAlias(context, {}), 'configured-alias')
    assert.strictEqual(resolveRequestedReasoning(context, {}), reasoning)
    assert.equal(resolveRequestedMaxOutputTokens(context, {}), 4_096)
    assert.equal(resolveRequestedTemperature(context, {}), 0.25)
  })

  test('preserves defaults and the current reasoning snapshot whitelist for invalid values', () => {
    for (const reasoning of [null, 'high', {}, { effort: 'invalid' }, { effort: 'max' }]) {
      const context = withConfig({
        maxOutputTokens: '4096',
        model: '',
        modelAlias: 42,
        provider: 'unsupported',
        reasoning,
        temperature: '0.5',
      })

      assert.equal(resolveRequestedProvider(context, {}), null)
      assert.equal(resolveRequestedModel(context, {}), undefined)
      assert.equal(resolveRequestedModelAlias(context, {}), undefined)
      assert.equal(resolveRequestedReasoning(context, {}), undefined)
      assert.equal(resolveRequestedMaxOutputTokens(context, {}), undefined)
      assert.equal(resolveRequestedTemperature(context, {}), undefined)
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

  test('constructs a fresh fallback user message from the unchanged task', () => {
    const context = createContext()
    const run = Object.freeze({ ...context.run, configSnapshot: Object.freeze({}) })
    const immutableContext = Object.freeze({ ...context, run })

    const first = toFallbackTaskMessages(immutableContext)
    const second = toFallbackTaskMessages(immutableContext)

    assert.deepEqual(first, [
      {
        content: [{ text: 'Run the characterization task', type: 'text' }],
        role: 'user',
      },
    ])
    assert.deepEqual(second, first)
    assert.notStrictEqual(second, first)
    assert.equal(immutableContext.run.task, 'Run the characterization task')
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
