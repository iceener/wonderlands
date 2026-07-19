import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import type { AssembleThreadInteractionRequestResult } from '../src/application/interactions/assemble-thread-interaction-request'
import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import type { ThreadContextData } from '../src/application/interactions/context-bundle'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import {
  createContext,
  createDelegatedItems,
  createMessageItem,
  createObservation,
  createReflection,
  createTool,
  createVisibleMessage,
  gardenContextFixture,
  mcpCatalogFixture,
  summaryFixture,
  textAndImageFilesFixture,
} from './fixtures/context/context-assembly'

const layerContract = [
  ['system_prompt', 'stable'],
  ['agent_profile', 'stable'],
  ['capability_guidance', 'stable'],
  ['garden_context', 'stable'],
  ['attachment_ref_rules', 'stable'],
  ['tool_context', 'stable'],
  ['session_metadata', 'stable'],
  ['summary_memory', 'stable'],
  ['run_local_memory', 'stable'],
  ['run_local_memory', 'stable'],
  ['run_transcript', 'volatile'],
  ['visible_message_history', 'volatile'],
  ['attachment_ref_context', 'volatile'],
  ['file_context', 'volatile'],
  ['pending_waits', 'volatile'],
] as const

interface AssembleOptions {
  activeTools?: ToolSpec[]
  mcpCatalog?: Parameters<typeof assembleThreadInteractionRequest>[0]['mcpCatalog']
  mcpMode?: Parameters<typeof assembleThreadInteractionRequest>[0]['mcpMode']
  overrides?: Parameters<typeof assembleThreadInteractionRequest>[0]['overrides']
}

const assemble = (
  context: ThreadContextData,
  options: AssembleOptions = {},
): AssembleThreadInteractionRequestResult =>
  assembleThreadInteractionRequest({
    activeTools: options.activeTools ?? [],
    context,
    mcpCatalog: options.mcpCatalog,
    mcpMode: options.mcpMode,
    nativeTools: [],
    overrides: options.overrides ?? {},
  })

// Provider/model routing is intentionally omitted. This keeps these request
// characterizations at the provider-neutral interaction boundary while retaining
// every field that changes context or tool budgeting.
const characterizeRequest = (result: AssembleThreadInteractionRequestResult) => ({
  ...(result.request.allowParallelToolCalls === undefined
    ? {}
    : { allowParallelToolCalls: result.request.allowParallelToolCalls }),
  ...(result.request.maxOutputTokens === undefined
    ? {}
    : { maxOutputTokens: result.request.maxOutputTokens }),
  messages: result.request.messages,
  metadata: result.request.metadata,
  ...(result.request.nativeTools === undefined ? {} : { nativeTools: result.request.nativeTools }),
  ...(result.request.toolChoice === undefined ? {} : { toolChoice: result.request.toolChoice }),
  ...(result.request.tools === undefined ? {} : { tools: result.request.tools }),
})

const characterizeBudget = (result: AssembleThreadInteractionRequestResult) => ({
  calibratedEstimatedInputTokens: result.bundle.budget.calibratedEstimatedInputTokens,
  estimatorVersion: result.bundle.budget.estimatorVersion,
  nonEmptyLayerReports: result.bundle.budget.layerReports.filter(
    (report) => report.messageCount > 0,
  ),
  rawEstimatedInputTokens: result.bundle.budget.rawEstimatedInputTokens,
  requestOverheadTokens: result.bundle.budget.requestOverheadTokens,
  reservedOutputTokens: result.bundle.budget.reservedOutputTokens,
  stablePrefixHash: result.bundle.budget.stablePrefixHash,
  stablePrefixTokens: result.bundle.budget.stablePrefixTokens,
  volatileSuffixTokens: result.bundle.budget.volatileSuffixTokens,
})

const expectedToolDefinition = (name: string) => ({
  description: `Fixture definition for ${name}.`,
  kind: 'function',
  name,
  parameters: {
    additionalProperties: false,
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
    type: 'object',
  },
  strict: true,
})

const plainResult = () =>
  assemble(
    createContext({
      visibleMessages: [
        createVisibleMessage({ sequence: 1, text: 'Hello, Quinn.' }),
        createVisibleMessage({
          authorKind: 'assistant',
          id: 'msg_visible_2',
          sequence: 2,
          text: 'Ready to characterize.',
        }),
      ],
    }),
  )

const summaryTailResult = () =>
  assemble(
    createContext({
      items: [
        createMessageItem({
          id: 'itm_live_tail_characterization',
          role: 'user',
          sequence: 9,
          text: 'Now inspect the live tail.',
        }),
      ],
      summary: summaryFixture,
      visibleMessages: [
        createVisibleMessage({
          id: 'msg_summarized_characterization',
          sequence: 1,
          text: 'This message is already represented by the summary.',
        }),
      ],
    }),
  )

const memoryResult = () =>
  assemble(
    createContext({
      activeReflection: createReflection(),
      observations: [createObservation()],
    }),
  )

const filesResult = () => {
  const base = createContext()

  return assemble(
    createContext({
      run: {
        ...base.run,
        configSnapshot: { provider: 'openai' },
      },
      visibleFiles: textAndImageFilesFixture,
    }),
  )
}

const gardenResult = () =>
  assemble(createContext({ gardenContext: gardenContextFixture }), {
    activeTools: [createTool('get_garden_context')],
  })

const directMcpResult = () =>
  assemble(createContext(), {
    activeTools: [createTool('docs__search', 'mcp')],
    mcpMode: 'direct',
  })

const codeMcpResult = () =>
  assemble(createContext(), {
    activeTools: [
      createTool('search_tools'),
      createTool('get_tools'),
      createTool('execute'),
      createTool('docs__search', 'mcp'),
    ],
    mcpCatalog: mcpCatalogFixture,
    mcpMode: 'code',
  })

const delegatedResult = () => assemble(createContext({ items: createDelegatedItems() }))

describe('context assembly layer and fallback contract', () => {
  test('keeps the exact 15-layer order, volatility, duplicate memory slots, and empty reservations', () => {
    const result = assemble(createContext())

    assert.deepEqual(
      result.bundle.layers.map((layer) => [layer.kind, layer.volatility]),
      layerContract,
    )
    assert.deepEqual(
      result.bundle.layers.map((layer) => layer.messages.length),
      Array.from({ length: 15 }, () => 0),
    )
    assert.deepEqual(result.bundle.budget.layerReports, [
      ...layerContract.map(([kind, volatility]) => ({
        estimatedInputTokens: 0,
        kind,
        messageCount: 0,
        volatility,
      })),
    ])
  })

  test('falls back to the run task without attributing fallback tokens to a layer', () => {
    const result = assemble(createContext())

    assert.deepEqual(characterizeRequest(result), {
      messages: [
        {
          content: [{ text: 'Run the characterization task', type: 'text' }],
          role: 'user',
        },
      ],
      metadata: {
        runId: 'run_context_characterization',
        sessionId: 'ses_context_characterization',
        tenantId: 'ten_context_characterization',
        threadId: 'thr_context_characterization',
      },
    })
    assert.deepEqual(characterizeBudget(result), {
      calibratedEstimatedInputTokens: null,
      estimatorVersion: 'rough_v1',
      nonEmptyLayerReports: [],
      rawEstimatedInputTokens: 0,
      requestOverheadTokens: 0,
      reservedOutputTokens: null,
      stablePrefixHash: 'f05bd778246815704bfa19a6597c343eac8223db274c84b80c023b9e3b0dd192',
      stablePrefixTokens: 0,
      volatileSuffixTokens: 0,
    })
  })
})

describe('representative provider-neutral request structures', () => {
  test('assembles a plain conversation from visible message history', () => {
    assert.deepEqual(characterizeRequest(plainResult()), {
      messages: [
        {
          content: [{ text: 'Hello, Quinn.', type: 'text' }],
          role: 'user',
        },
        {
          content: [{ text: 'Ready to characterize.', type: 'text' }],
          role: 'assistant',
        },
      ],
      metadata: {
        runId: 'run_context_characterization',
        sessionId: 'ses_context_characterization',
        tenantId: 'ten_context_characterization',
        threadId: 'thr_context_characterization',
      },
    })
  })

  test('places a summary before its item-backed live tail and suppresses summarized visible history', () => {
    assert.deepEqual(characterizeRequest(summaryTailResult()).messages, [
      {
        content: [
          {
            text: 'Earlier conversation established a behavior-preserving migration plan.',
            type: 'text',
          },
        ],
        role: 'developer',
      },
      {
        content: [{ text: 'Now inspect the live tail.', type: 'text' }],
        role: 'user',
      },
    ])
  })

  test('places reflection before observations in the two stable run-local-memory layers', () => {
    assert.deepEqual(characterizeRequest(memoryResult()).messages, [
      {
        content: [
          {
            text:
              'Compressed reflection from earlier run-local observations:\n\n' +
              'Keep the migration behavior-first and preserve request ordering.',
            type: 'text',
          },
        ],
        role: 'developer',
      },
      {
        content: [
          {
            text:
              'Durable observations from earlier sealed main-thread context:\n\n' +
              'Observation 1:\nThe caller expects deterministic layer order.\n\n' +
              'Observation 2:\nVolatile transcript changes must not invalidate the stable prefix.',
            type: 'text',
          },
        ],
        role: 'developer',
      },
    ])
  })

  test('emits text then image content in the volatile file-context layer', () => {
    assert.deepEqual(characterizeRequest(filesResult()).messages, [
      {
        content: [
          {
            text: 'Attached file: notes.txt\nMIME: text/plain\n\nLayer order matters.',
            type: 'text',
          },
        ],
        role: 'developer',
      },
      {
        content: [
          { text: 'Attached image: diagram.png', type: 'text' },
          {
            mimeType: 'image/png',
            type: 'image_url',
            url: 'data:image/png;base64,AQID',
          },
        ],
        role: 'user',
      },
    ])
  })

  test('keeps Garden guidance stable and includes the structured Garden tool request', () => {
    const request = characterizeRequest(gardenResult())
    const gardenMessage = request.messages[0]

    assert.equal(gardenMessage?.role, 'developer')
    assert.equal(gardenMessage?.content[0]?.type, 'text')
    assert.equal(
      gardenMessage?.content[0]?.type === 'text' &&
        gardenMessage.content[0].text.startsWith(
          'Garden context:\n\nGarden sites are file-first websites built from the current account workspace under /vault.',
        ),
      true,
    )
    assert.equal(
      gardenMessage?.content[0]?.type === 'text' &&
        gardenMessage.content[0].text.endsWith(
          '- quinn (default, active, preferred) -> /vault/quinn\n\nIf you need structured details, call get_garden_context.',
        ),
      true,
    )
    assert.deepEqual(request.tools, [expectedToolDefinition('get_garden_context')])
    assert.equal(request.allowParallelToolCalls, true)
    assert.equal(request.toolChoice, 'auto')
  })

  test('switches MCP direct schemas to stable code-mode inventory and discovery tooling', () => {
    const direct = characterizeRequest(directMcpResult())
    const code = characterizeRequest(codeMcpResult())

    assert.deepEqual(direct.tools, [expectedToolDefinition('docs__search')])
    assert.deepEqual(direct.messages, [
      {
        content: [{ text: 'Run the characterization task', type: 'text' }],
        role: 'user',
      },
    ])
    assert.deepEqual(code.tools, [
      expectedToolDefinition('search_tools'),
      expectedToolDefinition('get_tools'),
      expectedToolDefinition('execute'),
    ])
    assert.equal(code.messages.length, 1)
    assert.equal(code.messages[0]?.role, 'developer')
    assert.equal(code.messages[0]?.content[0]?.type, 'text')
    assert.equal(
      code.messages[0]?.content[0]?.type === 'text' &&
        code.messages[0].content[0].text.startsWith(
          'MCP code mode is enabled.\nDirect MCP function schemas are hidden from the model in this mode.',
        ),
      true,
    )
    assert.equal(
      code.messages[0]?.content[0]?.type === 'text' &&
        code.messages[0].content[0].text.endsWith('Active MCP inventory:\n- docs: search'),
      true,
    )
    assert.deepEqual(direct.metadata, {
      mcpActiveToolCount: '1',
      runId: 'run_context_characterization',
      sessionId: 'ses_context_characterization',
      tenantId: 'ten_context_characterization',
      threadId: 'thr_context_characterization',
    })
    assert.deepEqual(code.metadata, direct.metadata)
  })

  test('replays delegated call/result items and compacts provider-specific child output', () => {
    assert.deepEqual(characterizeRequest(delegatedResult()).messages, [
      {
        content: [
          {
            argumentsJson: '{"agentAlias":"researcher","task":"Check the migration"}',
            callId: 'call_delegate_characterization',
            name: 'delegate_to_agent',
            type: 'function_call',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            callId: 'call_delegate_characterization',
            isError: false,
            name: 'delegate_to_agent',
            outputJson: '{"kind":"completed","summary":"The migration is ready."}',
            type: 'function_result',
          },
        ],
        role: 'tool',
      },
    ])
  })
})

describe('representative budget and stable-prefix structures', () => {
  test.each([
    {
      expected: {
        calibratedEstimatedInputTokens: null,
        estimatorVersion: 'rough_v1',
        nonEmptyLayerReports: [
          {
            estimatedInputTokens: 14,
            kind: 'visible_message_history',
            messageCount: 2,
            volatility: 'volatile',
          },
        ],
        rawEstimatedInputTokens: 14,
        requestOverheadTokens: 0,
        reservedOutputTokens: null,
        stablePrefixHash: 'f05bd778246815704bfa19a6597c343eac8223db274c84b80c023b9e3b0dd192',
        stablePrefixTokens: 0,
        volatileSuffixTokens: 14,
      },
      name: 'plain conversation',
      result: plainResult,
    },
    {
      expected: {
        calibratedEstimatedInputTokens: null,
        estimatorVersion: 'rough_v1',
        nonEmptyLayerReports: [
          {
            estimatedInputTokens: 21,
            kind: 'summary_memory',
            messageCount: 1,
            volatility: 'stable',
          },
          {
            estimatedInputTokens: 8,
            kind: 'run_transcript',
            messageCount: 1,
            volatility: 'volatile',
          },
        ],
        rawEstimatedInputTokens: 29,
        requestOverheadTokens: 0,
        reservedOutputTokens: null,
        stablePrefixHash: '0e1b5a17f283505da51df6ccf89f835550b916603307b462a044b192a6e0e4ec',
        stablePrefixTokens: 21,
        volatileSuffixTokens: 8,
      },
      name: 'summary plus live tail',
      result: summaryTailResult,
    },
    {
      expected: {
        calibratedEstimatedInputTokens: null,
        estimatorVersion: 'rough_v1',
        nonEmptyLayerReports: [
          {
            estimatedInputTokens: 34,
            kind: 'run_local_memory',
            messageCount: 1,
            volatility: 'stable',
          },
          {
            estimatedInputTokens: 55,
            kind: 'run_local_memory',
            messageCount: 1,
            volatility: 'stable',
          },
        ],
        rawEstimatedInputTokens: 89,
        requestOverheadTokens: 0,
        reservedOutputTokens: null,
        stablePrefixHash: '0c395cf6857aaab8c0d2621564253f41675583cadea649dda78891932677665d',
        stablePrefixTokens: 89,
        volatileSuffixTokens: 0,
      },
      name: 'reflection plus observations',
      result: memoryResult,
    },
    {
      expected: {
        calibratedEstimatedInputTokens: null,
        estimatorVersion: 'rough_v1',
        nonEmptyLayerReports: [
          {
            estimatedInputTokens: 539,
            kind: 'file_context',
            messageCount: 2,
            volatility: 'volatile',
          },
        ],
        rawEstimatedInputTokens: 539,
        requestOverheadTokens: 0,
        reservedOutputTokens: null,
        stablePrefixHash: 'f05bd778246815704bfa19a6597c343eac8223db274c84b80c023b9e3b0dd192',
        stablePrefixTokens: 0,
        volatileSuffixTokens: 539,
      },
      name: 'text and image file context',
      result: filesResult,
    },
    {
      expected: {
        calibratedEstimatedInputTokens: null,
        estimatorVersion: 'rough_v1',
        nonEmptyLayerReports: [
          {
            estimatedInputTokens: 413,
            kind: 'garden_context',
            messageCount: 1,
            volatility: 'stable',
          },
        ],
        rawEstimatedInputTokens: 482,
        requestOverheadTokens: 69,
        reservedOutputTokens: null,
        stablePrefixHash: '5cea480bc4706e851e285d16f7a365cc6e8387bc7a8eef312397a5f145c01f7c',
        stablePrefixTokens: 482,
        volatileSuffixTokens: 0,
      },
      name: 'Garden context',
      result: gardenResult,
    },
    {
      expected: {
        calibratedEstimatedInputTokens: null,
        estimatorVersion: 'rough_v1',
        nonEmptyLayerReports: [],
        rawEstimatedInputTokens: 66,
        requestOverheadTokens: 66,
        reservedOutputTokens: null,
        stablePrefixHash: '672bd049a9eefb1f696594c56b287ae0011936218ea407c4b752488c0f0b85c6',
        stablePrefixTokens: 66,
        volatileSuffixTokens: 0,
      },
      name: 'MCP direct mode',
      result: directMcpResult,
    },
    {
      expected: {
        calibratedEstimatedInputTokens: null,
        estimatorVersion: 'rough_v1',
        nonEmptyLayerReports: [
          {
            estimatedInputTokens: 400,
            kind: 'tool_context',
            messageCount: 1,
            volatility: 'stable',
          },
        ],
        rawEstimatedInputTokens: 577,
        requestOverheadTokens: 177,
        reservedOutputTokens: null,
        stablePrefixHash: '2dfc47c9ea44dc937f406e373d320744fb02040b45b9f4eb9d1d3c568536162d',
        stablePrefixTokens: 577,
        volatileSuffixTokens: 0,
      },
      name: 'MCP code mode',
      result: codeMcpResult,
    },
    {
      expected: {
        calibratedEstimatedInputTokens: null,
        estimatorVersion: 'rough_v1',
        nonEmptyLayerReports: [
          {
            estimatedInputTokens: 42,
            kind: 'run_transcript',
            messageCount: 2,
            volatility: 'volatile',
          },
        ],
        rawEstimatedInputTokens: 42,
        requestOverheadTokens: 0,
        reservedOutputTokens: null,
        stablePrefixHash: 'f05bd778246815704bfa19a6597c343eac8223db274c84b80c023b9e3b0dd192',
        stablePrefixTokens: 0,
        volatileSuffixTokens: 42,
      },
      name: 'delegated call and result',
      result: delegatedResult,
    },
  ])('freezes the $name budget', ({ expected, result }) => {
    assert.deepEqual(characterizeBudget(result()), expected)
  })

  test('hashes stable layers and tool overhead but ignores volatile suffix and output reservation', () => {
    const empty = assemble(createContext())
    const plain = plainResult()
    const files = filesResult()
    const delegated = delegatedResult()
    const summary = summaryTailResult()
    const directMcp = directMcpResult()
    const reservedOutput = assemble(createContext(), {
      overrides: { maxOutputTokens: 777 },
    })

    assert.equal(empty.bundle.budget.stablePrefixHash, plain.bundle.budget.stablePrefixHash)
    assert.equal(empty.bundle.budget.stablePrefixHash, files.bundle.budget.stablePrefixHash)
    assert.equal(empty.bundle.budget.stablePrefixHash, delegated.bundle.budget.stablePrefixHash)
    assert.equal(
      empty.bundle.budget.stablePrefixHash,
      reservedOutput.bundle.budget.stablePrefixHash,
    )
    assert.notEqual(empty.bundle.budget.stablePrefixHash, summary.bundle.budget.stablePrefixHash)
    assert.notEqual(empty.bundle.budget.stablePrefixHash, directMcp.bundle.budget.stablePrefixHash)
    assert.equal(reservedOutput.bundle.budget.reservedOutputTokens, 777)
  })
})
