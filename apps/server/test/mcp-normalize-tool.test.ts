import assert from 'node:assert/strict'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { test } from 'vitest'

import { normalizeMcpTool } from '../src/adapters/mcp/normalize-tool'
import type { McpServerConfig } from '../src/adapters/mcp/types'

const stdioServer: McpServerConfig = {
  command: 'node',
  enabled: true,
  id: 'fixture',
  kind: 'stdio',
  toolPrefix: 'fixture',
}

test('normalizeMcpTool preserves nested MCP Apps metadata and hides app-only tools from the model', () => {
  const descriptor = normalizeMcpTool(stdioServer, {
    _meta: {
      ui: {
        resourceUri: 'ui://fixture/view.html',
        visibility: ['app'],
      },
    },
    description: 'App-only tool',
    inputSchema: {
      properties: {},
      required: [],
      type: 'object',
    },
    name: 'app_only',
  } satisfies Tool)

  assert.equal(descriptor.runtimeName, 'fixture__app_only')
  assert.equal(descriptor.modelVisible, false)
  assert.equal(descriptor.apps?.resourceUri, 'ui://fixture/view.html')
  assert.deepEqual(descriptor.apps?.visibility, ['app'])
})

test('normalizeMcpTool supports legacy ui/resourceUri metadata and generates stable fingerprints', () => {
  const first = normalizeMcpTool(stdioServer, {
    _meta: {
      'ui/resourceUri': 'ui://fixture/legacy.html',
    },
    description: 'Legacy metadata tool',
    inputSchema: {
      properties: {
        value: { type: 'string' },
      },
      required: ['value'],
      type: 'object',
    },
    name: 'legacy_ui',
  } satisfies Tool)

  const second = normalizeMcpTool(stdioServer, {
    _meta: {
      'ui/resourceUri': 'ui://fixture/legacy.html',
    },
    description: 'Legacy metadata tool',
    inputSchema: {
      required: ['value'],
      properties: {
        value: { type: 'string' },
      },
      type: 'object',
    },
    name: 'legacy_ui',
  } satisfies Tool)

  assert.equal(first.apps?.resourceUri, 'ui://fixture/legacy.html')
  assert.deepEqual(first.apps?.visibility, ['model', 'app'])
  assert.equal(first.fingerprint, second.fingerprint)
})
