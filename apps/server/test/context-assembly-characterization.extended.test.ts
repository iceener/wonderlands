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
