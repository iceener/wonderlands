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
