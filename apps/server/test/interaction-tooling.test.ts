import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  buildInteractionToolingRequest,
  toToolDefinitions,
} from '../src/application/interactions/interaction-tooling'
import type { ToolSpec } from '../src/domain/tooling/tool-registry'

const makeTool = (name: string): ToolSpec => ({
  domain: 'native',
  execute: async () => ({
    error: {
      message: 'not implemented',
      type: 'conflict',
    },
    ok: false,
  }),
  inputSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  name,
})

test('toToolDefinitions drops model-visible tools with invalid function names', () => {
  const definitions = toToolDefinitions([
    makeTool('delegate_to_agent'),
    makeTool('legacy.tool'),
    makeTool('spotify__player_status'),
  ])

  assert.deepEqual(
    definitions.map((tool) => tool.name),
    ['delegate_to_agent', 'spotify__player_status'],
  )
})

test('buildInteractionToolingRequest omits tooling metadata when every tool name is invalid', () => {
  const tooling = buildInteractionToolingRequest(
    [makeTool('legacy.tool'), makeTool('bad/tool')],
    [],
  )

  assert.deepEqual(tooling, {})
})
