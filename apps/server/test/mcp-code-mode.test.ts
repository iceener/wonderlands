import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import {
  buildMcpCodeModeCatalog,
  collectLoadedMcpCodeModeLookups,
  filterMcpCodeModeCatalogToLoadedTools,
  findMcpCodeModeModuleSyntaxMisuse,
  findMcpRuntimeNameCallMisuse,
  findReferencedMcpCodeModeBindings,
  renderMcpCodeModeTypeScriptBundle,
  renderMcpCodeModeWrapperScript,
  resolveMcpCodeModeTools,
  searchMcpCodeModeCatalog,
} from '../src/application/mcp/code-mode'
import { toToolContext } from '../src/application/runtime/execution/tools/prepare-tool-execution'
import { mcpServers, mcpToolAssignments } from '../src/db/schema'
import {
  asAccountId,
  asRunId,
  asSessionThreadId,
  asTenantId,
  asToolProfileId,
  asWorkSessionId,
} from '../src/shared/ids'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

test('renderMcpCodeModeWrapperScript keeps the IPC channel unrefd while idle and refs it for in-flight MCP calls', () => {
  const script = renderMcpCodeModeWrapperScript({
    catalog: {
      servers: [
        {
          executableToolCount: 1,
          namespace: 'spotify',
          serverId: 'srv_spotify',
          serverLabel: 'spotify',
          toolCount: 1,
          tools: [
            {
              binding: 'spotify.spotify_control',
              description: 'Control Spotify playback.',
              executable: true,
              inputSchema: {
                type: 'object',
              },
              member: 'spotify_control',
              namespace: 'spotify',
              outputSchema: null,
              remoteName: 'spotify_control',
              runtimeName: 'spotify__spotify_control',
              serverId: 'srv_spotify',
              serverLabel: 'spotify',
              title: null,
            },
          ],
        },
      ],
      tools: [],
    },
    code: 'await spotify.spotify_control({ operations: [] });',
  })

  assert.match(script, /const __wonderlandsNormalizeMcpResult = \(result\) => \{/)
  assert.match(script, /const __wonderlandsPrintResult = \(value\) => \{/)
  assert.match(
    script,
    /const __wonderlandsCallMcp = typeof globalThis\.__wonderlandsCallMcp === "function"/,
  )
  assert.match(script, /const setChannelReferenced = \(referenced\) => \{/)
  assert.match(script, /setChannelReferenced\(false\);/)
  assert.match(script, /setChannelReferenced\(true\);/)
  assert.match(script, /if \(pendingCalls\.size === 0\) {\n {10}setChannelReferenced\(false\);/)
  assert.match(script, /pending\.resolve\(__wonderlandsNormalizeMcpResult\(message\.result\)\);/)
  assert.match(
    script,
    /spotify_control: async \(input\) => await __wonderlandsCallMcp\("spotify__spotify_control", input\)/,
  )
  assert.match(script, /const __wonderlandsResult = await \(async \(\) => \{/)
  assert.match(script, /await spotify\.spotify_control\(\{ operations: \[\] \}\);/)
  assert.match(
    script,
    /if \(typeof globalThis\.__wonderlandsWaitForMcpIdle === "function"\) \{\n {2}await globalThis\.__wonderlandsWaitForMcpIdle\(\);\n\}/,
  )
  assert.match(script, /__wonderlandsPrintResult\(__wonderlandsResult\);/)
})

test('buildMcpCodeModeCatalog treats fingerprint-trusted runtime aliases as executable', () => {
  const { runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
  const now = '2026-04-09T12:00:00.000Z'

  runtime.db
    .insert(mcpServers)
    .values({
      configJson: {
        args: ['fixture'],
        command: 'node',
      },
      createdAt: now,
      createdByAccountId: accountId,
      enabled: true,
      id: 'srv_spotify',
      kind: 'stdio',
      label: 'Spotify',
      scope: 'account_private',
      tenantId,
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(mcpToolAssignments)
    .values({
      approvedAt: now,
      approvedFingerprint: 'fp_spotify_control',
      createdAt: now,
      id: 'mta_spotify_alias',
      requiresConfirmation: true,
      runtimeName: 'spotify.spotify_control',
      serverId: 'srv_spotify',
      tenantId,
      toolProfileId: assistantToolProfileId,
      updatedAt: now,
    })
    .run()

  const originalGetTool = runtime.services.mcp.getTool
  runtime.services.mcp.getTool = (runtimeName) =>
    runtimeName === 'spotify__spotify_control'
      ? ({
          apps: null,
          description: 'Control Spotify playback.',
          execution: null,
          fingerprint: 'fp_spotify_control',
          inputSchema: {
            type: 'object',
          },
          modelVisible: true,
          outputSchema: null,
          registrationSkippedReason: null,
          remoteName: 'spotify_control',
          remoteTool: {
            inputSchema: {
              type: 'object',
            },
            name: 'spotify_control',
          },
          runtimeName: 'spotify__spotify_control',
          serverId: 'srv_spotify',
          title: 'Spotify Control',
        } as const)
      : null

  try {
    const commandContext = createInternalCommandContext(runtime, {
      accountId: asAccountId(accountId),
      role: 'admin',
      tenantId: asTenantId(tenantId),
    })
    const toolContext = toToolContext(
      commandContext,
      {
        actorAccountId: asAccountId(accountId),
        agentId: null,
        agentRevisionId: null,
        completedAt: null,
        configSnapshot: {},
        createdAt: now,
        errorJson: null,
        id: asRunId('run_spotify'),
        jobId: null,
        lastProgressAt: now,
        parentRunId: null,
        resultJson: null,
        rootRunId: asRunId('run_spotify'),
        sessionId: asWorkSessionId('ses_spotify'),
        sourceCallId: null,
        staleRecoveryCount: 0,
        startedAt: now,
        status: 'running',
        task: 'Use trusted Spotify control from MCP code mode.',
        targetKind: 'assistant',
        tenantId: asTenantId(tenantId),
        threadId: asSessionThreadId('thr_spotify'),
        toolProfileId: asToolProfileId(assistantToolProfileId),
        turnCount: 1,
        updatedAt: now,
        version: 1,
        workspaceId: null,
        workspaceRef: null,
      },
      'call_spotify',
    )

    const catalog = buildMcpCodeModeCatalog(toolContext, [
      {
        domain: 'mcp',
        execute: async () => {
          throw new Error('not used in catalog build')
        },
        inputSchema: {
          type: 'object',
        },
        name: 'spotify__spotify_control',
      },
    ])

    assert.equal(catalog.tools[0]?.binding, 'spotify.spotify_control')
    assert.equal(catalog.tools[0]?.executable, true)
  } finally {
    runtime.services.mcp.getTool = originalGetTool
  }
})

test('findMcpCodeModeModuleSyntaxMisuse detects top-level module syntax in wrapped script bodies', () => {
  assert.deepEqual(
    findMcpCodeModeModuleSyntaxMisuse(
      'const fs = await import("node:fs/promises");\nimport sharp from "sharp";\nreturn 1;',
    ),
    {
      kind: 'import',
      line: 2,
      snippet: 'import sharp from "sharp";',
    },
  )

  assert.deepEqual(
    findMcpCodeModeModuleSyntaxMisuse('export const run = async () => ({ ok: true });'),
    {
      kind: 'export',
      line: 1,
      snippet: 'export const run = async () => ({ ok: true });',
    },
  )

  assert.equal(
    findMcpCodeModeModuleSyntaxMisuse(
      'const { default: sharp } = await import("sharp");\nreturn await sharp(Buffer.from([])).metadata();',
    ),
    null,
  )
})

test('resolveMcpCodeModeTools resolves runtime names, bindings, and unique short names while surfacing ambiguity', () => {
  const catalog = {
    servers: [],
    tools: [
      {
        binding: 'jira.get_issue',
        description: 'Get a Jira issue.',
        executable: true,
        inputSchema: { type: 'object' },
        member: 'get_issue',
        namespace: 'jira',
        outputSchema: null,
        remoteName: 'get_issue',
        runtimeName: 'jira__get_issue',
        serverId: 'srv_jira',
        serverLabel: 'Jira',
        title: null,
      },
      {
        binding: 'linear.get_issue',
        description: 'Get a Linear issue.',
        executable: true,
        inputSchema: { type: 'object' },
        member: 'get_issue',
        namespace: 'linear',
        outputSchema: null,
        remoteName: 'get_issue',
        runtimeName: 'linear__get_issue',
        serverId: 'srv_linear',
        serverLabel: 'Linear',
        title: null,
      },
      {
        binding: 'spotify.player_status',
        description: 'Read Spotify player state.',
        executable: true,
        inputSchema: { type: 'object' },
        member: 'player_status',
        namespace: 'spotify',
        outputSchema: null,
        remoteName: 'player_status',
        runtimeName: 'spotify__player_status',
        serverId: 'srv_spotify',
        serverLabel: 'Spotify',
        title: null,
      },
    ],
  }

  const resolved = resolveMcpCodeModeTools(catalog, [
    'spotify__player_status',
    'spotify.player_status',
    'player_status',
    'get_issue',
    'missing_tool',
  ])

  assert.deepEqual(
    resolved.resolved.map((entry) => ({
      matchedBy: entry.matchedBy,
      requestedName: entry.requestedName,
      runtimeName: entry.tool.runtimeName,
    })),
    [
      {
        matchedBy: 'runtimeName',
        requestedName: 'spotify__player_status',
        runtimeName: 'spotify__player_status',
      },
      {
        matchedBy: 'binding',
        requestedName: 'spotify.player_status',
        runtimeName: 'spotify__player_status',
      },
      {
        matchedBy: 'remoteName',
        requestedName: 'player_status',
        runtimeName: 'spotify__player_status',
      },
    ],
  )
  assert.deepEqual(resolved.missing, ['missing_tool'])
  assert.deepEqual(
    resolved.ambiguous.map((entry) => ({
      matchedBy: entry.matchedBy,
      requestedName: entry.requestedName,
      runtimeNames: entry.matches.map((tool) => tool.runtimeName),
    })),
    [
      {
        matchedBy: 'remoteName',
        requestedName: 'get_issue',
        runtimeNames: ['jira__get_issue', 'linear__get_issue'],
      },
    ],
  )
})

test('searchMcpCodeModeCatalog returns canonical binding data without internal runtime names', () => {
  const result = searchMcpCodeModeCatalog(
    {
      servers: [],
      tools: [
        {
          binding: 'spotify.player_status',
          description: 'Read Spotify player state.',
          executable: true,
          inputSchema: { type: 'object' },
          member: 'player_status',
          namespace: 'spotify',
          outputSchema: null,
          remoteName: 'player_status',
          runtimeName: 'spotify__player_status',
          serverId: 'srv_spotify',
          serverLabel: 'Spotify',
          title: 'Player Status',
        },
      ],
    },
    {
      query: 'spotify',
      scope: 'tools',
    },
  )

  assert.deepEqual(result.tools, [
    {
      binding: 'spotify.player_status',
      description: 'Read Spotify player state.',
      executable: true,
      serverId: 'srv_spotify',
      serverLabel: 'Spotify',
      title: 'Player Status',
    },
  ])
  assert.deepEqual(result.hint, {
    message:
      'search_tools only discovers tools. Before execute with `mode: "script"`, call get_tools with the exact bindings you plan to use, ideally in one batched call.',
    nextToolArgs: {
      names: ['spotify.player_status'],
    },
    nextToolName: 'get_tools',
    suggestedBindings: ['spotify.player_status'],
  })
})

test('renderMcpCodeModeTypeScriptBundle merges members by namespace with cleaner names', () => {
  const typescript = renderMcpCodeModeTypeScriptBundle([
    {
      binding: 'spotify.search_catalog',
      description: 'Search Spotify.',
      executable: true,
      inputSchema: { type: 'object' },
      member: 'search_catalog',
      namespace: 'spotify',
      outputSchema: {
        properties: {
          batches: {
            items: {
              properties: {
                items: {
                  items: {
                    properties: {
                      id: { type: 'string' },
                    },
                    required: ['id'],
                    type: 'object',
                  },
                  type: 'array',
                },
              },
              type: 'object',
            },
            type: 'array',
          },
        },
        type: 'object',
      },
      remoteName: 'search_catalog',
      runtimeName: 'spotify__search_catalog',
      serverId: 'srv_spotify',
      serverLabel: 'Spotify',
      title: 'Search Catalog',
    },
    {
      binding: 'spotify.spotify_control',
      description: 'Control Spotify playback.',
      executable: true,
      inputSchema: { type: 'object' },
      member: 'spotify_control',
      namespace: 'spotify',
      outputSchema: null,
      remoteName: 'spotify_control',
      runtimeName: 'spotify__spotify_control',
      serverId: 'srv_spotify',
      serverLabel: 'Spotify',
      title: 'Spotify Control',
    },
  ])

  assert.equal((typescript.match(/declare const spotify/g) ?? []).length, 1)
  assert.match(typescript, /interface SpotifySearchCatalogOutputBatch/)
  assert.match(
    typescript,
    /search_catalog\(input: SpotifySearchCatalogInput\): Promise<SpotifySearchCatalogOutput>;/,
  )
  assert.match(
    typescript,
    /spotify_control\(input: SpotifySpotifyControlInput\): Promise<unknown>;/,
  )
})

test('collectLoadedMcpCodeModeLookups and filterMcpCodeModeCatalogToLoadedTools keep only previously loaded bindings', () => {
  const loaded = collectLoadedMcpCodeModeLookups([
    {
      errorText: null,
      outcomeJson: {
        resolved: [
          {
            binding: 'spotify.player_status',
          },
        ],
      },
      tool: 'get_tools',
    },
    {
      errorText: null,
      outcomeJson: {
        resolved: [
          {
            binding: 'spotify.search_catalog',
            runtimeName: 'spotify__search_catalog',
          },
        ],
      },
      tool: 'get_tools',
    },
    {
      errorText: 'failed',
      outcomeJson: {
        resolved: [
          {
            binding: 'spotify.spotify_control',
          },
        ],
      },
      tool: 'get_tools',
    },
  ])

  const filtered = filterMcpCodeModeCatalogToLoadedTools(
    {
      servers: [
        {
          executableToolCount: 3,
          namespace: 'spotify',
          serverId: 'srv_spotify',
          serverLabel: 'Spotify',
          toolCount: 3,
          tools: [
            {
              binding: 'spotify.player_status',
              description: 'Read Spotify player state.',
              executable: true,
              inputSchema: { type: 'object' },
              member: 'player_status',
              namespace: 'spotify',
              outputSchema: null,
              remoteName: 'player_status',
              runtimeName: 'spotify__player_status',
              serverId: 'srv_spotify',
              serverLabel: 'Spotify',
              title: 'Player Status',
            },
            {
              binding: 'spotify.search_catalog',
              description: 'Search Spotify.',
              executable: true,
              inputSchema: { type: 'object' },
              member: 'search_catalog',
              namespace: 'spotify',
              outputSchema: null,
              remoteName: 'search_catalog',
              runtimeName: 'spotify__search_catalog',
              serverId: 'srv_spotify',
              serverLabel: 'Spotify',
              title: 'Search Catalog',
            },
            {
              binding: 'spotify.spotify_control',
              description: 'Control playback.',
              executable: true,
              inputSchema: { type: 'object' },
              member: 'spotify_control',
              namespace: 'spotify',
              outputSchema: null,
              remoteName: 'spotify_control',
              runtimeName: 'spotify__spotify_control',
              serverId: 'srv_spotify',
              serverLabel: 'Spotify',
              title: 'Playback Control',
            },
          ],
        },
      ],
      tools: [
        {
          binding: 'spotify.player_status',
          description: 'Read Spotify player state.',
          executable: true,
          inputSchema: { type: 'object' },
          member: 'player_status',
          namespace: 'spotify',
          outputSchema: null,
          remoteName: 'player_status',
          runtimeName: 'spotify__player_status',
          serverId: 'srv_spotify',
          serverLabel: 'Spotify',
          title: 'Player Status',
        },
        {
          binding: 'spotify.search_catalog',
          description: 'Search Spotify.',
          executable: true,
          inputSchema: { type: 'object' },
          member: 'search_catalog',
          namespace: 'spotify',
          outputSchema: null,
          remoteName: 'search_catalog',
          runtimeName: 'spotify__search_catalog',
          serverId: 'srv_spotify',
          serverLabel: 'Spotify',
          title: 'Search Catalog',
        },
        {
          binding: 'spotify.spotify_control',
          description: 'Control playback.',
          executable: true,
          inputSchema: { type: 'object' },
          member: 'spotify_control',
          namespace: 'spotify',
          outputSchema: null,
          remoteName: 'spotify_control',
          runtimeName: 'spotify__spotify_control',
          serverId: 'srv_spotify',
          serverLabel: 'Spotify',
          title: 'Playback Control',
        },
      ],
    },
    loaded,
  )

  assert.deepEqual([...loaded.bindings].sort(), ['spotify.player_status', 'spotify.search_catalog'])
  assert.deepEqual([...loaded.runtimeNames].sort(), ['spotify__search_catalog'])
  assert.deepEqual(
    filtered.tools.map((tool) => tool.binding),
    ['spotify.player_status', 'spotify.search_catalog'],
  )
  assert.deepEqual(
    filtered.servers[0]?.tools.map((tool) => tool.binding),
    ['spotify.player_status', 'spotify.search_catalog'],
  )
})

test('findMcpRuntimeNameCallMisuse points callers to the canonical binding', () => {
  const misuse = findMcpRuntimeNameCallMisuse(
    {
      servers: [],
      tools: [
        {
          binding: 'spotify.search_catalog',
          description: 'Search Spotify.',
          executable: true,
          inputSchema: { type: 'object' },
          member: 'search_catalog',
          namespace: 'spotify',
          outputSchema: null,
          remoteName: 'search_catalog',
          runtimeName: 'spotify__search_catalog',
          serverId: 'srv_spotify',
          serverLabel: 'Spotify',
          title: 'Search Catalog',
        },
      ],
    },
    'const res = await spotify__search_catalog({ queries: ["x"] });',
  )

  assert.deepEqual(misuse, {
    binding: 'spotify.search_catalog',
    runtimeName: 'spotify__search_catalog',
  })
})

test('findReferencedMcpCodeModeBindings identifies canonical binding calls in code', () => {
  const bindings = findReferencedMcpCodeModeBindings(
    {
      servers: [],
      tools: [
        {
          binding: 'spotify.search_catalog',
          description: 'Search Spotify.',
          executable: true,
          inputSchema: { type: 'object' },
          member: 'search_catalog',
          namespace: 'spotify',
          outputSchema: null,
          remoteName: 'search_catalog',
          runtimeName: 'spotify__search_catalog',
          serverId: 'srv_spotify',
          serverLabel: 'Spotify',
          title: 'Search Catalog',
        },
        {
          binding: 'spotify.player_status',
          description: 'Read player state.',
          executable: true,
          inputSchema: { type: 'object' },
          member: 'player_status',
          namespace: 'spotify',
          outputSchema: null,
          remoteName: 'player_status',
          runtimeName: 'spotify__player_status',
          serverId: 'srv_spotify',
          serverLabel: 'Spotify',
          title: 'Player Status',
        },
      ],
    },
    `
      const [searchRes, statusRes] = await Promise.all([
        spotify.search_catalog({ queries: ['x'] }),
        spotify.player_status({ include: ['player'] }),
      ])
    `,
  )

  assert.deepEqual(bindings, ['spotify.search_catalog', 'spotify.player_status'])
})
