import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { closeAppRuntime } from '../src/app/runtime'
import {
  domainEvents,
  items,
  jobs,
  mcpServers,
  mcpToolAssignments,
  mcpToolCache,
  runDependencies,
  runs,
  sessionMessages,
  toolExecutions,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createAsyncTestHarness } from './helpers/create-test-app'

const stdioFixturePath = resolve(process.cwd(), 'test/fixtures/stdio-mcp-server.ts')
type TestApp = Awaited<ReturnType<typeof createAsyncTestHarness>>['app']

const bootstrapRun = async (
  app: TestApp,
  headers: Record<string, string>,
  toolProfileId: string,
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Use the user MCP to answer the task',
      profile: toolProfileId,
      title: 'MCP user flow',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 201)

  return response.json()
}

const createSelfManagedServer = async (app: TestApp, headers: Record<string, string>) => {
  const response = await app.request('http://local/v1/mcp/servers', {
    body: JSON.stringify({
      config: {
        args: ['--import', 'tsx', stdioFixturePath],
        command: 'node',
      },
      kind: 'stdio',
      label: 'My Fixture MCP',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 201)

  return response.json()
}

const getServerToolByRemoteName = async (
  app: TestApp,
  headers: Record<string, string>,
  serverId: string,
  toolProfileId: string,
  remoteName: string,
) => {
  const response = await app.request(
    `http://local/v1/mcp/servers/${serverId}/tools?toolProfileId=${encodeURIComponent(toolProfileId)}`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(response.status, 200)

  const body = await response.json()
  const tool = body.data.tools.find(
    (entry: { remoteName: string }) => entry.remoteName === remoteName,
  )

  assert.ok(tool)

  return tool as {
    assignment: null | { runtimeName: string }
    runtimeName: string
  }
}

const delay = async (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })

test('users can register their own MCP servers, discover tools, and assign a tool to a profile', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string

  assert.equal(created.data.snapshot.status, 'ready')

  const serverRows = runtime.db.select().from(mcpServers).all()
  const cacheRows = runtime.db.select().from(mcpToolCache).all()

  assert.equal(serverRows.length, 1)
  assert.equal(serverRows[0]?.createdByAccountId, 'acc_test')
  const echoTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'echo',
  )
  const appOnlyTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'app_only',
  )

  assert.equal(
    cacheRows.some((row) => row.runtimeName === echoTool.runtimeName),
    true,
  )
  assert.equal(
    cacheRows.some((row) => row.runtimeName === appOnlyTool.runtimeName),
    true,
  )
  assert.equal(echoTool.assignment, null)

  const assignResponse = await app.request('http://local/v1/mcp/assignments', {
    body: JSON.stringify({
      requiresConfirmation: true,
      runtimeName: echoTool.runtimeName,
      serverId,
      toolProfileId: assistantToolProfileId,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(assignResponse.status, 201)

  const assignmentRows = runtime.db.select().from(mcpToolAssignments).all()

  assert.equal(assignmentRows.length, 1)
  assert.equal(assignmentRows[0]?.runtimeName, echoTool.runtimeName)
  assert.equal(assignmentRows[0]?.toolProfileId, assistantToolProfileId)
  assert.equal(assignmentRows[0]?.requiresConfirmation, true)
})

test('users can update their own MCP servers and refresh discovery', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string

  const updateResponse = await app.request(`http://local/v1/mcp/servers/${serverId}`, {
    body: JSON.stringify({
      config: {
        args: ['--import', 'tsx', stdioFixturePath],
        command: 'node',
        cwd: process.cwd(),
      },
      kind: 'stdio',
      label: 'My Updated Fixture MCP',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

  assert.equal(updateResponse.status, 200)
  const updateBody = await updateResponse.json()

  assert.equal(updateBody.data.server.id, serverId)
  assert.equal(updateBody.data.server.label, 'My Updated Fixture MCP')
  assert.equal(updateBody.data.snapshot.status, 'ready')

  const serverRows = runtime.db.select().from(mcpServers).all()

  assert.equal(serverRows.length, 1)
  assert.equal(serverRows[0]?.label, 'My Updated Fixture MCP')
  assert.deepEqual(serverRows[0]?.configJson, {
    args: ['--import', 'tsx', stdioFixturePath],
    command: 'node',
    cwd: process.cwd(),
  })
})

test('mcp app hosts can read ui resources and call server tools through the API proxy', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string
  const echoTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'echo',
  )

  const resourceResponse = await app.request(
    `http://local/v1/mcp/resources/read?toolName=${encodeURIComponent(echoTool.runtimeName)}&uri=${encodeURIComponent('ui://fixture/echo.html')}&format=raw`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(resourceResponse.status, 200)
  const resourceBody = await resourceResponse.json()
  assert.match(resourceBody.data.contents[0]?.text ?? '', /Fixture Echo App/)

  const toolCallResponse = await app.request('http://local/v1/mcp/tools/call', {
    body: JSON.stringify({
      arguments: {},
      name: 'app_only',
      toolName: echoTool.runtimeName,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(toolCallResponse.status, 200)
  const toolCallBody = await toolCallResponse.json()
  assert.equal(toolCallBody.data.isError, undefined)
  assert.equal(toolCallBody.data.content[0]?.text, 'hidden')
})

test('tool completion events preserve MCP app metadata declared only in result metadata', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string
  const dynamicTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'dynamic_ui',
  )

  const assignResponse = await app.request('http://local/v1/mcp/assignments', {
    body: JSON.stringify({
      requiresConfirmation: false,
      runtimeName: dynamicTool.runtimeName,
      serverId,
      toolProfileId: assistantToolProfileId,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(assignResponse.status, 201)

  const bootstrap = await bootstrapRun(app, headers, assistantToolProfileId)
  const capturedRequests: AiInteractionRequest[] = []

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (capturedRequests.length === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_mcp_dynamic_1',
            name: dynamicTool.runtimeName,
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_mcp_dynamic_1',
        raw: { stub: 'tool_call' },
        responseId: 'resp_mcp_dynamic_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_mcp_dynamic_1',
            name: dynamicTool.runtimeName,
          },
        ],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Opened the dynamic MCP app.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Opened the dynamic MCP app.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Opened the dynamic MCP app.',
      provider: 'openai',
      providerRequestId: 'req_mcp_dynamic_2',
      raw: { stub: 'final' },
      responseId: 'resp_mcp_dynamic_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const executeResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(executeResponse.status, 200)
  const executeBody = await executeResponse.json()
  assert.equal(executeBody.data.status, 'completed')

  const toolCalledEvent = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .find((dbEvent) => dbEvent.type === 'tool.called')
  const toolCompletedEvent = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .find((dbEvent) => dbEvent.type === 'tool.completed')
  const assistantMessageRow = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .find((message) => message.authorKind === 'assistant')
  const persistedAppsMeta = (
    assistantMessageRow?.metadata as {
      transcript?: {
        toolBlocks?: Array<{
          appsMeta?: {
            resourceUri?: string
            serverId?: string
          }
        }>
      }
    } | null
  )?.transcript?.toolBlocks?.[0]?.appsMeta

  assert.equal(
    (toolCalledEvent?.payload as { appsMeta?: unknown } | undefined)?.appsMeta,
    undefined,
  )
  assert.deepEqual((toolCompletedEvent?.payload as { appsMeta?: unknown } | undefined)?.appsMeta, {
    resourceUri: 'ui://fixture/dynamic.html',
    serverId,
  })
  assert.deepEqual(persistedAppsMeta, {
    resourceUri: 'ui://fixture/dynamic.html',
    serverId,
  })
})

test('users can delete their own MCP servers and remove cached state', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string
  const echoTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'echo',
  )

  const assignResponse = await app.request('http://local/v1/mcp/assignments', {
    body: JSON.stringify({
      requiresConfirmation: true,
      runtimeName: echoTool.runtimeName,
      serverId,
      toolProfileId: assistantToolProfileId,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(assignResponse.status, 201)

  const deleteResponse = await app.request(`http://local/v1/mcp/servers/${serverId}`, {
    headers,
    method: 'DELETE',
  })

  assert.equal(deleteResponse.status, 200)
  const deleteBody = await deleteResponse.json()

  assert.equal(deleteBody.data.serverId, serverId)
  assert.equal(deleteBody.data.deletedToolAssignments >= 1, true)
  assert.equal(deleteBody.data.deletedTools >= 1, true)
  assert.equal(runtime.db.select().from(mcpServers).all().length, 0)
  assert.equal(runtime.db.select().from(mcpToolCache).all().length, 0)
  assert.equal(runtime.db.select().from(mcpToolAssignments).all().length, 0)
  assert.equal(
    runtime.services.mcp.getServerSnapshots().some((snapshot) => snapshot.id === serverId),
    false,
  )
  assert.equal(runtime.services.mcp.getTool(`${serverId}__echo`), null)
})

test('users can remove a tool assignment from their profile', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string
  const echoTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'echo',
  )

  const assignResponse = await app.request('http://local/v1/mcp/assignments', {
    body: JSON.stringify({
      requiresConfirmation: true,
      runtimeName: echoTool.runtimeName,
      serverId,
      toolProfileId: assistantToolProfileId,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(assignResponse.status, 201)
  assert.equal(runtime.db.select().from(mcpToolAssignments).all().length, 1)

  const deleteResponse = await app.request(
    `http://local/v1/mcp/assignments/${encodeURIComponent(echoTool.runtimeName)}?toolProfileId=${encodeURIComponent(assistantToolProfileId)}`,
    {
      headers,
      method: 'DELETE',
    },
  )

  assert.equal(deleteResponse.status, 200)
  const deleteBody = await deleteResponse.json()

  assert.equal(deleteBody.data.assignment.runtimeName, echoTool.runtimeName)
  assert.equal(deleteBody.data.assignment.toolProfileId, assistantToolProfileId)
  assert.equal(runtime.db.select().from(mcpToolAssignments).all().length, 0)
})

test('first use of an assigned MCP tool waits for confirmation, then executes after approval', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string
  const echoTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'echo',
  )

  const assignResponse = await app.request('http://local/v1/mcp/assignments', {
    body: JSON.stringify({
      requiresConfirmation: true,
      runtimeName: echoTool.runtimeName,
      serverId,
      toolProfileId: assistantToolProfileId,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(assignResponse.status, 201)

  const bootstrap = await bootstrapRun(app, headers, assistantToolProfileId)
  const capturedRequests: AiInteractionRequest[] = []

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (capturedRequests.length === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: { value: 'hello' },
            argumentsJson: '{"value":"hello"}',
            callId: 'call_mcp_confirm_1',
            name: echoTool.runtimeName,
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_mcp_confirm_1',
        raw: { stub: 'tool_call' },
        responseId: 'resp_mcp_confirm_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: { value: 'hello' },
            argumentsJson: '{"value":"hello"}',
            callId: 'call_mcp_confirm_1',
            name: echoTool.runtimeName,
          },
        ],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'The MCP echoed hello.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'The MCP echoed hello.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The MCP echoed hello.',
      provider: 'openai',
      providerRequestId: 'req_mcp_confirm_2',
      raw: { stub: 'final' },
      responseId: 'resp_mcp_confirm_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const executeResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(executeResponse.status, 202)
  const executeBody = await executeResponse.json()
  assert.equal(executeBody.data.status, 'waiting')

  const waitRows = runtime.db.select().from(runDependencies).all()
  const toolRows = runtime.db.select().from(toolExecutions).all()
  const eventTypesAfterWait = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)
  const toolCalledEvent = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .find((event) => event.type === 'tool.called')
  const activeToolContextMessage = capturedRequests[0]?.messages.find(
    (message) =>
      message.role === 'developer' &&
      message.content.some(
        (content) =>
          content.type === 'text' &&
          typeof content.text === 'string' &&
          content.text.includes('Active MCP tools currently available'),
      ),
  )

  assert.equal(waitRows.length, 1)
  assert.equal(waitRows[0]?.type, 'human')
  assert.equal(waitRows[0]?.targetKind, 'human_response')
  assert.equal(toolRows[0]?.tool, echoTool.runtimeName)
  assert.equal(toolRows[0]?.outcomeJson, null)
  assert.equal(eventTypesAfterWait.includes('tool.confirmation_requested'), true)
  assert.deepEqual((toolCalledEvent?.payload as { appsMeta?: unknown } | undefined)?.appsMeta, {
    resourceUri: 'ui://fixture/echo.html',
    serverId,
  })
  assert.equal(capturedRequests[0]?.metadata?.mcpActiveToolCount, '1')
  assert.equal('mcpActiveTools' in (capturedRequests[0]?.metadata ?? {}), false)
  assert.equal(activeToolContextMessage, undefined)

  const resumeResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/resume`, {
    body: JSON.stringify({
      approve: true,
      rememberApproval: true,
      waitId: waitRows[0]?.id,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(resumeResponse.status, 202)
  const resumeBody = await resumeResponse.json()
  assert.equal(resumeBody.data.status, 'accepted')

  await runtime.services.multiagent.processOneDecision()

  const assignmentRows = runtime.db.select().from(mcpToolAssignments).all()
  const finalWaitRow = runtime.db.select().from(runDependencies).all()[0]
  const functionOutputItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.type === 'function_call_output')
  const finalToolExecution = runtime.db.select().from(toolExecutions).all()[0]
  const assistantMessageRow = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .find((message) => message.authorKind === 'assistant')
  const trustedApproval = (
    assistantMessageRow?.metadata as {
      transcript?: {
        toolBlocks?: Array<{
          approval?: {
            remembered?: boolean | null
            status?: string
          }
        }>
      }
    } | null
  )?.transcript?.toolBlocks?.[0]?.approval
  const finalEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)
  const completedEventPayload = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .find((event) => event.type === 'tool.completed')?.payload as
    | {
        appsMeta?: {
          resourceUri?: string
          serverId?: string
        }
      }
    | undefined
  const persistedAppsMeta = (
    assistantMessageRow?.metadata as {
      transcript?: {
        toolBlocks?: Array<{
          appsMeta?: {
            resourceUri?: string
            serverId?: string
          }
        }>
      }
    } | null
  )?.transcript?.toolBlocks?.[0]?.appsMeta

  assert.equal(
    assignmentRows[0]?.approvedFingerprint,
    runtime.services.mcp.getTool(echoTool.runtimeName)?.fingerprint,
  )
  assert.deepEqual(finalWaitRow?.resolutionJson, {
    approved: true,
    fingerprint: runtime.services.mcp.getTool(echoTool.runtimeName)?.fingerprint,
    remembered: true,
  })
  assert.equal(functionOutputItems.length, 1)
  assert.match(String(functionOutputItems[0]?.output), /echo:hello/)
  assert.equal(
    finalToolExecution?.outcomeJson && typeof finalToolExecution.outcomeJson === 'object',
    true,
  )
  assert.equal(finalEventTypes.includes('tool.confirmation_granted'), true)
  assert.equal(finalEventTypes.includes('tool.completed'), true)
  assert.deepEqual(completedEventPayload?.appsMeta, {
    resourceUri: 'ui://fixture/echo.html',
    serverId,
  })
  assert.equal(
    assistantMessageRow?.metadata && typeof assistantMessageRow.metadata === 'object',
    true,
  )
  assert.deepEqual(persistedAppsMeta, {
    resourceUri: 'ui://fixture/echo.html',
    serverId,
  })
  assert.equal(trustedApproval?.status, 'approved')
  assert.equal(trustedApproval?.remembered, true)
})

test('approving a confirmation once executes the tool without trusting the fingerprint', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string
  const echoTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'echo',
  )

  const assignResponse = await app.request('http://local/v1/mcp/assignments', {
    body: JSON.stringify({
      requiresConfirmation: true,
      runtimeName: echoTool.runtimeName,
      serverId,
      toolProfileId: assistantToolProfileId,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(assignResponse.status, 201)

  const bootstrap = await bootstrapRun(app, headers, assistantToolProfileId)
  const capturedRequests: AiInteractionRequest[] = []

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (capturedRequests.length === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: { value: 'hello' },
            argumentsJson: '{"value":"hello"}',
            callId: 'call_mcp_confirm_once_1',
            name: echoTool.runtimeName,
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_mcp_confirm_once_1',
        raw: { stub: 'tool_call' },
        responseId: 'resp_mcp_confirm_once_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: { value: 'hello' },
            argumentsJson: '{"value":"hello"}',
            callId: 'call_mcp_confirm_once_1',
            name: echoTool.runtimeName,
          },
        ],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'The MCP echoed hello.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'The MCP echoed hello.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The MCP echoed hello.',
      provider: 'openai',
      providerRequestId: 'req_mcp_confirm_once_2',
      raw: { stub: 'final' },
      responseId: 'resp_mcp_confirm_once_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const executeResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(executeResponse.status, 202)

  const waitRows = runtime.db.select().from(runDependencies).all()
  assert.equal(waitRows.length, 1)

  const resumeResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/resume`, {
    body: JSON.stringify({
      approve: true,
      rememberApproval: false,
      waitId: waitRows[0]?.id,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(resumeResponse.status, 202)
  const resumeBody = await resumeResponse.json()
  assert.equal(resumeBody.data.status, 'accepted')

  await runtime.services.multiagent.processOneDecision()

  const assignmentRows = runtime.db.select().from(mcpToolAssignments).all()
  const finalWaitRow = runtime.db.select().from(runDependencies).all()[0]
  const assistantMessageRow = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .find((message) => message.authorKind === 'assistant')
  const onceApproval = (
    assistantMessageRow?.metadata as {
      transcript?: {
        toolBlocks?: Array<{
          approval?: {
            remembered?: boolean | null
            status?: string
          }
        }>
      }
    } | null
  )?.transcript?.toolBlocks?.[0]?.approval
  const finalEvent = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .find((event) => event.type === 'tool.confirmation_granted')

  assert.equal(assignmentRows[0]?.approvedFingerprint, null)
  assert.deepEqual(finalWaitRow?.resolutionJson, {
    approved: true,
    fingerprint: runtime.services.mcp.getTool(echoTool.runtimeName)?.fingerprint,
    remembered: false,
  })
  assert.equal(finalEvent?.payload && typeof finalEvent.payload === 'object', true)
  assert.equal((finalEvent?.payload as { remembered?: boolean } | undefined)?.remembered, false)
  assert.equal(onceApproval?.status, 'approved')
  assert.equal(onceApproval?.remembered, false)
})

test('approving one of multiple confirmation waits refreshes the durable waiting snapshot', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string
  const echoTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'echo',
  )

  const assignResponse = await app.request('http://local/v1/mcp/assignments', {
    body: JSON.stringify({
      requiresConfirmation: true,
      runtimeName: echoTool.runtimeName,
      serverId,
      toolProfileId: assistantToolProfileId,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(assignResponse.status, 201)

  const bootstrap = await bootstrapRun(app, headers, assistantToolProfileId)

  runtime.services.ai.interactions.generate = async () =>
    ok<AiInteractionResponse>({
      messages: [],
      model: 'gpt-5.4',
      output: [
        {
          arguments: { value: 'hello-1' },
          argumentsJson: '{"value":"hello-1"}',
          callId: 'call_mcp_confirm_multi_1',
          name: echoTool.runtimeName,
          type: 'function_call',
        },
        {
          arguments: { value: 'hello-2' },
          argumentsJson: '{"value":"hello-2"}',
          callId: 'call_mcp_confirm_multi_2',
          name: echoTool.runtimeName,
          type: 'function_call',
        },
      ],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_mcp_confirm_multi_1',
      raw: { stub: 'tool_call' },
      responseId: 'resp_mcp_confirm_multi_1',
      status: 'completed',
      toolCalls: [
        {
          arguments: { value: 'hello-1' },
          argumentsJson: '{"value":"hello-1"}',
          callId: 'call_mcp_confirm_multi_1',
          name: echoTool.runtimeName,
        },
        {
          arguments: { value: 'hello-2' },
          argumentsJson: '{"value":"hello-2"}',
          callId: 'call_mcp_confirm_multi_2',
          name: echoTool.runtimeName,
        },
      ],
      usage: null,
    })

  const executeResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(executeResponse.status, 202)
  const executeBody = await executeResponse.json()
  assert.equal(executeBody.data.status, 'waiting')
  assert.equal(executeBody.data.pendingWaits.length, 2)

  const initialWaitRows = runtime.db
    .select()
    .from(runDependencies)
    .all()
    .sort((left, right) => left.callId.localeCompare(right.callId))
  assert.equal(initialWaitRows.length, 2)

  const approvedWait = initialWaitRows[0]
  const remainingWait = initialWaitRows[1]
  assert.ok(approvedWait)
  assert.ok(remainingWait)

  const resumeResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/resume`, {
    body: JSON.stringify({
      approve: true,
      rememberApproval: false,
      waitId: approvedWait.id,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(resumeResponse.status, 202)
  const resumeBody = await resumeResponse.json()
  assert.equal(resumeBody.data.status, 'waiting')
  assert.deepEqual(resumeBody.data.waitIds, [remainingWait.id])
  assert.equal(resumeBody.data.pendingWaits.length, 1)
  assert.equal(resumeBody.data.pendingWaits[0]?.waitId, remainingWait.id)

  const persistedRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === bootstrap.data.runId)
  assert.ok(persistedRun)
  const persistedSnapshot =
    persistedRun?.resultJson && typeof persistedRun.resultJson === 'object'
      ? (persistedRun.resultJson as {
          pendingWaits?: Array<{ waitId?: string }>
          transcript?: {
            toolBlocks?: Array<{
              approval?: { status?: string }
              status?: string
              toolCallId?: string
            }>
          }
          waitIds?: string[]
        })
      : null
  assert.deepEqual(persistedSnapshot?.waitIds, [remainingWait.id])
  assert.equal(persistedSnapshot?.pendingWaits?.length, 1)
  assert.equal(persistedSnapshot?.pendingWaits?.[0]?.waitId, remainingWait.id)
  assert.equal(
    persistedSnapshot?.transcript?.toolBlocks?.some(
      (block) => block.toolCallId === approvedWait.callId && block.status === 'complete',
    ),
    true,
  )
  assert.equal(
    persistedSnapshot?.transcript?.toolBlocks?.some(
      (block) => block.toolCallId === approvedWait.callId && block.approval?.status === 'approved',
    ),
    true,
  )
  assert.equal(
    persistedSnapshot?.transcript?.toolBlocks?.some(
      (block) =>
        block.toolCallId === remainingWait.callId && block.status === 'awaiting_confirmation',
    ),
    true,
  )

  const persistedJob = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((candidate) => candidate.currentRunId === bootstrap.data.runId)
  assert.ok(persistedJob)
  const persistedJobReason =
    persistedJob?.statusReasonJson && typeof persistedJob.statusReasonJson === 'object'
      ? (persistedJob.statusReasonJson as { waitIds?: string[] })
      : null
  assert.deepEqual(persistedJobReason?.waitIds, [remainingWait.id])

  const runResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}`, {
    headers,
    method: 'GET',
  })
  assert.equal(runResponse.status, 200)
  const runBody = await runResponse.json()
  assert.deepEqual(runBody.data.resultJson.waitIds, [remainingWait.id])
  assert.equal(runBody.data.resultJson.pendingWaits.length, 1)
  assert.equal(runBody.data.resultJson.pendingWaits[0]?.waitId, remainingWait.id)

  const threadResponse = await app.request(`http://local/v1/threads/${bootstrap.data.threadId}`, {
    headers,
    method: 'GET',
  })
  assert.equal(threadResponse.status, 200)
  const threadBody = await threadResponse.json()
  assert.deepEqual(threadBody.data.rootJob.statusReasonJson.waitIds, [remainingWait.id])
})

test('approving a delayed confirmation does not resume the run before the tool output is persisted', async () => {
  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    MULTIAGENT_WORKER_POLL_MS: '25',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    await closeAppRuntime(runtime)
  })

  const { assistantToolProfileId, headers } = seedApiKeyAuth(runtime)
  const created = await createSelfManagedServer(app, headers)
  const serverId = created.data.server.id as string
  const echoTool = await getServerToolByRemoteName(
    app,
    headers,
    serverId,
    assistantToolProfileId,
    'echo',
  )

  const assignResponse = await app.request('http://local/v1/mcp/assignments', {
    body: JSON.stringify({
      requiresConfirmation: true,
      runtimeName: echoTool.runtimeName,
      serverId,
      toolProfileId: assistantToolProfileId,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(assignResponse.status, 201)

  const bootstrap = await bootstrapRun(app, headers, assistantToolProfileId)
  const originalCallTool = runtime.services.mcp.callTool
  runtime.services.mcp.callTool = async (input) => {
    if (input.runtimeName === echoTool.runtimeName) {
      await delay(250)
    }

    return originalCallTool(input)
  }

  const capturedRequests: AiInteractionRequest[] = []

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (capturedRequests.length === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: { value: 'hello' },
            argumentsJson: '{"value":"hello"}',
            callId: 'call_mcp_confirm_delayed_1',
            name: echoTool.runtimeName,
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_mcp_confirm_delayed_1',
        raw: { stub: 'tool_call' },
        responseId: 'resp_mcp_confirm_delayed_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: { value: 'hello' },
            argumentsJson: '{"value":"hello"}',
            callId: 'call_mcp_confirm_delayed_1',
            name: echoTool.runtimeName,
          },
        ],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'The MCP echoed hello.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'The MCP echoed hello.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The MCP echoed hello.',
      provider: 'openai',
      providerRequestId: 'req_mcp_confirm_delayed_2',
      raw: { stub: 'final' },
      responseId: 'resp_mcp_confirm_delayed_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const executeResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(executeResponse.status, 202)

  const waitRows = runtime.db.select().from(runDependencies).all()
  assert.equal(waitRows.length, 1)

  const resumeResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/resume`, {
    body: JSON.stringify({
      approve: true,
      rememberApproval: true,
      waitId: waitRows[0]?.id,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(resumeResponse.status, 202)
  const resumeBody = await resumeResponse.json()
  assert.equal(resumeBody.data.status, 'accepted')

  await runtime.services.multiagent.processOneDecision()

  const runEvents = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter(
      (event) =>
        event.payload &&
        typeof event.payload === 'object' &&
        (event.payload as { runId?: string }).runId === bootstrap.data.runId,
    )

  const confirmationGrantedIndex = runEvents.findIndex(
    (event) => event.type === 'tool.confirmation_granted',
  )
  const toolCompletedIndex = runEvents.findIndex((event) => event.type === 'tool.completed')
  const runResumedIndex = runEvents.findIndex((event) => event.type === 'run.resumed')

  assert.equal(
    runEvents.some((event) => event.type === 'run.failed'),
    false,
  )
  assert.ok(confirmationGrantedIndex >= 0)
  assert.ok(toolCompletedIndex >= 0)
  assert.ok(runResumedIndex >= 0)
  assert.ok(confirmationGrantedIndex < runResumedIndex)
  assert.ok(toolCompletedIndex < runResumedIndex)
})
