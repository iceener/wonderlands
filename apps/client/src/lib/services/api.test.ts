import {
  asAgentId,
  asGardenBuildId,
  asGardenSiteId,
  asMessageId,
  asRunId,
  asSessionId,
  asThreadId,
  asToolProfileId,
  type BackendAccountPreferences,
  type BackendAgentDetail,
  type BackendAgentSummary,
  type BackendEvent,
  type BackendGardenBuild,
  type BackendGardenSite,
  type BackendGardenSourceBootstrapResult,
  type BackendModelsCatalog,
  type BackendSession,
  type BackendThread,
  type BackendThreadMessage,
  type BackendToolProfile,
  type BootstrapSessionOutput,
  type ResumeRunOutput,
  type StartThreadInteractionOutput,
} from '@wonderlands/contracts/chat'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  assignMcpTool,
  bootstrapGardenSource,
  bootstrapSession,
  branchThread,
  cancelRun,
  createAgent,
  createGardenSite,
  createMcpServer,
  createSession,
  createSessionThread,
  createToolProfile,
  deleteAgent,
  deleteMcpServer,
  deleteMcpToolAssignment,
  deleteThread,
  getAccountPreferences,
  getAgent,
  getAgentMarkdown,
  getGardenSite,
  getMcpServerTools,
  getSupportedModels,
  getSystemRuntimeStatus,
  getThreadMemory,
  getToolProfile,
  listAgents,
  listGardenBuilds,
  listGardens,
  listMcpServers,
  listThreadMessages,
  listThreads,
  listToolProfiles,
  markThreadActivitySeen,
  publishGarden,
  refreshMcpServer,
  renameAgent,
  renameThread,
  replayRunEvents,
  requestGardenBuild,
  resumeRun,
  startThreadInteraction,
  streamTenantEvents,
  streamThreadEvents,
  updateAccountPreferences,
  updateAgent,
  updateAgentMarkdown,
  updateGardenSite,
  updateMcpServer,
  updateThreadMemory,
  updateToolProfile,
} from './api'
import { setApiTenantId } from './backend'

const originalFetch = globalThis.fetch
const encoder = new TextEncoder()

const createPendingSseResponse = (): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(''))
      },
    }),
    {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    },
  )

const parseJsonRequestBody = (init?: RequestInit): unknown =>
  typeof init?.body === 'string' ? JSON.parse(init.body) : null

beforeEach(() => {
  setApiTenantId('ten_overment')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  setApiTenantId(null)
})

describe('api service', () => {
  test('bootstraps a session through the backend envelope contract', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody: BootstrapSessionOutput = {
      assistantItemId: 'itm_bootstrap',
      assistantMessageId: asMessageId('msg_assistant_bootstrap'),
      inputMessageId: asMessageId('msg_bootstrap'),
      model: 'gpt-5.4',
      outputText: 'Plan the first backend milestone.',
      provider: 'openai',
      responseId: 'resp_bootstrap',
      runId: asRunId('run_bootstrap'),
      sessionId: asSessionId('ses_bootstrap'),
      status: 'completed',
      threadId: asThreadId('thr_bootstrap'),
      usage: null,
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_1', traceId: 'trace_1' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      bootstrapSession({
        initialMessage: 'Plan the first backend milestone',
        title: 'Milestone planning',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('/api/sessions/bootstrap')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        initialMessage: 'Plan the first backend milestone',
        title: 'Milestone planning',
        execute: true,
      }),
    })
    expect(new Headers(requests[0]?.init?.headers).get('content-type')).toBe('application/json')
    expect(new Headers(requests[0]?.init?.headers).get('x-tenant-id')).toBe('ten_overment')
  })

  test('reads durable thread messages from the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const messages: BackendThreadMessage[] = [
      {
        authorAccountId: 'acc_adam_overment',
        authorKind: 'user',
        content: [{ text: 'Hello', type: 'text' }],
        createdAt: '2026-03-29T12:00:00.000Z',
        id: asMessageId('msg_1'),
        metadata: null,
        runId: null,
        sequence: 1,
        sessionId: asSessionId('ses_1'),
        tenantId: 'ten_overment',
        threadId: asThreadId('thr_1'),
      },
    ]

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: messages,
          meta: { requestId: 'req_2', traceId: 'trace_2' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(listThreadMessages(asThreadId('thr_1'))).resolves.toEqual(messages)
    expect(requests[0]?.url).toBe('/api/threads/thr_1/messages')
    expect(requests[0]?.init?.method).toBeUndefined()
    expect(requests[0]?.init?.credentials).toBe('include')
  })

  test('lists recent threads through the backend envelope contract', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const threads: BackendThread[] = [
      {
        createdAt: '2026-03-29T12:00:00.000Z',
        createdByAccountId: 'acc_adam_overment',
        id: asThreadId('thr_2'),
        parentThreadId: null,
        sessionId: asSessionId('ses_2'),
        status: 'active',
        tenantId: 'ten_overment',
        title: 'Recent thread',
        updatedAt: '2026-03-30T10:00:00.000Z',
      },
    ]

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: { threads },
          meta: { requestId: 'req_threads', traceId: 'trace_threads' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(listThreads()).resolves.toEqual(threads)
    expect(requests[0]?.url).toBe('/api/threads?limit=50')
    expect(requests[0]?.init?.credentials).toBe('include')
  })

  test('branches a thread from a durable assistant message', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const thread: BackendThread = {
      branchFromMessageId: asMessageId('msg_branch_from'),
      branchFromSequence: 4,
      createdAt: '2026-03-30T11:00:00.000Z',
      createdByAccountId: 'acc_adam_overment',
      id: asThreadId('thr_branch'),
      parentThreadId: asThreadId('thr_source'),
      sessionId: asSessionId('ses_branch'),
      status: 'active',
      tenantId: 'ten_overment',
      title: 'Backend thread',
      updatedAt: '2026-03-30T11:00:00.000Z',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: thread,
          meta: { requestId: 'req_branch', traceId: 'trace_branch' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      branchThread(asThreadId('thr_source'), {
        sourceMessageId: asMessageId('msg_branch_from'),
      }),
    ).resolves.toEqual(thread)

    expect(requests[0]?.url).toBe('/api/threads/thr_source/branches')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        sourceMessageId: 'msg_branch_from',
      }),
    })
  })

  test('passes the conversation search query through the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: { threads: [] },
          meta: { requestId: 'req_threads_search', traceId: 'trace_threads_search' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(listThreads({ limit: 25, query: 'plan backend' })).resolves.toEqual([])
    expect(requests[0]?.url).toBe('/api/threads?limit=25&query=plan+backend')
    expect(requests[0]?.init?.credentials).toBe('include')
  })

  test('marks thread activity as seen without waiting for a response body', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(null, {
        status: 204,
      })
    }) as typeof fetch

    await expect(markThreadActivitySeen(asThreadId('thr_seen'))).resolves.toBeUndefined()
    expect(requests[0]?.url).toBe('/api/threads/thr_seen/activity/seen')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
    })
  })

  test('renames a thread through the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const thread: BackendThread = {
      createdAt: '2026-03-29T12:00:00.000Z',
      createdByAccountId: 'acc_adam_overment',
      id: asThreadId('thr_rename'),
      parentThreadId: null,
      sessionId: asSessionId('ses_rename'),
      status: 'active',
      tenantId: 'ten_overment',
      title: 'Renamed thread',
      updatedAt: '2026-03-30T10:00:00.000Z',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: thread,
          meta: { requestId: 'req_patch', traceId: 'trace_patch' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(renameThread(asThreadId('thr_rename'), 'Renamed thread')).resolves.toEqual(thread)
    expect(requests[0]?.url).toBe('/api/threads/thr_rename')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Renamed thread',
      }),
    })
  })

  test('reads thread memory through the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const memory = {
      observations: [
        {
          content: {
            observations: [{ text: 'Observation body' }],
            source: 'observer_v1' as const,
          },
          createdAt: '2026-03-30T10:00:00.000Z',
          id: 'mrec_obs_1',
          kind: 'observation' as const,
          tokenCount: 42,
        },
      ],
      reflection: {
        content: {
          reflection: 'Reflection body',
          source: 'reflector_v1' as const,
        },
        createdAt: '2026-03-30T10:05:00.000Z',
        generation: 2,
        id: 'mrec_ref_1',
        kind: 'reflection' as const,
        tokenCount: 51,
      },
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: memory,
          meta: { requestId: 'req_memory', traceId: 'trace_memory' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(getThreadMemory(asThreadId('thr_memory'))).resolves.toEqual(memory)
    expect(requests[0]?.url).toBe('/api/threads/thr_memory/memory')
    expect(requests[0]?.init?.method).toBeUndefined()
    expect(requests[0]?.init?.credentials).toBe('include')
  })

  test('updates thread memory through the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const updatedRecord = {
      content: {
        observations: [{ text: '**Edited** observation' }],
        source: 'observer_v1' as const,
      },
      createdAt: '2026-03-30T10:00:00.000Z',
      id: 'mrec_obs_1',
      kind: 'observation' as const,
      tokenCount: 48,
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: {
            record: updatedRecord,
          },
          meta: { requestId: 'req_memory_patch', traceId: 'trace_memory_patch' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(
      updateThreadMemory(asThreadId('thr_memory'), 'mrec_obs_1', {
        kind: 'observation',
        observations: [{ text: '**Edited** observation' }],
      }),
    ).resolves.toEqual(updatedRecord)

    expect(requests[0]?.url).toBe('/api/threads/thr_memory/memory/mrec_obs_1')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'PATCH',
      body: JSON.stringify({
        kind: 'observation',
        observations: [{ text: '**Edited** observation' }],
      }),
    })
  })

  test('deletes a thread through the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: {
            deleted: true,
            threadId: 'thr_delete',
          },
          meta: { requestId: 'req_delete', traceId: 'trace_delete' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(deleteThread(asThreadId('thr_delete'))).resolves.toBeUndefined()
    expect(requests[0]?.url).toBe('/api/threads/thr_delete')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'DELETE',
    })
  })

  test('reads the supported models catalog from the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const catalog: BackendModelsCatalog = {
      aliases: [
        {
          alias: 'default',
          configured: true,
          isDefault: true,
          model: 'gemini-2.5-flash',
          provider: 'google',
          reasoningModes: ['none'],
          supportsReasoning: true,
        },
        {
          alias: 'openai_default',
          configured: false,
          isDefault: false,
          model: 'gpt-5.4',
          provider: 'openai',
          reasoningModes: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
          supportsReasoning: true,
        },
      ],
      defaultAlias: 'default',
      defaultModel: 'gemini-2.5-flash',
      defaultProvider: 'google',
      providers: {
        google: {
          configured: true,
          defaultModel: 'gemini-2.5-flash',
        },
        openai: {
          configured: false,
          defaultModel: 'gpt-5.4',
        },
      },
      reasoningModes: [
        { effort: 'none', label: 'No reasoning' },
        { effort: 'minimal', label: 'Minimal' },
        { effort: 'low', label: 'Low' },
        { effort: 'medium', label: 'Medium' },
        { effort: 'high', label: 'High' },
        { effort: 'xhigh', label: 'Very high' },
      ],
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: catalog,
          meta: { requestId: 'req_models', traceId: 'trace_models' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(getSupportedModels()).resolves.toEqual(catalog)
    expect(requests[0]?.url).toBe('/api/system/models')
    expect(requests[0]?.init?.credentials).toBe('include')
  })

  test('lists agents through the backend route with the default filters', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const agents: BackendAgentSummary[] = [
      {
        activeRevisionId: 'rev_agent_1',
        activeRevisionVersion: 1,
        createdAt: '2026-03-30T12:00:00.000Z',
        description: 'Plans and coordinates work.',
        id: asAgentId('agt_1'),
        isDefaultForAccount: true,
        kind: 'primary',
        name: 'Planner',
        ownerAccountId: 'acc_1',
        slug: 'planner',
        status: 'active',
        updatedAt: '2026-03-30T12:00:00.000Z',
        visibility: 'account_private',
      },
    ]

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: agents,
          meta: { requestId: 'req_agents', traceId: 'trace_agents' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(listAgents()).resolves.toEqual(agents)
    expect(requests[0]?.url).toBe('/api/agents?limit=50&status=active')
  })

  test('reads a single agent detail through the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const detail: BackendAgentDetail = {
      activeRevision: {
        checksumSha256: 'abc123',
        createdAt: '2026-03-30T12:00:00.000Z',
        id: 'rev_agent_1',
        instructionsMd: 'Follow the plan.',
        kernelPolicyJson: { browser: { maxDurationSec: 90 }, enabled: true },
        modelConfigJson: { modelAlias: 'default', provider: 'openai' },
        sourceMarkdown: '---\nname: Planner\n---\n\nFollow the plan.',
        toolPolicyJson: { native: ['delegate_to_agent'] },
        version: 1,
      },
      activeRevisionId: 'rev_agent_1',
      activeRevisionVersion: 1,
      createdAt: '2026-03-30T12:00:00.000Z',
      description: 'Plans and coordinates work.',
      id: asAgentId('agt_1'),
      isDefaultForAccount: false,
      kind: 'primary',
      name: 'Planner',
      ownerAccountId: 'acc_1',
      slug: 'planner',
      status: 'active',
      subagents: [],
      updatedAt: '2026-03-30T12:00:00.000Z',
      visibility: 'account_private',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: detail,
          meta: { requestId: 'req_agent_detail', traceId: 'trace_agent_detail' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(getAgent(asAgentId('agt_1'))).resolves.toEqual(detail)
    expect(requests[0]?.url).toBe('/api/agents/agt_1')
  })

  test('creates, updates, renames, and deletes agents through the backend routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const detail: BackendAgentDetail = {
      activeRevision: {
        checksumSha256: 'abc123',
        createdAt: '2026-03-30T12:00:00.000Z',
        id: 'rev_agent_1',
        instructionsMd: 'Follow the plan.',
        kernelPolicyJson: { browser: { maxDurationSec: 90 }, enabled: true },
        modelConfigJson: { modelAlias: 'default', provider: 'openai' },
        sourceMarkdown: '---\nname: Planner\n---\n\nFollow the plan.',
        toolPolicyJson: { native: ['delegate_to_agent'] },
        version: 1,
      },
      activeRevisionId: 'rev_agent_1',
      activeRevisionVersion: 1,
      createdAt: '2026-03-30T12:00:00.000Z',
      description: 'Plans and coordinates work.',
      id: asAgentId('agt_1'),
      isDefaultForAccount: false,
      kind: 'primary',
      name: 'Planner',
      ownerAccountId: 'acc_1',
      slug: 'planner',
      status: 'active',
      subagents: [],
      updatedAt: '2026-03-30T12:00:00.000Z',
      visibility: 'account_private',
    }
    const summary: BackendAgentSummary = {
      activeRevisionId: 'rev_agent_1',
      activeRevisionVersion: 1,
      createdAt: '2026-03-30T12:00:00.000Z',
      description: 'Updated planning specialist.',
      id: asAgentId('agt_1'),
      isDefaultForAccount: false,
      kind: 'primary',
      name: 'Planner v2',
      ownerAccountId: 'acc_1',
      slug: 'planner',
      status: 'active',
      updatedAt: '2026-03-30T12:00:00.000Z',
      visibility: 'account_private',
    }
    const createPayload = {
      description: 'Plans and coordinates work.',
      instructionsMd: 'Follow the plan.',
      kind: 'primary' as const,
      kernel: {
        browser: { maxDurationSec: 90 },
        enabled: true,
      },
      model: {
        modelAlias: 'default',
        provider: 'openai' as const,
        reasoning: { effort: 'medium' as const },
      },
      name: 'Planner',
      slug: 'planner',
      subagents: [{ alias: 'tony', mode: 'async_join' as const, slug: 'tony' }],
      tools: { toolProfileId: null, native: ['delegate_to_agent'] },
      visibility: 'account_private' as const,
    }
    const updatePayload = {
      description: 'Plans and coordinates work.',
      instructionsMd: 'Follow the updated plan.',
      kind: 'primary' as const,
      kernel: {
        browser: { maxDurationSec: 90 },
        enabled: true,
      },
      model: {
        modelAlias: 'default',
        provider: 'openai' as const,
        reasoning: { effort: 'medium' as const },
      },
      name: 'Planner',
      revisionId: 'rev_agent_1',
      slug: 'planner',
      subagents: [{ alias: 'tony', mode: 'async_join' as const, slug: 'tony' }],
      tools: { toolProfileId: null, native: ['delegate_to_agent'] },
      visibility: 'account_private' as const,
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      const method = init?.method ?? 'GET'

      if (method === 'PATCH' && String(url) === '/api/account/preferences') {
        return new Response(
          JSON.stringify({
            data: {
              accountId: 'acc_1',
              assistantToolProfileId: 'tpf_assistant_1',
              defaultTarget: {
                agentId: 'agt_1',
                kind: 'agent',
              },
              shortcutBindings: {},
              updatedAt: '2026-03-30T12:05:00.000Z',
            },
            meta: { requestId: 'req_agent_default', traceId: 'trace_agent_default' },
            ok: true,
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        )
      }

      if (method === 'PATCH') {
        return new Response(
          JSON.stringify({
            data: summary,
            meta: { requestId: 'req_agent_patch', traceId: 'trace_agent_patch' },
            ok: true,
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        )
      }

      if (method === 'DELETE') {
        return new Response(
          JSON.stringify({
            data: { agentId: 'agt_1', deleted: true },
            meta: { requestId: 'req_agent_mutation', traceId: 'trace_agent_mutation' },
            ok: true,
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        )
      }

      return new Response(
        JSON.stringify({
          data: detail,
          meta: { requestId: 'req_agent_write', traceId: 'trace_agent_write' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: method === 'POST' ? 201 : 200,
        },
      )
    }) as typeof fetch

    await expect(createAgent(createPayload)).resolves.toEqual(detail)

    await expect(updateAgent(asAgentId('agt_1'), updatePayload)).resolves.toEqual(detail)

    await expect(renameAgent(asAgentId('agt_1'), 'Planner v2')).resolves.toEqual(summary)
    await expect(deleteAgent(asAgentId('agt_1'))).resolves.toBeUndefined()
    await expect(
      updateAccountPreferences({
        defaultTarget: {
          agentId: asAgentId('agt_1'),
          kind: 'agent',
        },
      }),
    ).resolves.toMatchObject({
      defaultTarget: {
        agentId: 'agt_1',
        kind: 'agent',
      },
    })

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['POST', '/api/agents'],
      ['PUT', '/api/agents/agt_1'],
      ['PATCH', '/api/agents/agt_1'],
      ['DELETE', '/api/agents/agt_1'],
      ['PATCH', '/api/account/preferences'],
    ])
    expect(parseJsonRequestBody(requests[0]?.init)).toEqual(createPayload)
    expect(parseJsonRequestBody(requests[1]?.init)).toEqual(updatePayload)
    expect(parseJsonRequestBody(requests[4]?.init)).toEqual({
      defaultTarget: {
        agentId: 'agt_1',
        kind: 'agent',
      },
    })
  })

  test('reads and updates account preferences through the backend routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody: BackendAccountPreferences = {
      accountId: 'acc_1',
      assistantToolProfileId: asToolProfileId('tpf_assistant_1'),
      defaultTarget: {
        agentId: asAgentId('agt_1'),
        kind: 'agent',
      },
      shortcutBindings: {},
      updatedAt: '2026-03-30T12:05:00.000Z',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_account_preferences', traceId: 'trace_account_preferences' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(getAccountPreferences()).resolves.toEqual(responseBody)
    await expect(
      updateAccountPreferences({
        defaultTarget: {
          kind: 'assistant',
        },
      }),
    ).resolves.toEqual(responseBody)

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', '/api/account/preferences'],
      ['PATCH', '/api/account/preferences'],
    ])
    expect(parseJsonRequestBody(requests[1]?.init)).toEqual({
      defaultTarget: {
        kind: 'assistant',
      },
    })
  })

  test('lists, reads, creates, and updates tool profiles through the backend routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const listResponse: BackendToolProfile[] = [
      {
        accountId: 'acc_1',
        createdAt: '2026-03-30T12:00:00.000Z',
        id: asToolProfileId('tpf_1'),
        name: 'Research Access',
        scope: 'account_private',
        status: 'active',
        tenantId: 'ten_1',
        updatedAt: '2026-03-30T12:00:00.000Z',
      },
    ]
    const detailResponse = listResponse[0]!
    const createdResponse: BackendToolProfile = {
      ...detailResponse,
      id: asToolProfileId('tpf_created'),
      name: 'Shared Research',
      scope: 'tenant_shared',
    }
    const updatedResponse: BackendToolProfile = {
      ...detailResponse,
      name: 'Research Access Archive',
      status: 'archived',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      const method = init?.method ?? 'GET'
      const data =
        method === 'POST'
          ? createdResponse
          : method === 'PATCH'
            ? updatedResponse
            : String(url).endsWith('/tpf_1')
              ? detailResponse
              : listResponse

      return new Response(
        JSON.stringify({
          data,
          meta: { requestId: 'req_tool_profiles', traceId: 'trace_tool_profiles' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: method === 'POST' ? 201 : 200,
        },
      )
    }) as typeof fetch

    await expect(listToolProfiles()).resolves.toEqual(listResponse)
    await expect(getToolProfile(asToolProfileId('tpf_1'))).resolves.toEqual(detailResponse)
    await expect(
      createToolProfile({
        name: 'Shared Research',
        scope: 'tenant_shared',
      }),
    ).resolves.toEqual(createdResponse)
    await expect(
      updateToolProfile(asToolProfileId('tpf_1'), {
        name: 'Research Access Archive',
        status: 'archived',
      }),
    ).resolves.toEqual(updatedResponse)

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', '/api/tool-profiles'],
      ['GET', '/api/tool-profiles/tpf_1'],
      ['POST', '/api/tool-profiles'],
      ['PATCH', '/api/tool-profiles/tpf_1'],
    ])
    expect(parseJsonRequestBody(requests[2]?.init)).toEqual({
      name: 'Shared Research',
      scope: 'tenant_shared',
    })
    expect(parseJsonRequestBody(requests[3]?.init)).toEqual({
      name: 'Research Access Archive',
      status: 'archived',
    })
  })

  test('lists, reads, creates, and updates garden sites through the backend routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const listResponse: BackendGardenSite[] = [
      {
        buildMode: 'manual',
        createdAt: '2026-04-03T10:00:00.000Z',
        createdByAccountId: 'acc_1',
        currentBuildId: null,
        currentPublishedBuildId: null,
        deployMode: 'api_hosted',
        id: asGardenSiteId('gst_1'),
        isDefault: false,
        name: 'Wonderlands Garden',
        protectedAccessMode: 'none',
        protectedSecretRef: null,
        protectedSessionTtlSeconds: 86400,
        slug: 'wonderlands',
        sourceScopePath: '.',
        status: 'draft',
        tenantId: 'ten_1',
        updatedAt: '2026-04-03T10:00:00.000Z',
        updatedByAccountId: 'acc_1',
      },
    ]
    const detailResponse = listResponse[0]!
    const createdResponse: BackendGardenSite = {
      ...detailResponse,
      id: asGardenSiteId('gst_created'),
      name: 'Field Notes',
      slug: 'field-notes',
      sourceScopePath: 'notes/public',
    }
    const updatedResponse: BackendGardenSite = {
      ...detailResponse,
      isDefault: true,
      protectedAccessMode: 'site_password',
      protectedSecretRef: 'scrypt_v1$hash',
      protectedSessionTtlSeconds: 7200,
      status: 'active',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      const method = init?.method ?? 'GET'
      const data =
        method === 'POST'
          ? createdResponse
          : method === 'PATCH'
            ? updatedResponse
            : String(url).endsWith('/gst_1')
              ? detailResponse
              : listResponse

      return new Response(
        JSON.stringify({
          data,
          meta: { requestId: 'req_gardens', traceId: 'trace_gardens' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: method === 'POST' ? 201 : 200,
        },
      )
    }) as typeof fetch

    await expect(listGardens()).resolves.toEqual(listResponse)
    await expect(getGardenSite(asGardenSiteId('gst_1'))).resolves.toEqual(detailResponse)
    await expect(
      createGardenSite({
        name: 'Field Notes',
        slug: 'field-notes',
        sourceScopePath: 'notes/public',
      }),
    ).resolves.toEqual(createdResponse)
    await expect(
      updateGardenSite(asGardenSiteId('gst_1'), {
        isDefault: true,
        protectedAccessMode: 'site_password',
        protectedSecretRef: 'scrypt_v1$hash',
        protectedSessionTtlSeconds: 7200,
        status: 'active',
      }),
    ).resolves.toEqual(updatedResponse)

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', '/api/gardens'],
      ['GET', '/api/gardens/gst_1'],
      ['POST', '/api/gardens'],
      ['PATCH', '/api/gardens/gst_1'],
    ])
    expect(parseJsonRequestBody(requests[2]?.init)).toEqual({
      name: 'Field Notes',
      slug: 'field-notes',
      sourceScopePath: 'notes/public',
    })
    expect(parseJsonRequestBody(requests[3]?.init)).toEqual({
      isDefault: true,
      protectedAccessMode: 'site_password',
      protectedSecretRef: 'scrypt_v1$hash',
      protectedSessionTtlSeconds: 7200,
      status: 'active',
    })
  })

  test('bootstraps a garden source through the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const bootstrapResponse: BackendGardenSourceBootstrapResult = {
      createdPaths: ['_garden.yml', 'index.md', 'public/'],
      skippedPaths: [],
      sourceScopePath: 'site',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })

      return new Response(
        JSON.stringify({
          data: bootstrapResponse,
          meta: { requestId: 'req_garden_bootstrap', traceId: 'trace_garden_bootstrap' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(bootstrapGardenSource(asGardenSiteId('gst_1'))).resolves.toEqual(bootstrapResponse)

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['POST', '/api/gardens/gst_1/bootstrap-source'],
    ])
  })

  test('lists garden builds, requests a build, and publishes a garden site through the backend routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const buildsResponse: BackendGardenBuild[] = [
      {
        completedAt: '2026-04-03T10:05:00.000Z',
        configFingerprintSha256: 'cfg_sha',
        createdAt: '2026-04-03T10:00:00.000Z',
        errorMessage: null,
        id: asGardenBuildId('gbd_1'),
        manifestJson: {
          assets: [{ artifactPath: 'public/app.css', sourcePath: 'public/app.css' }],
          pages: [
            {
              artifactPath: 'index.html',
              routePath: '/',
              sourcePath: 'index.md',
              sourceSlug: 'index',
              title: 'Home',
              visibility: 'public',
            },
          ],
          protectedPageCount: 0,
          publicPageCount: 1,
          sourceFingerprintSha256: 'src_sha',
          warnings: [],
        },
        protectedArtifactRoot: null,
        protectedPageCount: 0,
        publicArtifactRoot: '/tmp/garden/public',
        publicPageCount: 1,
        requestedByAccountId: 'acc_1',
        siteId: asGardenSiteId('gst_1'),
        sourceFingerprintSha256: 'src_sha',
        startedAt: '2026-04-03T10:00:01.000Z',
        status: 'completed',
        tenantId: 'ten_1',
        triggerKind: 'manual',
        warningCount: 0,
      },
    ]
    const requestedBuild: BackendGardenBuild = {
      ...buildsResponse[0]!,
      id: asGardenBuildId('gbd_2'),
      createdAt: '2026-04-03T11:00:00.000Z',
    }
    const publishedSite: BackendGardenSite = {
      buildMode: 'manual',
      createdAt: '2026-04-03T10:00:00.000Z',
      createdByAccountId: 'acc_1',
      currentBuildId: asGardenBuildId('gbd_2'),
      currentPublishedBuildId: asGardenBuildId('gbd_2'),
      deployMode: 'api_hosted',
      id: asGardenSiteId('gst_1'),
      isDefault: false,
      name: 'Wonderlands Garden',
      protectedAccessMode: 'none',
      protectedSecretRef: null,
      protectedSessionTtlSeconds: 86400,
      slug: 'wonderlands',
      sourceScopePath: '.',
      status: 'active',
      tenantId: 'ten_1',
      updatedAt: '2026-04-03T11:05:00.000Z',
      updatedByAccountId: 'acc_1',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      const method = init?.method ?? 'GET'
      const responseData =
        method === 'POST' && String(url).endsWith('/publish')
          ? publishedSite
          : method === 'POST'
            ? requestedBuild
            : buildsResponse

      return new Response(
        JSON.stringify({
          data: responseData,
          meta: { requestId: 'req_garden_builds', traceId: 'trace_garden_builds' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: method === 'POST' && !String(url).endsWith('/publish') ? 201 : 200,
        },
      )
    }) as typeof fetch

    await expect(listGardenBuilds(asGardenSiteId('gst_1'))).resolves.toEqual(buildsResponse)
    await expect(
      requestGardenBuild(asGardenSiteId('gst_1'), {
        triggerKind: 'manual',
      }),
    ).resolves.toEqual(requestedBuild)
    await expect(publishGarden(asGardenSiteId('gst_1'))).resolves.toEqual(publishedSite)

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', '/api/gardens/gst_1/builds'],
      ['POST', '/api/gardens/gst_1/builds'],
      ['POST', '/api/gardens/gst_1/publish'],
    ])
    expect(parseJsonRequestBody(requests[1]?.init)).toEqual({
      triggerKind: 'manual',
    })
  })

  test('reads and updates agent markdown through the backend routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const markdownResponse = {
      agentId: 'agt_1',
      markdown: '---\nname: Planner\n---\n\nFollow the plan.',
      revisionId: 'rev_agent_1',
    }
    const detail: BackendAgentDetail = {
      activeRevision: {
        checksumSha256: 'abc123',
        createdAt: '2026-03-30T12:00:00.000Z',
        id: 'rev_agent_1',
        instructionsMd: 'Follow the plan.',
        kernelPolicyJson: { enabled: false },
        modelConfigJson: { modelAlias: 'default', provider: 'openai' },
        sourceMarkdown: markdownResponse.markdown,
        toolPolicyJson: {},
        version: 1,
      },
      activeRevisionId: 'rev_agent_1',
      activeRevisionVersion: 1,
      createdAt: '2026-03-30T12:00:00.000Z',
      description: 'Plans and coordinates work.',
      id: asAgentId('agt_1'),
      isDefaultForAccount: false,
      kind: 'primary',
      name: 'Planner',
      ownerAccountId: 'acc_1',
      slug: 'planner',
      status: 'active',
      subagents: [],
      updatedAt: '2026-03-30T12:00:00.000Z',
      visibility: 'account_private',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: init?.method === 'PUT' ? detail : markdownResponse,
          meta: { requestId: 'req_agent_markdown', traceId: 'trace_agent_markdown' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(getAgentMarkdown(asAgentId('agt_1'))).resolves.toEqual(markdownResponse)
    await expect(
      updateAgentMarkdown(asAgentId('agt_1'), markdownResponse.markdown),
    ).resolves.toEqual(detail)

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', '/api/agents/agt_1/markdown'],
      ['PUT', '/api/agents/agt_1/markdown'],
    ])
  })

  test('reads system runtime capability status through the backend route', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = {
      kernel: {
        available: false,
        checkedAt: '2026-04-07T00:00:00.000Z',
        detail: 'Kernel is enabled but currently unavailable.',
        enabled: true,
        provider: 'local' as const,
        status: 'unavailable' as const,
      },
      sandbox: {
        available: true,
        detail: 'Sandbox provider local_dev supports node.',
        provider: 'local_dev' as const,
        supportedRuntimes: ['node'] as const,
      },
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_system_runtime', traceId: 'trace_system_runtime' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(getSystemRuntimeStatus()).resolves.toEqual(responseBody)
    expect(requests[0]?.url).toBe('/api/system/runtime')
  })

  test('starts a thread interaction with backend-native request fields', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody: StartThreadInteractionOutput = {
      assistantItemId: 'itm_1',
      assistantMessageId: asMessageId('msg_assistant'),
      attachedFileIds: [],
      inputMessageId: asMessageId('msg_input'),
      model: 'gpt-5.4',
      outputText: 'Start with SSE replay.',
      provider: 'openai',
      responseId: 'resp_1',
      runId: asRunId('run_1'),
      sessionId: asSessionId('ses_1'),
      status: 'completed',
      threadId: asThreadId('thr_1'),
      usage: null,
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_3', traceId: 'trace_3' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      startThreadInteraction(asThreadId('thr_1'), {
        fileIds: ['fil_1'],
        model: 'gpt-5.4',
        reasoning: {
          effort: 'high',
        },
        text: 'What should we wire next?',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests[0]?.url).toBe('/api/threads/thr_1/interactions')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        fileIds: ['fil_1'],
        model: 'gpt-5.4',
        reasoning: {
          effort: 'high',
        },
        text: 'What should we wire next?',
      }),
    })
  })

  test('streams thread events with an explicit all-category follow subscription', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const controller = new AbortController()

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return createPendingSseResponse()
    }) as typeof fetch

    setTimeout(() => {
      controller.abort()
    }, 0)

    await expect(
      streamThreadEvents({
        onEvents: () => undefined,
        signal: controller.signal,
        threadId: asThreadId('thr_live'),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(requests.length).toBeGreaterThan(0)

    const url = new URL(requests[0]!.url, 'http://localhost')

    expect(url.pathname).toBe('/api/events/stream')
    expect(url.searchParams.get('category')).toBe('all')
    expect(url.searchParams.get('follow')).toBe('true')
    expect(url.searchParams.get('threadId')).toBe('thr_live')
    expect(url.searchParams.get('cursor')).toBe('0')
    expect(requests[0]?.init?.credentials).toBe('include')
    expect(requests[0]?.init?.method).toBe('GET')
  })

  test('streams tenant events with an all-category follow subscription', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const controller = new AbortController()

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return createPendingSseResponse()
    }) as typeof fetch

    setTimeout(() => {
      controller.abort()
    }, 0)

    await expect(
      streamTenantEvents({
        onEvents: () => undefined,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(requests.length).toBeGreaterThan(0)

    const url = new URL(requests[0]!.url, 'http://localhost')

    expect(url.pathname).toBe('/api/events/stream')
    expect(url.searchParams.get('category')).toBe('all')
    expect(url.searchParams.get('follow')).toBe('true')
    expect(url.searchParams.get('cursor')).toBe('0')
    expect(url.searchParams.get('threadId')).toBeNull()
    expect(requests[0]?.init?.credentials).toBe('include')
    expect(requests[0]?.init?.method).toBe('GET')
  })

  test('replays run events with a non-follow run-scoped request', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const seenEvents: BackendEvent[] = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'id: 5\n' +
                  'event: run.started\n' +
                  `data: ${JSON.stringify({
                    aggregateId: 'run_bootstrap',
                    aggregateType: 'run',
                    createdAt: '2026-03-29T12:00:00.000Z',
                    eventNo: 5,
                    id: 'evt_bootstrap_started',
                    payload: {
                      rootRunId: 'run_bootstrap',
                      runId: 'run_bootstrap',
                      sessionId: 'ses_bootstrap',
                      threadId: 'thr_bootstrap',
                    },
                    type: 'run.started',
                  })}\n\n`,
              ),
            )
            controller.close()
          },
        }),
        {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        },
      )
    }) as typeof fetch

    await replayRunEvents({
      onEvents: (events) => {
        seenEvents.push(...events)
      },
      runId: asRunId('run_bootstrap'),
    })

    expect(seenEvents).toHaveLength(1)

    const url = new URL(requests[0]!.url, 'http://localhost')

    expect(url.pathname).toBe('/api/events/stream')
    expect(url.searchParams.get('category')).toBe('all')
    expect(url.searchParams.get('follow')).toBe('false')
    expect(url.searchParams.get('runId')).toBe('run_bootstrap')
    expect(url.searchParams.get('cursor')).toBe('0')
    expect(url.searchParams.get('threadId')).toBeNull()
    expect(requests[0]?.init?.credentials).toBe('include')
    expect(requests[0]?.init?.method).toBe('GET')
  })

  test('creates an MCP server through the backend envelope contract', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = {
      server: {
        config: {
          url: 'https://example.com/mcp',
        },
        createdAt: '2026-03-30T12:00:00.000Z',
        createdByAccountId: 'acc_adam_overment',
        enabled: true,
        id: 'mcs_1',
        kind: 'streamable_http' as const,
        label: 'Remote MCP',
        lastDiscoveredAt: '2026-03-30T12:00:05.000Z',
        lastError: null,
        logLevel: null,
        tenantId: 'ten_overment',
        updatedAt: '2026-03-30T12:00:05.000Z',
      },
      snapshot: {
        discoveredToolCount: 2,
        id: 'mcs_1',
        kind: 'streamable_http' as const,
        lastError: null,
        registeredToolCount: 1,
        status: 'ready' as const,
      },
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_mcp_create', traceId: 'trace_mcp_create' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      createMcpServer({
        config: {
          auth: { kind: 'none' },
          url: 'https://example.com/mcp',
        },
        kind: 'streamable_http',
        label: 'Remote MCP',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests[0]?.url).toBe('/api/mcp/servers')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        config: {
          auth: { kind: 'none' },
          url: 'https://example.com/mcp',
        },
        kind: 'streamable_http',
        label: 'Remote MCP',
      }),
    })
  })

  test('reads MCP tools for a server and tool profile', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = {
      toolProfileId: 'tpf_default',
      server: {
        config: {
          command: 'node',
        },
        createdAt: '2026-03-30T12:00:00.000Z',
        createdByAccountId: 'acc_adam_overment',
        enabled: true,
        id: 'mcs_1',
        kind: 'stdio' as const,
        label: 'Local MCP',
        lastDiscoveredAt: '2026-03-30T12:00:05.000Z',
        lastError: null,
        logLevel: null,
        tenantId: 'ten_overment',
        updatedAt: '2026-03-30T12:00:05.000Z',
      },
      tools: [
        {
          appsMetaJson: null,
          assignment: null,
          createdAt: '2026-03-30T12:00:05.000Z',
          description: 'Echo text',
          executionJson: null,
          fingerprint: 'fp_1',
          id: 'mct_1',
          inputSchemaJson: {},
          isActive: true,
          modelVisible: true,
          outputSchemaJson: null,
          remoteName: 'echo',
          runtimeName: 'mcs_1__echo',
          serverId: 'mcs_1',
          tenantId: 'ten_overment',
          title: 'Echo',
          updatedAt: '2026-03-30T12:00:05.000Z',
        },
      ],
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_mcp_tools', traceId: 'trace_mcp_tools' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(getMcpServerTools('mcs_1', { toolProfileId: 'tpf_default' })).resolves.toEqual(
      responseBody,
    )
    expect(requests[0]?.url).toBe('/api/mcp/servers/mcs_1/tools?toolProfileId=tpf_default')
    expect(requests[0]?.init?.credentials).toBe('include')
  })

  test('lists MCP servers for the current account', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = [
      {
        config: {
          url: 'https://example.com/mcp',
        },
        createdAt: '2026-03-30T12:00:00.000Z',
        createdByAccountId: 'acc_adam_overment',
        enabled: true,
        id: 'mcs_1',
        kind: 'streamable_http' as const,
        label: 'Remote MCP',
        lastDiscoveredAt: '2026-03-30T12:00:05.000Z',
        lastError: null,
        logLevel: null,
        snapshot: {
          discoveredToolCount: 2,
          id: 'mcs_1',
          kind: 'streamable_http' as const,
          lastError: null,
          registeredToolCount: 1,
          status: 'ready' as const,
        },
        tenantId: 'ten_overment',
        updatedAt: '2026-03-30T12:00:05.000Z',
      },
    ]

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_mcp_list', traceId: 'trace_mcp_list' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(listMcpServers()).resolves.toEqual(responseBody)
    expect(requests[0]?.url).toBe('/api/mcp/servers')
    expect(requests[0]?.init?.credentials).toBe('include')
  })

  test('updates an MCP server through the backend envelope contract', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = {
      server: {
        config: {
          headers: {
            Authorization: 'Bearer token',
          },
          url: 'https://example.com/mcp',
        },
        createdAt: '2026-03-30T12:00:00.000Z',
        createdByAccountId: 'acc_adam_overment',
        enabled: true,
        id: 'mcs_1',
        kind: 'streamable_http' as const,
        label: 'Updated MCP',
        lastDiscoveredAt: '2026-03-30T12:01:00.000Z',
        lastError: null,
        logLevel: null,
        tenantId: 'ten_overment',
        updatedAt: '2026-03-30T12:01:00.000Z',
      },
      snapshot: {
        discoveredToolCount: 2,
        id: 'mcs_1',
        kind: 'streamable_http' as const,
        lastError: null,
        registeredToolCount: 1,
        status: 'ready' as const,
      },
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_mcp_patch', traceId: 'trace_mcp_patch' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(
      updateMcpServer('mcs_1', {
        config: {
          auth: { kind: 'none' },
          headers: {
            Authorization: 'Bearer token',
          },
          url: 'https://example.com/mcp',
        },
        kind: 'streamable_http',
        label: 'Updated MCP',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests[0]?.url).toBe('/api/mcp/servers/mcs_1')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'PATCH',
      body: JSON.stringify({
        config: {
          auth: { kind: 'none' },
          headers: {
            Authorization: 'Bearer token',
          },
          url: 'https://example.com/mcp',
        },
        kind: 'streamable_http',
        label: 'Updated MCP',
      }),
    })
  })

  test('refreshes an MCP server snapshot', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = {
      discoveredToolCount: 1,
      id: 'mcs_1',
      kind: 'streamable_http' as const,
      lastError: null,
      registeredToolCount: 1,
      status: 'ready' as const,
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_mcp_refresh', traceId: 'trace_mcp_refresh' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(refreshMcpServer('mcs_1')).resolves.toEqual(responseBody)
    expect(requests[0]?.url).toBe('/api/mcp/servers/mcs_1/refresh')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
    })
  })

  test('deletes an MCP server through the backend envelope contract', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = {
      deletedToolAssignments: 1,
      deletedTools: 2,
      serverId: 'mcs_1',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_mcp_delete', traceId: 'trace_mcp_delete' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(deleteMcpServer('mcs_1')).resolves.toEqual(responseBody)
    expect(requests[0]?.url).toBe('/api/mcp/servers/mcs_1')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'DELETE',
    })
  })

  test('assigns an MCP tool to a tool profile', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = {
      assignment: {
        approvedAt: null,
        approvedFingerprint: null,
        assignedAt: '2026-03-30T12:05:00.000Z',
        assignedByAccountId: 'acc_adam_overment',
        id: 'mta_1',
        toolProfileId: 'tpf_default',
        requiresConfirmation: true,
        runtimeName: 'mcs_1__echo',
        serverId: 'mcs_1',
        tenantId: 'ten_overment',
        updatedAt: '2026-03-30T12:05:00.000Z',
      },
      tool: {
        appsMetaJson: null,
        createdAt: '2026-03-30T12:00:05.000Z',
        description: 'Echo text',
        executionJson: null,
        fingerprint: 'fp_1',
        id: 'mct_1',
        inputSchemaJson: {},
        isActive: true,
        modelVisible: true,
        outputSchemaJson: null,
        remoteName: 'echo',
        runtimeName: 'mcs_1__echo',
        serverId: 'mcs_1',
        tenantId: 'ten_overment',
        title: 'Echo',
        updatedAt: '2026-03-30T12:00:05.000Z',
      },
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_mcp_assign', traceId: 'trace_mcp_assign' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      assignMcpTool({
        requiresConfirmation: true,
        runtimeName: 'mcs_1__echo',
        serverId: 'mcs_1',
        toolProfileId: 'tpf_default',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests[0]?.url).toBe('/api/mcp/assignments')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        requiresConfirmation: true,
        runtimeName: 'mcs_1__echo',
        serverId: 'mcs_1',
        toolProfileId: 'tpf_default',
      }),
    })
  })

  test('removes an MCP tool assignment from a tool profile', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody = {
      assignment: {
        approvedAt: null,
        approvedFingerprint: null,
        assignedAt: '2026-03-30T12:05:00.000Z',
        assignedByAccountId: 'acc_adam_overment',
        id: 'mta_1',
        toolProfileId: 'tpf_default',
        requiresConfirmation: true,
        runtimeName: 'mcs_1__echo',
        serverId: 'mcs_1',
        tenantId: 'ten_overment',
        updatedAt: '2026-03-30T12:05:00.000Z',
      },
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_mcp_unassign', traceId: 'trace_mcp_unassign' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(
      deleteMcpToolAssignment({
        runtimeName: 'mcs_1__echo',
        toolProfileId: 'tpf_default',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests[0]?.url).toBe('/api/mcp/assignments/mcs_1__echo?toolProfileId=tpf_default')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'DELETE',
    })
  })

  test('resumes a waiting run with an explicit wait resolution payload', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody: ResumeRunOutput = {
      runId: asRunId('run_waiting'),
      status: 'accepted',
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_resume', traceId: 'trace_resume' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(
      resumeRun(asRunId('run_waiting'), {
        approve: true,
        rememberApproval: false,
        waitId: 'wte_1',
      }),
    ).resolves.toEqual(responseBody)

    expect(requests[0]?.url).toBe('/api/runs/run_waiting/resume')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        approve: true,
        rememberApproval: false,
        waitId: 'wte_1',
      }),
    })
  })

  test('creates a session through the backend envelope contract', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const responseBody: BackendSession = {
      archivedAt: null,
      createdAt: '2026-03-29T12:00:00.000Z',
      createdByAccountId: 'acc_adam_overment',
      deletedAt: null,
      id: asSessionId('ses_create'),
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_overment',
      title: 'Uploaded files',
      updatedAt: '2026-03-29T12:00:00.000Z',
      workspaceId: null,
      workspaceRef: null,
    }

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: responseBody,
          meta: { requestId: 'req_create_session', traceId: 'trace_create_session' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(createSession({ title: 'Uploaded files' })).resolves.toEqual(responseBody)
    expect(requests[0]?.url).toBe('/api/sessions')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        title: 'Uploaded files',
      }),
    })
  })

  test('creates a session thread through the backend envelope contract', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: {
            createdAt: '2026-03-29T12:00:00.000Z',
            createdByAccountId: 'acc_adam_overment',
            id: asThreadId('thr_create'),
            parentThreadId: null,
            sessionId: asSessionId('ses_create'),
            status: 'active',
            tenantId: 'ten_overment',
            title: 'Uploaded files',
            updatedAt: '2026-03-29T12:00:00.000Z',
          },
          meta: { requestId: 'req_create_thread', traceId: 'trace_create_thread' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      createSessionThread(asSessionId('ses_create'), {
        title: 'Uploaded files',
      }),
    ).resolves.toMatchObject({
      id: asThreadId('thr_create'),
      sessionId: asSessionId('ses_create'),
    })
    expect(requests[0]?.url).toBe('/api/sessions/ses_create/threads')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({
        title: 'Uploaded files',
      }),
    })
  })

  test('cancels a run by backend run id', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(
        JSON.stringify({
          data: { runId: asRunId('run_waiting'), status: 'cancelled' },
          meta: { requestId: 'req_4', traceId: 'trace_4' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    await expect(cancelRun(asRunId('run_waiting'))).resolves.toEqual({
      runId: asRunId('run_waiting'),
      status: 'cancelled',
    })

    expect(requests[0]?.url).toBe('/api/runs/run_waiting/cancel')
    expect(requests[0]?.init).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: '{}',
    })
  })
})
