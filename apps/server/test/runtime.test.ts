import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { McpServerConfig } from '../src/adapters/mcp/types'
import { resolveRuntimeMcpServers } from '../src/app/runtime'

test('resolveRuntimeMcpServers removes legacy FS_ROOT from workspace-scoped stdio servers', () => {
  const servers: McpServerConfig[] = [
    {
      args: ['run', '../mcp/files-mcp/src/index.ts'],
      command: 'bun',
      cwd: '.',
      env: {
        FS_ROOT: './workspace',
        LOG_LEVEL: 'info',
      },
      id: 'workspace_files',
      kind: 'stdio',
      toolPrefix: 'files',
      workspaceScoped: 'account',
    },
  ]

  const [resolved] = resolveRuntimeMcpServers(servers, '/tmp/05_04_api/var/files')

  assert.deepEqual(resolved?.env, {
    FS_ROOTS: '/tmp/05_04_api/var/workspaces',
    LOG_LEVEL: 'info',
  })
})

test('resolveRuntimeMcpServers leaves non-workspace servers unchanged', () => {
  const servers: McpServerConfig[] = [
    {
      args: ['run', '../mcp/web/src/index.ts'],
      command: 'bun',
      cwd: '.',
      env: {
        LOG_LEVEL: 'info',
      },
      id: 'web',
      kind: 'stdio',
      toolPrefix: 'web',
    },
  ]

  const [resolved] = resolveRuntimeMcpServers(servers, '/tmp/05_04_api/var/files')

  assert.deepEqual(resolved, servers[0])
})
