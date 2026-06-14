import type { BackendEvent, ToolInteractionBlock } from '@wonderlands/contracts/chat'
import { asEventId, asRunId, asSessionId, asThreadId } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import {
  applyEvent,
  materializeBlocks,
  materializePendingWaitBlocks,
  materializePersistedAssistantBlocks,
} from './materialize'

const at = '2026-03-29T12:00:00.000Z'
const runId = asRunId('run_1')
const threadId = asThreadId('thr_1')

const event = <TEvent extends BackendEvent>(value: TEvent): TEvent => value

describe('materializeBlocks', () => {
  test('materializes streamed text and closes it on stream.done', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_1'),
        payload: {
          delta: 'Hello',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          threadId,
          turn: 1,
        },
        type: 'stream.delta',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_2'),
        payload: {
          model: 'gpt-5.4',
          provider: 'openai',
          responseId: 'resp_1',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          text: 'Hello',
          threadId,
          turn: 1,
        },
        type: 'stream.done',
      }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'text',
      content: 'Hello',
      streaming: false,
    })
  })

  test('ignores progress events and only renders streamed text', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 0,
        id: asEventId('evt_context_loaded'),
        payload: {
          detail: 'Thread context assembled from durable state',
          runId,
          sessionId: 'ses_1',
          stage: 'context.loaded',
          status: 'running',
          threadId,
          turn: 1,
        },
        type: 'progress.reported',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_progress'),
        payload: {
          detail: 'Preparing the response',
          runId,
          sessionId: 'ses_1',
          stage: 'generation.started',
          status: 'running',
          threadId,
          turn: 1,
        },
        type: 'progress.reported',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_delta'),
        payload: {
          delta: 'Draft answer',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          threadId,
          turn: 1,
        },
        type: 'stream.delta',
      }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'text',
      content: 'Draft answer',
      streaming: true,
    })
  })

  test('materializes streamed reasoning summaries before final text', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_reasoning_delta'),
        payload: {
          delta: 'Need tool output.',
          itemId: 'rs_reasoning_1',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          text: 'Need tool output.',
          threadId,
          turn: 1,
        },
        type: 'reasoning.summary.delta',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_reasoning_done'),
        payload: {
          itemId: 'rs_reasoning_1',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          text: 'Need tool output before answering.',
          threadId,
          turn: 1,
        },
        type: 'reasoning.summary.done',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 3,
        id: asEventId('evt_text_delta'),
        payload: {
          delta: 'The tool completed successfully.',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          threadId,
          turn: 1,
        },
        type: 'stream.delta',
      }),
    ])

    expect(blocks).toMatchObject([
      {
        content: 'Need tool output before answering.',
        id: 'thinking:rs_reasoning_1',
        status: 'done',
        title: 'reasoning',
        type: 'thinking',
      },
      {
        content: 'The tool completed successfully.',
        streaming: true,
        type: 'text',
      },
    ])
  })

  test('updates tool blocks in place when backend tool outcomes arrive', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'call_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_tool_called'),
        payload: {
          args: { quarter: 'Q1' },
          callId: 'call_1',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'sales.lookup',
        },
        type: 'tool.called',
      }),
      event({
        aggregateId: 'call_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_tool_completed'),
        payload: {
          callId: 'call_1',
          outcome: { rows: 3 },
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'sales.lookup',
        },
        type: 'tool.completed',
      }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'tool_interaction',
      toolCallId: 'call_1',
      name: 'sales.lookup',
      args: { quarter: 'Q1' },
      status: 'complete',
      output: { rows: 3 },
    })
  })

  test('treats failed sandbox execute outcomes inside tool.completed as error blocks', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'call_execute_fail_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_execute_fail_called'),
        payload: {
          args: { task: 'Resize image' },
          callId: 'call_execute_fail_1',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'execute',
        },
        type: 'tool.called',
      }),
      event({
        aggregateId: 'call_execute_fail_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_execute_fail_completed'),
        payload: {
          callId: 'call_execute_fail_1',
          outcome: {
            effectiveNetworkMode: 'off',
            failure: {
              phase: 'script_execution',
              runner: 'local_dev',
              summary: 'Sandbox script execution failed with exit code 1',
            },
            files: [],
            kind: 'sandbox_result',
            outputDir: '/output',
            sandboxExecutionId: 'sbx_execute_fail_1',
            status: 'failed',
            stderr: 'SyntaxError: Illegal return statement',
            stdout: null,
            writebacks: [],
          },
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'execute',
        },
        type: 'tool.completed',
      }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      args: { task: 'Resize image' },
      name: 'execute',
      output: {
        sandboxExecutionId: 'sbx_execute_fail_1',
        status: 'failed',
      },
      status: 'error',
      type: 'tool_interaction',
    })
  })

  test('preserves MCP app metadata from tool telemetry payloads', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'call_apps_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_tool_called_apps'),
        payload: {
          appsMeta: {
            resourceUri: 'ui://fixture/echo.html',
            serverId: 'mcs_fixture',
          },
          args: { value: 'hello' },
          callId: 'call_apps_1',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'fixture__echo',
        },
        type: 'tool.called',
      }),
      event({
        aggregateId: 'call_apps_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_tool_completed_apps'),
        payload: {
          appsMeta: {
            resourceUri: 'ui://fixture/echo.html',
            serverId: 'mcs_fixture',
          },
          callId: 'call_apps_1',
          outcome: { ok: true },
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'fixture__echo',
        },
        type: 'tool.completed',
      }),
    ])

    expect(blocks[0]).toMatchObject({
      appsMeta: {
        resourceUri: 'ui://fixture/echo.html',
        serverId: 'mcs_fixture',
      },
      name: 'fixture__echo',
      toolCallId: 'call_apps_1',
      type: 'tool_interaction',
    })
  })

  test('applies MCP app metadata from tool.completed payload when tool.called had none', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'call_apps_dynamic_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_tool_called_apps_dynamic'),
        payload: {
          args: {},
          callId: 'call_apps_dynamic_1',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'fixture__dynamic_ui',
        },
        type: 'tool.called',
      }),
      event({
        aggregateId: 'call_apps_dynamic_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_tool_completed_apps_dynamic'),
        payload: {
          appsMeta: {
            resourceUri: 'ui://fixture/dynamic.html',
            serverId: 'mcs_fixture',
          },
          callId: 'call_apps_dynamic_1',
          outcome: {
            content: [{ text: 'dynamic', type: 'text' }],
            meta: {
              ui: {
                resourceUri: 'ui://fixture/dynamic.html',
              },
            },
            ok: true,
            structuredContent: null,
          },
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'fixture__dynamic_ui',
        },
        type: 'tool.completed',
      }),
    ])

    expect(blocks[0]).toMatchObject({
      appsMeta: {
        resourceUri: 'ui://fixture/dynamic.html',
        serverId: 'mcs_fixture',
      },
      name: 'fixture__dynamic_ui',
      status: 'complete',
      toolCallId: 'call_apps_dynamic_1',
      type: 'tool_interaction',
    })
  })

  test('updates a web search block in place as search telemetry progresses', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_search_started'),
        payload: {
          patterns: [],
          provider: 'openai',
          queries: [],
          references: [],
          responseId: 'resp_1',
          runId,
          searchId: 'web_search:resp_1',
          sessionId: 'ses_1',
          status: 'searching',
          targetUrls: [],
          threadId,
          turn: 1,
        },
        type: 'web_search.progress',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_search_completed'),
        payload: {
          patterns: [],
          provider: 'openai',
          queries: ['cursor ide web search'],
          references: [
            {
              domain: 'platform.openai.com',
              title: 'OpenAI web search guide',
              url: 'https://platform.openai.com/docs/guides/tools-web-search',
            },
          ],
          responseId: 'resp_1',
          runId,
          searchId: 'web_search:resp_1',
          sessionId: 'ses_1',
          status: 'completed',
          targetUrls: [],
          threadId,
          turn: 1,
        },
        type: 'web_search.progress',
      }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'web_search',
      provider: 'openai',
      queries: ['cursor ide web search'],
      references: [
        {
          title: 'OpenAI web search guide',
          url: 'https://platform.openai.com/docs/guides/tools-web-search',
        },
      ],
      searchId: 'web_search:resp_1',
      status: 'completed',
    })
  })

  test('preserves completed web search details when a later sparse update arrives', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_search_completed_first'),
        payload: {
          patterns: ['battery'],
          provider: 'openai',
          queries: ['airpods max 2 apple official'],
          references: [
            {
              domain: 'www.apple.com',
              title: 'Apple introduces AirPods Max 2 - Apple',
              url: 'https://www.apple.com/newsroom/2026/03/apple-introduces-airpods-max-2-powered-by-h2/',
            },
          ],
          responseId: 'resp_1',
          runId,
          searchId: 'ws_1',
          sessionId: 'ses_1',
          status: 'completed',
          targetUrls: [
            'https://www.apple.com/newsroom/2026/03/apple-introduces-airpods-max-2-powered-by-h2/',
          ],
          threadId,
          turn: 1,
        },
        type: 'web_search.progress',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_reasoning_after_search'),
        payload: {
          delta: 'Need one more verification step.',
          itemId: 'rs_reasoning_2',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          text: 'Need one more verification step.',
          threadId,
          turn: 1,
        },
        type: 'reasoning.summary.delta',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 3,
        id: asEventId('evt_late_sparse_search_update'),
        payload: {
          patterns: [],
          provider: 'openai',
          queries: [],
          references: [],
          responseId: 'resp_1',
          runId,
          searchId: 'ws_1',
          sessionId: 'ses_1',
          status: 'searching',
          targetUrls: [],
          threadId,
          turn: 1,
        },
        type: 'web_search.progress',
      }),
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({
      type: 'web_search',
      queries: ['airpods max 2 apple official'],
      patterns: ['battery'],
      references: [
        {
          title: 'Apple introduces AirPods Max 2 - Apple',
        },
      ],
      searchId: 'ws_1',
      status: 'completed',
      targetUrls: [
        'https://www.apple.com/newsroom/2026/03/apple-introduces-airpods-max-2-powered-by-h2/',
      ],
    })
    expect(blocks[1]).toMatchObject({
      content: 'Need one more verification step.',
      id: 'thinking:rs_reasoning_2',
      status: 'thinking',
      type: 'thinking',
    })
  })

  test('materializes confirmation requests from backend tool events', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'call_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_confirmation_requested'),
        payload: {
          args: { value: 'hello' },
          callId: 'call_1',
          description: 'Confirmation required before running echo',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'mcp.echo',
          waitId: 'wte_1',
          waitTargetKind: 'human_response',
          waitTargetRef: 'mcp.echo',
          waitType: 'human',
        },
        type: 'tool.confirmation_requested',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_waiting'),
        payload: {
          pendingWaits: [
            {
              args: { value: 'hello' },
              callId: 'call_1',
              createdAt: at,
              description: 'Confirmation required before running echo',
              requiresApproval: true,
              targetKind: 'human_response',
              targetRef: 'mcp.echo',
              tool: 'mcp.echo',
              type: 'human',
              waitId: 'wte_1',
            },
          ],
          runId,
          sessionId: 'ses_1',
          status: 'waiting',
          threadId,
          waitIds: ['wte_1'],
        },
        type: 'run.waiting',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 3,
        id: asEventId('evt_failed'),
        payload: {
          error: {
            message: 'Tool execution failed',
            type: 'conflict',
          },
          runId,
          sessionId: 'ses_1',
          status: 'failed',
          threadId,
        },
        type: 'run.failed',
      }),
    ])

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({
      type: 'tool_interaction',
      toolCallId: 'call_1',
      name: 'mcp.echo',
      args: { value: 'hello' },
      status: 'error',
      confirmation: undefined,
    })
    expect(blocks[1]).toMatchObject({
      type: 'error',
      message: 'Tool execution failed',
    })
  })

  test('tool.called arriving after tool.confirmation_requested merges into the existing block', () => {
    const blocks: ReturnType<typeof materializeBlocks> = []
    const toolIndex = new Map<string, number>()

    // 1. tool.confirmation_requested arrives first (out-of-order)
    applyEvent(
      blocks,
      event({
        aggregateId: 'call_ooo_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_ooo_confirmation'),
        payload: {
          args: { query: 'weather' },
          callId: 'call_ooo_1',
          description: 'Allow weather lookup?',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'weather.lookup',
          waitId: 'wte_ooo_1',
          waitTargetKind: 'human_response',
          waitTargetRef: 'weather.lookup',
          waitType: 'human',
        },
        type: 'tool.confirmation_requested',
      }),
      toolIndex,
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      args: { query: 'weather' },
      name: 'weather.lookup',
      status: 'awaiting_confirmation',
      type: 'tool_interaction',
    })

    // 2. tool.called arrives late — should merge, not duplicate
    applyEvent(
      blocks,
      event({
        aggregateId: 'call_ooo_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_ooo_called'),
        payload: {
          args: { query: 'weather' },
          callId: 'call_ooo_1',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'weather.lookup',
        },
        type: 'tool.called',
      }),
      toolIndex,
    )

    // Still only one block, confirmation state preserved
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      args: { query: 'weather' },
      name: 'weather.lookup',
      status: 'awaiting_confirmation',
      toolCallId: 'call_ooo_1',
      type: 'tool_interaction',
    })
    expect((blocks[0] as ToolInteractionBlock).confirmation).toBeDefined()
  })

  test('materializes human-response waits without approval as generic waiting blocks', () => {
    const blocks = materializePendingWaitBlocks([
      {
        args: null,
        callId: 'call_ask_user',
        createdAt: at,
        description: 'Need the exact migration step from the user.',
        requiresApproval: false,
        targetKind: 'human_response',
        targetRef: 'user_response',
        tool: 'suspend_run',
        type: 'human',
        waitId: 'wte_reply_1',
      },
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'thinking',
      title: 'Waiting for reply',
      content: 'Need the exact migration step from the user.',
      status: 'done',
    })
  })

  test('materializes persisted tool transcript metadata into durable assistant blocks', () => {
    const blocks = materializePersistedAssistantBlocks('The MCP echoed hello.', at, {
      transcript: {
        toolBlocks: [
          {
            approval: {
              description: 'Confirmation required before running echo',
              remembered: true,
              status: 'approved',
              targetRef: 'mcp.echo',
              waitId: 'wte_1',
            },
            args: { value: 'hello' },
            appsMeta: {
              resourceUri: 'ui://fixture/echo.html',
              serverId: 'mcs_fixture',
            },
            createdAt: at,
            finishedAt: at,
            id: 'tool:call_1',
            name: 'mcp.echo',
            output: { echoed: 'hello' },
            status: 'complete',
            toolCallId: 'call_1',
            type: 'tool_interaction',
          },
        ],
        version: 1,
      },
    })

    expect(blocks).toMatchObject([
      {
        approval: {
          remembered: true,
          status: 'approved',
          targetRef: 'mcp.echo',
          waitId: 'wte_1',
        },
        args: { value: 'hello' },
        appsMeta: {
          resourceUri: 'ui://fixture/echo.html',
          serverId: 'mcs_fixture',
        },
        name: 'mcp.echo',
        output: { echoed: 'hello' },
        status: 'complete',
        type: 'tool_interaction',
      },
      {
        content: 'The MCP echoed hello.',
        streaming: false,
        type: 'text',
      },
    ])
  })

  test('materializes persisted web search transcript metadata into durable assistant blocks', () => {
    const blocks = materializePersistedAssistantBlocks(
      'The model checked the official guide.',
      at,
      {
        transcript: {
          toolBlocks: [],
          version: 1,
          webSearchBlocks: [
            {
              createdAt: at,
              finishedAt: at,
              id: 'web_search:web_search:resp_1',
              patterns: [],
              provider: 'openai',
              queries: ['cursor ide web search'],
              references: [
                {
                  domain: 'platform.openai.com',
                  title: 'OpenAI web search guide',
                  url: 'https://platform.openai.com/docs/guides/tools-web-search',
                },
              ],
              responseId: 'resp_1',
              searchId: 'web_search:resp_1',
              status: 'completed',
              targetUrls: [],
              type: 'web_search',
            },
          ],
        },
      },
    )

    expect(blocks).toMatchObject([
      {
        provider: 'openai',
        queries: ['cursor ide web search'],
        references: [
          {
            title: 'OpenAI web search guide',
            url: 'https://platform.openai.com/docs/guides/tools-web-search',
          },
        ],
        searchId: 'web_search:resp_1',
        status: 'completed',
        type: 'web_search',
      },
      {
        content: 'The model checked the official guide.',
        streaming: false,
        type: 'text',
      },
    ])
  })

  test('materializes ordered transcript blocks from version 2 metadata', () => {
    const blocks = materializePersistedAssistantBlocks('The tool completed successfully.', at, {
      transcript: {
        blocks: [
          {
            content: 'Need the tool result before answering.',
            createdAt: at,
            id: 'thinking:rs_reasoning_1',
            status: 'done',
            title: 'reasoning',
            type: 'thinking',
          },
          {
            args: { value: 'hello' },
            createdAt: at,
            finishedAt: at,
            id: 'tool:call_1',
            name: 'mcp.echo',
            output: { echoed: 'hello' },
            status: 'complete',
            toolCallId: 'call_1',
            type: 'tool_interaction',
          },
          {
            createdAt: at,
            finishedAt: at,
            id: 'web_search:web_search:resp_1',
            patterns: [],
            provider: 'openai',
            queries: ['openai reasoning summary'],
            references: [],
            responseId: 'resp_1',
            searchId: 'web_search:resp_1',
            status: 'completed',
            targetUrls: [],
            type: 'web_search',
          },
        ],
        toolBlocks: [],
        version: 2,
        webSearchBlocks: [],
      },
    })

    expect(blocks).toMatchObject([
      {
        content: 'Need the tool result before answering.',
        id: 'thinking:rs_reasoning_1',
        type: 'thinking',
      },
      {
        name: 'mcp.echo',
        output: { echoed: 'hello' },
        type: 'tool_interaction',
      },
      {
        queries: ['openai reasoning summary'],
        type: 'web_search',
      },
      {
        content: 'The tool completed successfully.',
        type: 'text',
      },
    ])
  })

  test('materializes persisted child text blocks from version 2 metadata', () => {
    const blocks = materializePersistedAssistantBlocks('Parent summary after delegation.', at, {
      transcript: {
        blocks: [
          {
            args: { agentAlias: 'researcher', task: 'Validate the migration plan' },
            childRunId: 'run_child',
            createdAt: at,
            finishedAt: at,
            id: 'tool:call_delegate_root',
            name: 'delegate_to_agent',
            output: { kind: 'completed', summary: 'Researcher validated the plan.' },
            status: 'complete',
            toolCallId: 'call_delegate_root',
            type: 'tool_interaction',
          },
          {
            content: 'Researcher says the additive migration strategy is safe.',
            createdAt: at,
            id: 'text:run_child:persisted',
            sourceRunId: 'run_child',
            type: 'text',
          },
        ],
        toolBlocks: [],
        version: 2,
        webSearchBlocks: [],
      },
    })

    expect(blocks).toMatchObject([
      {
        childRunId: 'run_child',
        toolCallId: 'call_delegate_root',
        type: 'tool_interaction',
      },
      {
        content: 'Researcher says the additive migration strategy is safe.',
        sourceRunId: 'run_child',
        streaming: false,
        type: 'text',
      },
      {
        content: 'Parent summary after delegation.',
        streaming: false,
        type: 'text',
      },
    ])
  })

  test('ignores duplicate backend event ids when applying incrementally', () => {
    const blocks = [] as ReturnType<typeof materializeBlocks>
    const seenIds = new Set<string>()

    const first = applyEvent(
      blocks,
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_duplicate'),
        payload: {
          delta: 'Hello',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          threadId,
          turn: 1,
        },
        type: 'stream.delta',
      }),
      new Map(),
      seenIds,
    )

    const second = applyEvent(
      blocks,
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_duplicate'),
        payload: {
          delta: 'Hello',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          threadId,
          turn: 1,
        },
        type: 'stream.delta',
      }),
      new Map(),
      seenIds,
    )

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(blocks[0]).toMatchObject({
      type: 'text',
      content: 'Hello',
    })
  })

  test('tool.waiting does not add transcript blocks (running tool row is the UI anchor)', () => {
    const blocks: ReturnType<typeof materializeBlocks> = []
    const toolIndex = new Map<string, number>()

    applyEvent(
      blocks,
      event({
        aggregateId: 'call_w',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 50,
        id: asEventId('evt_tool_waiting'),
        payload: {
          callId: 'call_w',
          description: null,
          runId,
          sessionId: asSessionId('ses_1'),
          threadId,
          tool: 'fetch_report',
          waitId: 'wte_w',
          waitTargetKind: 'external',
          waitTargetRef: 'job_123',
          waitType: 'tool',
        },
        type: 'tool.waiting',
      }),
      toolIndex,
    )

    expect(blocks).toEqual([])
  })

  test('wait.timed_out appends a user-visible error block', () => {
    const blocks: ReturnType<typeof materializeBlocks> = []
    const toolIndex = new Map<string, number>()

    applyEvent(
      blocks,
      event({
        aggregateId: 'wte_to',
        aggregateType: 'wait_entry',
        createdAt: at,
        eventNo: 51,
        id: asEventId('evt_wait_timed_out'),
        payload: {
          callId: 'call_w',
          error: 'Wait timed out for external job',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId,
          timedOutAt: at,
          timeoutAt: null,
          tool: 'fetch_report',
          waitId: 'wte_w',
          waitTargetKind: 'external',
          waitTargetRef: 'job_123',
          waitType: 'tool',
        },
        type: 'wait.timed_out',
      }),
      toolIndex,
    )

    expect(blocks).toMatchObject([
      {
        message: 'Wait timed out for external job',
        type: 'error',
      },
    ])
  })

  test('child_run.completed and run.requeued are ignored for transcript materialization', () => {
    const blocks: ReturnType<typeof materializeBlocks> = []
    const toolIndex = new Map<string, number>()

    applyEvent(
      blocks,
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 52,
        id: asEventId('evt_child_done'),
        payload: {
          childRunId: asRunId('run_child'),
          parentRunId: runId,
          resultKind: 'completed',
          rootRunId: runId,
          runId,
          sessionId: asSessionId('ses_1'),
          threadId,
          waitId: 'wte_c',
        },
        type: 'child_run.completed',
      }),
      toolIndex,
    )

    applyEvent(
      blocks,
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 53,
        id: asEventId('evt_requeued'),
        payload: {
          reason: 'process_restarted',
          recoveredFromStatus: 'running',
          runId,
          sessionId: asSessionId('ses_1'),
          status: 'pending',
          threadId,
        },
        type: 'run.requeued',
      }),
      toolIndex,
    )

    expect(blocks).toEqual([])
  })

  test('wait.timed_out on a human confirmation clears the tool status and appends an error', () => {
    const blocks: ReturnType<typeof materializeBlocks> = []
    const toolIndex = new Map<string, number>()

    // 1. tool.called
    applyEvent(
      blocks,
      event({
        aggregateId: 'call_confirm_timeout',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 60,
        id: asEventId('evt_tool_called_confirm_timeout'),
        payload: {
          args: { action: 'play_track' },
          callId: 'call_confirm_timeout',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId,
          tool: 'spotify__spotify_control',
        },
        type: 'tool.called',
      }),
      toolIndex,
    )

    // 2. tool.confirmation_requested (human wait)
    applyEvent(
      blocks,
      event({
        aggregateId: 'call_confirm_timeout',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 61,
        id: asEventId('evt_confirm_requested_timeout'),
        payload: {
          args: { action: 'play_track' },
          callId: 'call_confirm_timeout',
          description: 'Approve playback on the device?',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId,
          tool: 'spotify__spotify_control',
          waitId: 'wte_confirm_timeout',
          waitTargetKind: 'human_response',
          waitTargetRef: 'spotify__spotify_control',
          waitType: 'human',
        },
        type: 'tool.confirmation_requested',
      }),
      toolIndex,
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      status: 'awaiting_confirmation',
      confirmation: {
        waitId: 'wte_confirm_timeout',
      },
    })

    // 3. wait.timed_out
    applyEvent(
      blocks,
      event({
        aggregateId: 'wte_confirm_timeout',
        aggregateType: 'wait_entry',
        createdAt: at,
        eventNo: 62,
        id: asEventId('evt_confirm_timed_out'),
        payload: {
          callId: 'call_confirm_timeout',
          error: 'Confirmation timed out after 300s',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId,
          timedOutAt: at,
          timeoutAt: null,
          tool: 'spotify__spotify_control',
          waitId: 'wte_confirm_timeout',
          waitTargetKind: 'human_response',
          waitTargetRef: 'spotify__spotify_control',
          waitType: 'human',
        },
        type: 'wait.timed_out',
      }),
      toolIndex,
    )

    // The error block should be appended after the tool block
    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toMatchObject({
      type: 'error',
      message: 'Confirmation timed out after 300s',
    })
  })

  test('run.cancelled closes active tool and web search blocks for that run', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_cancel_text'),
        payload: {
          delta: 'Searching now',
          runId,
          sessionId: 'ses_1',
          status: 'running',
          threadId,
          turn: 1,
        },
        type: 'stream.delta',
      }),
      event({
        aggregateId: 'tool_call_cancel',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_cancel_tool_called'),
        payload: {
          args: { query: 'spotify album' },
          callId: 'call_cancel_tool',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'spotify__search_catalog',
        },
        type: 'tool.called',
      }),
      event({
        aggregateId: 'search_cancel_1',
        aggregateType: 'web_search',
        createdAt: at,
        eventNo: 3,
        id: asEventId('evt_cancel_search_progress'),
        payload: {
          patterns: [],
          provider: 'openai',
          queries: ['spotify album'],
          references: [],
          responseId: null,
          runId,
          searchId: 'search_cancel_1',
          sessionId: 'ses_1',
          status: 'searching',
          targetUrls: [],
          threadId,
        },
        type: 'web_search.progress',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 4,
        id: asEventId('evt_cancel_run'),
        payload: {
          runId,
          sessionId: 'ses_1',
          status: 'cancelled',
          threadId,
        },
        type: 'run.cancelled',
      }),
    ])

    expect(blocks).toMatchObject([
      {
        type: 'text',
        streaming: false,
      },
      {
        name: 'spotify__search_catalog',
        status: 'error',
        type: 'tool_interaction',
      },
      {
        status: 'failed',
        type: 'web_search',
      },
    ])
  })

  test('run.completed closes active tool and web search blocks for that run', () => {
    const blocks = materializeBlocks([
      event({
        aggregateId: 'tool_call_complete',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_complete_tool_called'),
        payload: {
          args: { query: 'spotify album' },
          callId: 'call_complete_tool',
          runId,
          sessionId: 'ses_1',
          threadId,
          tool: 'spotify__search_catalog',
        },
        type: 'tool.called',
      }),
      event({
        aggregateId: 'search_complete_1',
        aggregateType: 'web_search',
        createdAt: at,
        eventNo: 2,
        id: asEventId('evt_complete_search_progress'),
        payload: {
          patterns: [],
          provider: 'openai',
          queries: ['spotify album'],
          references: [],
          responseId: null,
          runId,
          searchId: 'search_complete_1',
          sessionId: 'ses_1',
          status: 'searching',
          targetUrls: [],
          threadId,
        },
        type: 'web_search.progress',
      }),
      event({
        aggregateId: 'run_1',
        aggregateType: 'run',
        createdAt: at,
        eventNo: 3,
        id: asEventId('evt_complete_run'),
        payload: {
          outputText: '',
          runId,
          sessionId: 'ses_1',
          status: 'completed',
          threadId,
        },
        type: 'run.completed',
      }),
    ])

    expect(blocks).toMatchObject([
      {
        finishedAt: at,
        name: 'spotify__search_catalog',
        status: 'complete',
        type: 'tool_interaction',
      },
      {
        finishedAt: at,
        status: 'completed',
        type: 'web_search',
      },
    ])
  })

  test('tool.waiting sets childRunId on an existing delegation tool block', () => {
    const blocks: ReturnType<typeof materializeBlocks> = []
    const toolIndex = new Map<string, number>()

    applyEvent(
      blocks,
      event({
        aggregateId: 'call_deleg',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 70,
        id: asEventId('evt_deleg_called'),
        payload: {
          args: { agentAlias: 'tony', task: 'Play music' },
          callId: 'call_deleg',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId,
          tool: 'delegate_to_agent',
        },
        type: 'tool.called',
      }),
      toolIndex,
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'tool_interaction',
      name: 'delegate_to_agent',
    })
    expect((blocks[0] as { childRunId?: string }).childRunId).toBeUndefined()

    applyEvent(
      blocks,
      event({
        aggregateId: 'call_deleg',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 71,
        id: asEventId('evt_deleg_waiting'),
        payload: {
          args: { agentAlias: 'tony', task: 'Play music' },
          callId: 'call_deleg',
          description: 'Waiting for delegated child agent "tony"',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId,
          tool: 'delegate_to_agent',
          waitId: 'wte_deleg',
          waitTargetKind: 'run',
          waitTargetRef: 'tony:run_child',
          waitTargetRunId: 'run_child_tony',
          waitType: 'agent',
        },
        type: 'tool.waiting',
      }),
      toolIndex,
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'tool_interaction',
      name: 'delegate_to_agent',
      childRunId: 'run_child_tony',
    })
  })
})
