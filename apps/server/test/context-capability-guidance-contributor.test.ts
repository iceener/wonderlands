import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildContextArtifacts,
  projectContextArtifactMessages,
} from '../src/application/context/artifacts'
import type { ContextContributorInput } from '../src/application/context/contracts'
import { capabilityGuidanceContributor } from '../src/application/context/contributors/capability-guidance'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import { createContext, createTool } from './fixtures/context/context-assembly'

const createInput = (activeTools: readonly ToolSpec[]): ContextContributorInput => ({
  activeTools,
  context: createContext(),
  mcpCatalog: null,
  mcpMode: 'direct',
  nativeTools: [],
  overrides: {},
})

const expectedContribution = (text?: string) => [
  {
    kind: 'capability_guidance' as const,
    messages: text
      ? [
          {
            content: [{ text, type: 'text' as const }],
            role: 'developer' as const,
          },
        ]
      : [],
    volatility: 'stable' as const,
  },
]

describe('capability guidance context contributor', () => {
  test('declares deterministic runtime provenance independent of active tool order', () => {
    const browse = createTool('browse')
    const execute = createTool('execute')
    const firstInput = createInput([execute, browse])
    const shuffledInput = createInput([browse, execute])
    const first = buildContextArtifacts([capabilityGuidanceContributor], firstInput, {
      validationMode: 'strict',
    })
    const shuffled = buildContextArtifacts([capabilityGuidanceContributor], shuffledInput, {
      validationMode: 'strict',
    })
    const artifact = first[0]

    assert.ok(artifact)
    assert.deepEqual(
      capabilityGuidanceContributor.build(firstInput),
      capabilityGuidanceContributor.build(shuffledInput),
    )
    assert.equal(artifact.id, shuffled[0]?.id)
    assert.equal(artifact.metadataStatus, 'declared')
    assert.equal(artifact.authority, 'agent_configuration')
    assert.equal(artifact.capturedAt, firstInput.context.run.createdAt)
    assert.equal(artifact.conflictKey, null)
    assert.equal(artifact.dedupeKey, 'capability-guidance')
    assert.equal(artifact.requirement, 'preferred')
    assert.equal(artifact.sensitivity, 'private')
    assert.equal(artifact.visibility, 'model')
    assert.equal(artifact.volatility, 'stable')
    assert.deepEqual(artifact.provenance, {
      createdByRunId: String(firstInput.context.run.id),
      sourceIds: ['tool:native:browse', 'tool:native:execute'],
      sourceType: 'runtime',
      sourceVersion: 'capability-guidance/v1',
    })
    assert.deepEqual(
      projectContextArtifactMessages(first),
      capabilityGuidanceContributor.build(firstInput),
    )
  })

  test('renders representative capability guidance combinations', () => {
    const browserLines = [
      'Capability guidance:',
      '',
      '- `browse` is available for live website interaction: navigation, clicks, form filling, DOM inspection, screenshots, PDFs, cookies, and browser-state capture.',
      '- Keep browser scripts short and focused. Return JSON-serializable results from the script instead of logging or printing large blobs.',
      '- Use browser jobs when the task requires a real page, live rendering, client-side JavaScript, or authenticated browser state.',
    ]
    const finalLine =
      '- Request screenshots, PDFs, HTML, cookies, or recordings only when they materially help the conversation. Those outputs become normal run attachments.'
    const scenarios = [
      {
        expected: [
          ...browserLines,
          '- Browser jobs do not replace workspace or shell tools. Use them only when a live browser is actually needed.',
          finalLine,
        ].join('\n'),
        tools: [createTool('browse')],
      },
      {
        expected: [
          ...browserLines,
          '- Sandbox tools are also available in this run. Use them for local file transforms, `/vault` work, package-backed processing, and non-browser parsing.',
          '- Prefer `execute` as the default sandbox tool. It defaults to `mode: "bash"` for quick `find`/`rg`/`ls`/`cat` style inspection over mounted files. Use `mode: "script"` when you need custom JavaScript, MCP code-mode scripts, packages, or structured parsing.',
          '- In `execute` script mode, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
          finalLine,
        ].join('\n'),
        tools: [createTool('browse'), createTool('execute')],
      },
    ]

    for (const { expected, tools } of scenarios) {
      assert.deepEqual(
        capabilityGuidanceContributor.build(createInput(tools)),
        expectedContribution(expected),
      )
    }
  })
})
