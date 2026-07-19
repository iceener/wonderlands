import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import type {
  ContextContribution,
  ContextContributorInput,
} from '../src/application/context/contracts'
import { gardenContextContributor } from '../src/application/context/contributors/garden-context'
import { mcpToolContextContributor } from '../src/application/context/contributors/mcp-tool-context'
import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import type { ThreadContextData } from '../src/application/interactions/context-bundle'
import type { McpCodeModeCatalog } from '../src/application/mcp/code-mode'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import {
  createContext,
  createTool,
  gardenContextFixture,
  mcpCatalogFixture,
} from './fixtures/context/context-assembly'

interface InputOptions {
  activeTools?: ToolSpec[]
  context?: ThreadContextData
  mcpCatalog?: McpCodeModeCatalog | null
  mcpMode?: ContextContributorInput['mcpMode']
}

const createInput = (options: InputOptions = {}): ContextContributorInput => ({
  activeTools: options.activeTools ?? [],
  context: options.context ?? createContext(),
  mcpCatalog: options.mcpCatalog ?? null,
  mcpMode: options.mcpMode ?? 'direct',
  nativeTools: [],
  overrides: {},
})

const legacyContribution = (
  input: ContextContributorInput,
  kind: ContextContribution['kind'],
): ContextContribution => {
  const result = assembleThreadInteractionRequest({
    activeTools: input.activeTools as ToolSpec[],
    context: input.context as ThreadContextData,
    mcpCatalog: input.mcpCatalog as McpCodeModeCatalog | null,
    mcpMode: input.mcpMode,
    nativeTools: [...input.nativeTools],
    overrides: input.overrides,
  })
  const layer = result.bundle.layers.find((candidate) => candidate.kind === kind)

  assert.ok(layer)

  return {
    kind: layer.kind,
    messages: layer.messages,
    volatility: layer.volatility,
  }
}

const freezeDeep = <T>(value: T): T => {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    !Object.isFrozen(value)
  ) {
    for (const nested of Object.values(value)) {
      freezeDeep(nested)
    }
    Object.freeze(value)
  }

  return value
}

describe('garden context contributor', () => {
  test('exports the current stable layer-four identity', () => {
    assert.equal(gardenContextContributor.id, 'garden-context')
    assert.equal(gardenContextContributor.order, 4)
  })

  test('matches legacy output across capability, access-mode, just-bash, and tool-hint conditions', () => {
    const sandboxContext = createContext({
      gardenContext: {
        ...gardenContextFixture,
        sandbox: {
          enabled: true,
          vaultMode: 'read_write',
        },
      },
    })
    const cases = [
      createInput(),
      createInput({ context: createContext({ gardenContext: gardenContextFixture }) }),
      createInput({
        activeTools: [createTool('files__fs_read')],
        context: sandboxContext,
      }),
      createInput({
        activeTools: [createTool('execute'), createTool('get_garden_context')],
        context: sandboxContext,
      }),
    ]

    for (const input of cases) {
      assert.deepEqual(gardenContextContributor.build(input), [
        legacyContribution(input, 'garden_context'),
      ])
    }
  })
})

describe('MCP tool context contributor', () => {
  test('exports the current stable layer-six identity', () => {
    assert.equal(mcpToolContextContributor.id, 'mcp-tool-context')
    assert.equal(mcpToolContextContributor.order, 6)
  })

  test('emits an empty stable layer and no prose in direct mode', () => {
    const input = createInput({
      activeTools: [createTool('docs__search', 'mcp')],
      mcpCatalog: mcpCatalogFixture,
      mcpMode: 'direct',
    })

    assert.deepEqual(mcpToolContextContributor.build(input), [
      {
        kind: 'tool_context',
        messages: [],
        volatility: 'stable',
      },
    ])
    assert.deepEqual(mcpToolContextContributor.build(input), [
      legacyContribution(input, 'tool_context'),
    ])
  })

  test('matches the legacy catalog and null-catalog default messages in code mode', () => {
    for (const input of [
      createInput({ mcpMode: 'code' }),
      createInput({ mcpCatalog: mcpCatalogFixture, mcpMode: 'code' }),
    ]) {
      assert.deepEqual(mcpToolContextContributor.build(input), [
        legacyContribution(input, 'tool_context'),
      ])
    }
  })
})

test('Garden and MCP contributors do not mutate deeply frozen inputs', () => {
  const input = freezeDeep(
    createInput({
      activeTools: [createTool('execute'), createTool('get_garden_context')],
      context: createContext({
        gardenContext: {
          ...gardenContextFixture,
          sandbox: {
            enabled: true,
            vaultMode: 'read_only',
          },
        },
      }),
      mcpCatalog: mcpCatalogFixture,
      mcpMode: 'code',
    }),
  )
  const before = JSON.stringify(input)

  gardenContextContributor.build(input)
  mcpToolContextContributor.build(input)

  assert.equal(JSON.stringify(input), before)
})
