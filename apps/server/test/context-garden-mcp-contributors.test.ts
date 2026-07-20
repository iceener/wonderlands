import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildContextArtifacts,
  projectContextArtifactMessages,
} from '../src/application/context/artifacts'
import type { ContextContributorInput } from '../src/application/context/contracts'
import { gardenContextContributor } from '../src/application/context/contributors/garden-context'
import { mcpToolContextContributor } from '../src/application/context/contributors/mcp-tool-context'
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

describe('garden context contributor', () => {
  test('represents absent, read-only, and read-write Garden access', () => {
    const scenarios = [
      { expected: null, input: createInput() },
      {
        expected:
          'Sandbox vault access is read-only for this agent, so Garden edits cannot be written back from the sandbox.',
        input: createInput({
          activeTools: [createTool('execute')],
          context: createContext({
            gardenContext: {
              ...gardenContextFixture,
              sandbox: { enabled: true, vaultMode: 'read_only' },
            },
          }),
        }),
      },
      {
        expected:
          'Write generated files under /output/... and use outputs.writeBack to request changes back into /vault/.',
        input: createInput({
          activeTools: [createTool('execute')],
          context: createContext({
            gardenContext: {
              ...gardenContextFixture,
              sandbox: { enabled: true, vaultMode: 'read_write' },
            },
          }),
        }),
      },
    ]

    for (const { expected, input } of scenarios) {
      const [contribution] = gardenContextContributor.build(input)
      const text = contribution?.messages[0]?.content[0]

      if (expected === null) {
        assert.deepEqual(contribution?.messages, [])
      } else {
        assert.equal(text?.type, 'text')
        assert.equal(text?.type === 'text' && text.text.includes(expected), true)
      }
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
})

describe('MCP tool context contributor', () => {
  test('represents direct and code-mode MCP context', () => {
    const scenarios = [
      { expectedPrefix: null, input: createInput({ mcpMode: 'direct' }) },
      {
        expectedPrefix: 'MCP code mode is enabled.',
        input: createInput({ mcpCatalog: mcpCatalogFixture, mcpMode: 'code' }),
      },
    ]

    for (const { expectedPrefix, input } of scenarios) {
      const [contribution] = mcpToolContextContributor.build(input)
      const content = contribution?.messages[0]?.content[0]

      if (expectedPrefix === null) {
        assert.deepEqual(contribution?.messages, [])
      } else {
        assert.equal(content?.type, 'text')
        assert.equal(content?.type === 'text' && content.text.startsWith(expectedPrefix), true)
      }
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
})
