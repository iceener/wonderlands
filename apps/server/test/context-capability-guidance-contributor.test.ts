import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

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
  test('uses the current capability layer identity, order, and empty behavior', () => {
    assert.equal(capabilityGuidanceContributor.id, 'capability-guidance')
    assert.equal(capabilityGuidanceContributor.order, 3)
    assert.deepEqual(capabilityGuidanceContributor.build(createInput([])), expectedContribution())
    assert.deepEqual(
      capabilityGuidanceContributor.build(createInput([createTool('execute')])),
      expectedContribution(),
    )
  })

  test('preserves exact browser-only guidance', () => {
    assert.deepEqual(
      capabilityGuidanceContributor.build(createInput([createTool('browse')])),
      expectedContribution(
        [
          'Capability guidance:',
          '',
          '- `browse` is available for live website interaction: navigation, clicks, form filling, DOM inspection, screenshots, PDFs, cookies, and browser-state capture.',
          '- Keep browser scripts short and focused. Return JSON-serializable results from the script instead of logging or printing large blobs.',
          '- Use browser jobs when the task requires a real page, live rendering, client-side JavaScript, or authenticated browser state.',
          '- Browser jobs do not replace workspace or shell tools. Use them only when a live browser is actually needed.',
          '- Request screenshots, PDFs, HTML, cookies, or recordings only when they materially help the conversation. Those outputs become normal run attachments.',
        ].join('\n'),
      ),
    )
  })

  test('resolves browser and sandbox capabilities from immutable tools without changing them', () => {
    const browse = Object.freeze(createTool('browse'))
    const execute = Object.freeze(createTool('execute'))
    const activeTools = Object.freeze([browse, execute])
    const input = createInput(activeTools)

    assert.deepEqual(
      capabilityGuidanceContributor.build(input),
      expectedContribution(
        [
          'Capability guidance:',
          '',
          '- `browse` is available for live website interaction: navigation, clicks, form filling, DOM inspection, screenshots, PDFs, cookies, and browser-state capture.',
          '- Keep browser scripts short and focused. Return JSON-serializable results from the script instead of logging or printing large blobs.',
          '- Use browser jobs when the task requires a real page, live rendering, client-side JavaScript, or authenticated browser state.',
          '- Sandbox tools are also available in this run. Use them for local file transforms, `/vault` work, package-backed processing, and non-browser parsing.',
          '- Prefer `execute` as the default sandbox tool. It defaults to `mode: "bash"` for quick `find`/`rg`/`ls`/`cat` style inspection over mounted files. Use `mode: "script"` when you need custom JavaScript, MCP code-mode scripts, packages, or structured parsing.',
          '- In `execute` script mode, inline JavaScript normally runs as an ES module. Prefer `await import(...)`, avoid `require(...)`, and outside MCP code mode do not use top-level `return`. When MCP code mode is active, write a script body, not a full module: the runtime wraps your code in an async function, so `return` is allowed there but static top-level `import`/`export` is not.',
          '- Request screenshots, PDFs, HTML, cookies, or recordings only when they materially help the conversation. Those outputs become normal run attachments.',
        ].join('\n'),
      ),
    )
    assert.deepEqual(input.activeTools, activeTools)
    assert.equal(input.activeTools[0], browse)
    assert.equal(input.activeTools[1], execute)
  })
})
