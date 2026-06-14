import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { onTestFinished, test } from 'vitest'
import { z } from 'zod'
import {
  toLangfuseObservationId,
  toLangfuseTraceId,
} from '../src/adapters/observability/langfuse/trace-identity'
import type { AppRuntime } from '../src/app/runtime'
import { closeAppRuntime } from '../src/app/runtime'
import { mcpToolAssignments } from '../src/db/schema'
import type { RunRecord } from '../src/domain/runtime/run-repository'
import type { ToolContext } from '../src/domain/tooling/tool-registry'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createAsyncTestHarness } from './helpers/create-test-app'

const stdioFixturePath = resolve(process.cwd(), 'test/fixtures/stdio-mcp-server.ts')

const writeMcpServersFile = (contents: unknown): string => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mcp-transports-'))
  const filePath = resolve(dir, 'servers.json')
  writeFileSync(filePath, JSON.stringify(contents), 'utf8')
  return filePath
}

const assignMcpToolToProfile = (
  runtime: AppRuntime,
  input: {
    runtimeName: string
    serverId: string
    tenantId: string
    toolProfileId: string
  },
) => {
  const createdAt = '2026-03-30T05:00:00.000Z'

  runtime.db
    .insert(mcpToolAssignments)
    .values({
      createdAt,
      id: `mta_${input.toolProfileId}_${input.runtimeName}`,
      requiresConfirmation: false,
      runtimeName: input.runtimeName,
      serverId: input.serverId,
      tenantId: input.tenantId,
      toolProfileId: input.toolProfileId,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .run()
}

const createToolContext = (runtime: AppRuntime, toolProfileId: string | null): ToolContext => {
  const now = new Date().toISOString()
  const tenantId = 'ten_test'

  return {
    createId: runtime.services.ids.create,
    db: runtime.db,
    nowIso: () => now,
    run: {
      actorAccountId: 'acc_test' as RunRecord['actorAccountId'],
      agentId: null,
      agentRevisionId: null,
      completedAt: null,
      configSnapshot: {},
      createdAt: now,
      errorJson: null,
      id: 'run_test' as RunRecord['id'],
      lastProgressAt: now,
      parentRunId: null,
      resultJson: null,
      rootRunId: 'run_test' as RunRecord['rootRunId'],
      sessionId: 'ses_test' as RunRecord['sessionId'],
      sourceCallId: null,
      staleRecoveryCount: 0,
      startedAt: now,
      status: 'running',
      task: 'test mcp tool execution',
      tenantId: tenantId as RunRecord['tenantId'],
      targetKind: 'assistant',
      threadId: 'thr_test' as NonNullable<RunRecord['threadId']>,
      toolProfileId: toolProfileId as RunRecord['toolProfileId'],
      turnCount: 0,
      updatedAt: now,
      version: 1,
      jobId: null,
      workspaceId: null,
      workspaceRef: null,
    },
    tenantScope: {
      accountId: 'acc_test' as ToolContext['tenantScope']['accountId'],
      role: 'owner',
      tenantId: tenantId as ToolContext['tenantScope']['tenantId'],
    },
    toolCallId: 'call_mcp_1',
  }
}

const createStreamableFixtureServer = async () => {
  let lastToolMeta: Record<string, unknown> | null = null

  const buildServer = () => {
    const server = new McpServer(
      {
        name: 'streamable-mcp-fixture',
        version: '1.0.0',
      },
      {
        capabilities: {
          logging: {},
        },
      },
    )

    registerAppTool(
      server,
      'echo',
      {
        description: 'Echo a value back over Streamable HTTP',
        inputSchema: {
          value: z.string(),
        },
        _meta: {
          ui: {
            resourceUri: 'ui://fixture/echo.html',
          },
        },
      },
      async ({ value }, extra) => {
        if (extra.sessionId) {
          await server.sendLoggingMessage(
            {
              data: {
                tool: 'echo',
                value,
              },
              level: 'info',
            },
            extra.sessionId,
          )
        }

        return {
          content: [
            {
              text: `stream:${value}`,
              type: 'text',
            },
          ],
          structuredContent: {
            echoed: value,
          },
        }
      },
    )

    registerAppTool(
      server,
      'app_only',
      {
        description: 'Only available to an MCP app host',
        inputSchema: {
          value: z.string().optional(),
        },
        _meta: {
          ui: {
            resourceUri: 'ui://fixture/app-only.html',
            visibility: ['app'],
          },
        },
      },
      async () => ({
        content: [
          {
            text: 'hidden',
            type: 'text',
          },
        ],
      }),
    )

    server.registerTool(
      'inspect_meta',
      {
        description: 'Returns the propagated MCP request metadata',
        inputSchema: {},
      },
      async (_args, extra) => {
        lastToolMeta =
          extra._meta && typeof extra._meta === 'object' && !Array.isArray(extra._meta)
            ? { ...extra._meta }
            : null

        return {
          content: [
            {
              text: 'meta',
              type: 'text',
            },
          ],
          structuredContent: {
            meta: lastToolMeta,
          },
        }
      },
    )

    return server
  }

  return {
    close: async () => {},
    fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init)

      if (new URL(request.url).pathname !== '/mcp') {
        return new Response('Not found', {
          status: 404,
        })
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      const mcpServer = buildServer()

      await mcpServer.connect(transport)
      return transport.handleRequest(request)
    },
    getLastToolMeta: () => lastToolMeta,
    url: 'http://streamable-fixture.test/mcp',
  }
}

test('MCP stdio servers register model-visible tools and execute through ToolSpec', async () => {
  const filePath = writeMcpServersFile([
    {
      args: ['--import', 'tsx', stdioFixturePath],
      command: process.execPath,
      id: 'stdio_fixture',
      kind: 'stdio',
      stderr: 'pipe',
    },
  ])
  const { runtime } = await createAsyncTestHarness({
    MCP_SERVERS_FILE: filePath,
  })

  onTestFinished(async () => {
    rmSync(dirname(filePath), { force: true, recursive: true })
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
  assignMcpToolToProfile(runtime, {
    runtimeName: 'stdio_fixture__echo',
    serverId: 'stdio_fixture',
    tenantId,
    toolProfileId: assistantToolProfileId,
  })

  assert.equal(runtime.services.mcp.getServerSnapshots()[0]?.status, 'ready')
  assert.ok(runtime.services.tools.get('stdio_fixture__echo'))
  assert.equal(runtime.services.tools.get('stdio_fixture__app_only'), null)
  assert.equal(
    runtime.services.mcp.getTool('stdio_fixture__app_only')?.apps?.resourceUri,
    'ui://fixture/app-only.html',
  )
  assert.deepEqual(runtime.services.mcp.getTool('stdio_fixture__app_only')?.apps?.visibility, [
    'app',
  ])
  assert.equal(
    runtime.services.mcp.getTool('stdio_fixture__legacy_ui')?.apps?.resourceUri,
    'ui://fixture/legacy.html',
  )

  const tool = runtime.services.tools.get('stdio_fixture__echo')
  assert.ok(tool)

  if (!tool) {
    return
  }

  const result = await tool.execute(createToolContext(runtime, assistantToolProfileId), {
    value: 'hello',
  })
  assert.ok(result.ok)

  if (!result.ok) {
    return
  }

  assert.equal(result.value.kind, 'immediate')
  assert.deepEqual(result.value.output, {
    content: [{ text: 'echo:hello', type: 'text' }],
    meta: null,
    ok: true,
    structuredContent: {
      echoed: 'hello',
    },
  })
})

test('MCP Streamable HTTP servers register tools and execute through ToolSpec', async () => {
  const fixture = await createStreamableFixtureServer()
  const originalFetch = globalThis.fetch
  const filePath = writeMcpServersFile([
    {
      id: 'stream_fixture',
      kind: 'streamable_http',
      url: fixture.url,
    },
  ])

  globalThis.fetch = fixture.fetch as typeof fetch
  const { runtime } = await createAsyncTestHarness({
    MCP_SERVERS_FILE: filePath,
  })

  onTestFinished(async () => {
    globalThis.fetch = originalFetch
    rmSync(dirname(filePath), { force: true, recursive: true })
    await closeAppRuntime(runtime)
    await fixture.close()
  })

  const { assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
  assignMcpToolToProfile(runtime, {
    runtimeName: 'stream_fixture__echo',
    serverId: 'stream_fixture',
    tenantId,
    toolProfileId: assistantToolProfileId,
  })

  assert.equal(runtime.services.mcp.getServerSnapshots()[0]?.status, 'ready')
  assert.ok(runtime.services.tools.get('stream_fixture__echo'))
  assert.equal(runtime.services.tools.get('stream_fixture__app_only'), null)
  assert.equal(
    runtime.services.mcp.getTool('stream_fixture__app_only')?.apps?.resourceUri,
    'ui://fixture/app-only.html',
  )

  const tool = runtime.services.tools.get('stream_fixture__echo')
  assert.ok(tool)

  if (!tool) {
    return
  }

  const result = await tool.execute(createToolContext(runtime, assistantToolProfileId), {
    value: 'hello',
  })
  assert.ok(result.ok)

  if (!result.ok) {
    return
  }

  assert.equal(result.value.kind, 'immediate')
  assert.deepEqual(result.value.output, {
    content: [{ text: 'stream:hello', type: 'text' }],
    meta: null,
    ok: true,
    structuredContent: {
      echoed: 'hello',
    },
  })
})

test('MCP tool calls inject deterministic trace context into _meta', async () => {
  const fixture = await createStreamableFixtureServer()
  const originalFetch = globalThis.fetch
  const filePath = writeMcpServersFile([
    {
      id: 'stream_fixture',
      kind: 'streamable_http',
      url: fixture.url,
    },
  ])

  globalThis.fetch = fixture.fetch as typeof fetch
  const { runtime } = await createAsyncTestHarness({
    MCP_SERVERS_FILE: filePath,
  })

  onTestFinished(async () => {
    globalThis.fetch = originalFetch
    rmSync(dirname(filePath), { force: true, recursive: true })
    await closeAppRuntime(runtime)
    await fixture.close()
  })

  const { assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
  assignMcpToolToProfile(runtime, {
    runtimeName: 'stream_fixture__inspect_meta',
    serverId: 'stream_fixture',
    tenantId,
    toolProfileId: assistantToolProfileId,
  })

  const tool = runtime.services.tools.get('stream_fixture__inspect_meta')
  assert.ok(tool)

  if (!tool) {
    return
  }

  const toolContext = createToolContext(runtime, assistantToolProfileId)
  const result = await tool.execute(toolContext, {})

  assert.ok(result.ok)

  if (!result.ok) {
    return
  }

  const expectedTraceparent = `00-${toLangfuseTraceId(toolContext.run.rootRunId)}-${toLangfuseObservationId(`tool:${toolContext.toolCallId}`)}-01`

  assert.equal(result.value.kind, 'immediate')
  assert.equal(fixture.getLastToolMeta()?.traceparent, expectedTraceparent)
  assert.equal(
    (
      result.value.output as {
        structuredContent?: { meta?: { traceparent?: string } | null }
      }
    ).structuredContent?.meta?.traceparent,
    expectedTraceparent,
  )
})

test('MCP initialization degrades broken servers without blocking healthy ones', async () => {
  const filePath = writeMcpServersFile([
    {
      command: 'definitely-missing-mcp-command',
      id: 'broken',
      kind: 'stdio',
    },
    {
      args: ['--import', 'tsx', stdioFixturePath],
      command: process.execPath,
      id: 'healthy',
      kind: 'stdio',
      stderr: 'pipe',
    },
  ])
  const { runtime } = await createAsyncTestHarness({
    MCP_SERVERS_FILE: filePath,
  })

  onTestFinished(async () => {
    rmSync(dirname(filePath), { force: true, recursive: true })
    await closeAppRuntime(runtime)
  })

  const snapshots = runtime.services.mcp.getServerSnapshots()

  assert.equal(snapshots.find((snapshot) => snapshot.id === 'broken')?.status, 'degraded')
  assert.equal(snapshots.find((snapshot) => snapshot.id === 'healthy')?.status, 'ready')
  assert.ok(runtime.services.tools.get('healthy__echo'))
})
