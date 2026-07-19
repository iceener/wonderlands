import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildContextArtifacts,
  projectContextArtifactMessages,
} from '../src/application/context/artifacts'
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

  test('declares deterministic Garden provenance and projects strict artifacts to build output', () => {
    const input = createInput({
      context: createContext({ gardenContext: gardenContextFixture }),
    })
    const contributions = gardenContextContributor.build(input)
    const [artifact] = buildContextArtifacts([gardenContextContributor], input, {
      validationMode: 'strict',
    })
    const [repeat] = buildContextArtifacts([gardenContextContributor], input, {
      validationMode: 'strict',
    })

    assert.ok(artifact)
    assert.equal(artifact.id, repeat?.id)
    assert.deepEqual(projectContextArtifactMessages([artifact]), contributions)
    assert.deepEqual(
      {
        authority: artifact.authority,
        capturedAt: artifact.capturedAt,
        conflictKey: artifact.conflictKey,
        dedupeKey: artifact.dedupeKey,
        dependencies: artifact.dependencies,
        expiresAt: artifact.expiresAt,
        metadataStatus: artifact.metadataStatus,
        priority: artifact.priority,
        provenance: artifact.provenance,
        requirement: artifact.requirement,
        sensitivity: artifact.sensitivity,
        supersedes: artifact.supersedes,
        transformation: artifact.transformation,
        visibility: artifact.visibility,
      },
      {
        authority: 'agent_configuration',
        capturedAt: input.context.run.createdAt,
        conflictKey: null,
        dedupeKey: 'garden-context',
        dependencies: [],
        expiresAt: null,
        metadataStatus: 'declared',
        priority: 40,
        provenance: {
          createdByRunId: String(input.context.run.id),
          sourceIds: [
            '/vault/quinn',
            'gst_context_characterization',
            'quinn',
            'run_context_characterization',
          ],
          sourceType: 'garden',
          sourceVersion: null,
        },
        requirement: 'preferred',
        sensitivity: 'private',
        supersedes: [],
        transformation: { kind: 'none' },
        visibility: 'model',
      },
    )
  })

  test('declares an optional model-visible artifact when no Garden is available', () => {
    const input = createInput()
    const [artifact] = buildContextArtifacts([gardenContextContributor], input, {
      validationMode: 'strict',
    })

    assert.equal(artifact?.requirement, 'optional')
    assert.equal(artifact?.metadataStatus, 'declared')
    assert.deepEqual(artifact?.provenance.sourceIds, [String(input.context.run.id)])
    assert.deepEqual(projectContextArtifactMessages(artifact ? [artifact] : []), [
      {
        kind: 'garden_context',
        messages: [],
        volatility: 'stable',
      },
    ])
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

  test('declares sorted code-mode integration provenance and preserves the build projection', () => {
    const input = createInput({ mcpCatalog: mcpCatalogFixture, mcpMode: 'code' })
    const contributions = mcpToolContextContributor.build(input)
    const [artifact] = buildContextArtifacts([mcpToolContextContributor], input, {
      validationMode: 'strict',
    })
    const [repeat] = buildContextArtifacts([mcpToolContextContributor], input, {
      validationMode: 'strict',
    })

    assert.ok(artifact)
    assert.equal(artifact.id, repeat?.id)
    assert.deepEqual(projectContextArtifactMessages([artifact]), contributions)
    assert.equal(artifact.metadataStatus, 'declared')
    assert.equal(artifact.authority, 'authoritative_integration')
    assert.equal(artifact.capturedAt, input.context.run.createdAt)
    assert.equal(artifact.dedupeKey, 'mcp-tool-context:code')
    assert.equal(artifact.priority, 60)
    assert.equal(artifact.requirement, 'preferred')
    assert.equal(artifact.sensitivity, 'private')
    assert.equal(artifact.visibility, 'model')
    assert.deepEqual(artifact.provenance, {
      createdByRunId: String(input.context.run.id),
      sourceIds: ['docs__search', 'run_context_characterization', 'srv_docs_characterization'],
      sourceType: 'integration',
      sourceVersion: null,
    })
    assert.deepEqual(artifact.provenance.sourceIds, [...artifact.provenance.sourceIds].sort())
  })

  test('gives the direct-mode empty layer complete optional runtime metadata', () => {
    const input = createInput({
      mcpCatalog: mcpCatalogFixture,
      mcpMode: 'direct',
    })
    const [artifact] = buildContextArtifacts([mcpToolContextContributor], input, {
      validationMode: 'strict',
    })

    assert.ok(artifact)
    assert.equal(artifact.metadataStatus, 'declared')
    assert.equal(artifact.authority, 'agent_configuration')
    assert.equal(artifact.dedupeKey, 'mcp-tool-context:direct')
    assert.equal(artifact.requirement, 'optional')
    assert.equal(artifact.visibility, 'model')
    assert.deepEqual(artifact.provenance, {
      createdByRunId: String(input.context.run.id),
      sourceIds: [String(input.context.run.id)],
      sourceType: 'runtime',
      sourceVersion: null,
    })
    assert.deepEqual(projectContextArtifactMessages([artifact]), [
      {
        kind: 'tool_context',
        messages: [],
        volatility: 'stable',
      },
    ])
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
  buildContextArtifacts([gardenContextContributor, mcpToolContextContributor], input, {
    validationMode: 'strict',
  })

  assert.equal(JSON.stringify(input), before)
})
