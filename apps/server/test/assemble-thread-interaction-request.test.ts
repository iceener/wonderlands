import assert from 'node:assert/strict'
import { test } from 'vitest'

import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import type { ThreadContextData } from '../src/application/interactions/context-bundle'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import {
  asAgentRevisionId,
  asRunId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
} from '../src/shared/ids'
import { ok } from '../src/shared/result'

const createContext = (): ThreadContextData => ({
  activeReflection: null,
  agentProfile: null,
  attachmentRefs: [],
  gardenContext: null,
  items: [],
  observations: [],
  pendingWaits: [],
  run: {
    agentId: null,
    agentRevisionId: null,
    completedAt: null,
    configSnapshot: {
      model: 'gpt-5.4',
      provider: 'openai',
    },
    createdAt: '2026-03-31T10:00:00.000Z',
    errorJson: null,
    id: asRunId('run_budget_tools'),
    lastProgressAt: null,
    parentRunId: null,
    resultJson: null,
    rootRunId: asRunId('run_budget_tools'),
    sessionId: asWorkSessionId('ses_budget_tools'),
    sourceCallId: null,
    startedAt: '2026-03-31T10:00:00.000Z',
    status: 'running',
    task: 'Plan the next milestone',
    tenantId: asTenantId('ten_budget_tools'),
    threadId: asSessionThreadId('thr_budget_tools'),
    toolProfileId: null,
    turnCount: 0,
    updatedAt: '2026-03-31T10:00:00.000Z',
    version: 1,
    jobId: null,
    workspaceId: null,
    workspaceRef: null,
  },
  summary: null,
  visibleFiles: [],
  visibleMessages: [],
})

const createTool = (): ToolSpec => ({
  description: 'Look up project data from an internal index.',
  domain: 'native',
  execute: async () =>
    ok({
      kind: 'immediate',
      output: null,
    }),
  inputSchema: {
    additionalProperties: false,
    properties: {
      filters: {
        description: 'Apply structured filters before searching. '.repeat(160),
        items: {
          type: 'string',
        },
        type: 'array',
      },
      query: {
        description: 'Plain-language search request for the internal index. '.repeat(160),
        type: 'string',
      },
    },
    required: ['query'],
    type: 'object',
  },
  name: 'lookup_internal_index',
  strict: true,
})

test('assembleThreadInteractionRequest budgets tool schemas from the same request shape it returns', () => {
  const withoutTools = assembleThreadInteractionRequest({
    activeTools: [],
    context: createContext(),
    nativeTools: [],
    overrides: {},
  })
  const withTools = assembleThreadInteractionRequest({
    activeTools: [createTool()],
    context: createContext(),
    nativeTools: ['web_search'],
    overrides: {},
  })

  assert.equal(withTools.request.allowParallelToolCalls, true)
  assert.deepEqual(withTools.request.nativeTools, ['web_search'])
  assert.equal(withTools.request.toolChoice, 'auto')
  assert.equal(withTools.request.tools?.[0]?.name, 'lookup_internal_index')
  assert.equal((withTools.bundle.budget.requestOverheadTokens ?? 0) > 0, true)
  assert.equal(
    withTools.bundle.budget.stablePrefixTokens > withoutTools.bundle.budget.stablePrefixTokens,
    true,
  )
  assert.equal(
    withTools.bundle.budget.rawEstimatedInputTokens >
      withoutTools.bundle.budget.rawEstimatedInputTokens,
    true,
  )
})

test('assembleThreadInteractionRequest renders subagents with descriptions and capability summaries', () => {
  const context = createContext()

  context.agentProfile = {
    instructionsMd: 'Route work to the best specialist.',
    revisionId: asAgentRevisionId('agr_dispatcher_v1'),
    subagents: [
      {
        alias: 'tony',
        childAgentId: 'agt_tony',
        childDescription: 'API researcher focused on runtime behavior and tool wiring.',
        childName: 'Tony',
        childSlug: 'tony',
        delegationMode: 'async_join',
        tools: [
          {
            description: 'Search the web for public information.',
            kind: 'provider',
            name: 'web_search',
            title: null,
          },
          {
            description: 'Search the project repository.',
            kind: 'mcp',
            name: 'repo_search',
            title: 'Repo Search',
          },
        ],
      },
    ],
  }

  const result = assembleThreadInteractionRequest({
    activeTools: [],
    context,
    nativeTools: [],
    overrides: {},
  })

  const agentProfileMessage = result.request.messages.find(
    (message) =>
      message.role === 'developer' &&
      message.content.some(
        (content) =>
          content.type === 'text' &&
          content.text.includes(
            'Allowed subagents for this run. Use the alias value as agentAlias',
          ),
      ),
  )

  assert.deepEqual(agentProfileMessage, {
    content: [
      {
        text:
          'Instructions:\n' +
          'Route work to the best specialist.\n\n' +
          'Allowed subagents for this run. Use the alias value as agentAlias when calling delegate_to_agent.\n\n' +
          'If a delegated child returns kind="suspended", this run stays responsible for orchestration. Gather the missing input yourself, then call resume_delegated_run with the returned childRunId and waitId.\n\n' +
          '- alias: tony\n' +
          '  name: Tony\n' +
          '  description: API researcher focused on runtime behavior and tool wiring.\n' +
          '  tools: web_search, repo_search',
        type: 'text',
      },
    ],
    role: 'developer',
  })
})

test('assembleThreadInteractionRequest does not duplicate active MCP tools into developer messages', () => {
  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Read project data from an MCP index.',
        domain: 'mcp',
        name: 'mcp_project_lookup',
      },
    ],
    context: createContext(),
    nativeTools: [],
    overrides: {},
  })

  assert.equal(
    result.request.messages.some(
      (message) =>
        message.role === 'developer' &&
        message.content.some(
          (content) =>
            content.type === 'text' &&
            content.text.includes('Active MCP tools currently available'),
        ),
    ),
    false,
  )
})

test('assembleThreadInteractionRequest hides direct MCP function schemas in code mode and emits catalog inventory', () => {
  const result = assembleThreadInteractionRequest({
    activeTools: [
      {
        ...createTool(),
        description: 'Search the MCP catalog.',
        name: 'search_tools',
      },
      {
        ...createTool(),
        description: 'Load exact MCP schemas and bindings.',
        name: 'get_tools',
      },
      {
        ...createTool(),
        description: 'Run MCP code in the sandbox.',
        name: 'execute',
      },
      {
        ...createTool(),
        description: 'Read project data from an MCP index.',
        domain: 'mcp',
        name: 'mcp_project_lookup',
      },
    ],
    context: createContext(),
    mcpCatalog: {
      servers: [
        {
          executableToolCount: 1,
          namespace: 'project',
          serverId: 'srv_project',
          serverLabel: 'project',
          toolCount: 1,
          tools: [
            {
              binding: 'project.project_lookup',
              description: 'Read project data from an MCP index.',
              executable: true,
              inputSchema: {
                additionalProperties: false,
                properties: {
                  query: {
                    type: 'string',
                  },
                },
                required: ['query'],
                type: 'object',
              },
              member: 'project_lookup',
              namespace: 'project',
              outputSchema: null,
              remoteName: 'project_lookup',
              runtimeName: 'project__project_lookup',
              serverId: 'srv_project',
              serverLabel: 'project',
              title: null,
            },
          ],
        },
      ],
      tools: [
        {
          binding: 'project.project_lookup',
          description: 'Read project data from an MCP index.',
          executable: true,
          inputSchema: {
            additionalProperties: false,
            properties: {
              query: {
                type: 'string',
              },
            },
            required: ['query'],
            type: 'object',
          },
          member: 'project_lookup',
          namespace: 'project',
          outputSchema: null,
          remoteName: 'project_lookup',
          runtimeName: 'project__project_lookup',
          serverId: 'srv_project',
          serverLabel: 'project',
          title: null,
        },
      ],
    },
    mcpMode: 'code',
    nativeTools: [],
    overrides: {},
  })

  assert.deepEqual([...(result.request.tools?.map((tool) => tool.name) ?? [])].sort(), [
    'execute',
    'get_tools',
    'search_tools',
  ])
  assert.equal(
    result.request.messages.some(
      (message) =>
        message.role === 'developer' &&
        message.content.some(
          (content) =>
            content.type === 'text' &&
            content.text.includes('MCP code mode is enabled.') &&
            content.text.includes(
              'In execute script mode, MCP bindings are only exposed after you load them with get_tools.',
            ) &&
            content.text.includes(
              'Do not use execute script mode to inspect globalThis or enumerate bindings.',
            ) &&
            content.text.includes('The runtime wraps your code in an awaited async function.') &&
            content.text.includes('Active MCP inventory:') &&
            content.text.includes('- project: project_lookup'),
        ),
    ),
    true,
  )
})
