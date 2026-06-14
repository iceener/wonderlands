import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { accountPreferences, agentRevisions, agents, runs, toolProfiles } from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const seedActiveAgent = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    agentId: string
    name: string
    revisionId: string
    slug: string
    tenantId?: string
    toolProfileId?: string
  },
) => {
  const tenantId = input.tenantId ?? 'ten_test'
  const createdAt = '2026-03-30T05:00:00.000Z'
  const toolProfileId = input.toolProfileId ?? `tpf_${input.slug}`

  runtime.db
    .insert(toolProfiles)
    .values({
      accountId: input.accountId,
      createdAt,
      id: toolProfileId,
      name: `${input.name} tools`,
      scope: 'account_private',
      status: 'active',
      tenantId,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .run()

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: input.revisionId,
      archivedAt: null,
      baseAgentId: null,
      createdAt,
      createdByAccountId: input.accountId,
      id: input.agentId,
      kind: 'primary',
      name: input.name,
      ownerAccountId: input.accountId,
      slug: input.slug,
      status: 'active',
      tenantId,
      updatedAt: createdAt,
      visibility: 'account_private',
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId: input.agentId,
      checksumSha256: `${input.revisionId}_checksum`,
      createdAt,
      createdByAccountId: input.accountId,
      frontmatterJson: {
        agent_id: input.agentId,
        kind: 'primary',
        name: input.name,
        revision_id: input.revisionId,
        schema: 'agent/v1',
        slug: input.slug,
        visibility: 'account_private',
      },
      gardenFocusJson: {},
      id: input.revisionId,
      instructionsMd: `${input.name} instructions`,
      kernelPolicyJson: {},
      memoryPolicyJson: {},
      modelConfigJson: {
        modelAlias: 'gpt-5.4',
        provider: 'openai',
      },
      resolvedConfigJson: {},
      sourceMarkdown: `---\nname: ${input.name}\nschema: agent/v1\nslug: ${input.slug}\nvisibility: account_private\nkind: primary\n---\n${input.name} instructions`,
      tenantId,
      toolProfileId,
      toolPolicyJson: {
        toolProfileId,
      },
      version: 1,
      sandboxPolicyJson: {},
      workspacePolicyJson: {},
    })
    .run()
}

test('get account preferences route returns the seeded assistant default target', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers } = seedApiKeyAuth(runtime)

  const response = await app.request('http://local/v1/account/preferences', {
    headers,
    method: 'GET',
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.accountId, accountId)
  assert.equal(body.data.assistantToolProfileId, 'tpf_assistant_test')
  assert.deepEqual(body.data.defaultTarget, {
    kind: 'assistant',
  })
  assert.deepEqual(body.data.shortcutBindings, {})
})

test('patch account preferences route switches the default target between agent and assistant', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_alice',
    name: 'Alice',
    revisionId: 'agr_alice_v1',
    slug: 'alice',
    tenantId,
  })

  const assignAgentResponse = await app.request('http://local/v1/account/preferences', {
    body: JSON.stringify({
      defaultTarget: {
        agentId: 'agt_alice',
        kind: 'agent',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })
  const assignAgentBody = await assignAgentResponse.json()

  assert.equal(assignAgentResponse.status, 200)
  assert.equal(assignAgentBody.ok, true)
  assert.deepEqual(assignAgentBody.data.defaultTarget, {
    agentId: 'agt_alice',
    kind: 'agent',
  })

  const assignedPreferences = runtime.db.select().from(accountPreferences).get()
  assert.equal(assignedPreferences?.defaultTargetKind, 'agent')
  assert.equal(assignedPreferences?.defaultAgentId, 'agt_alice')
  assert.equal(assignedPreferences?.shortcutBindings, null)

  const resetAssistantResponse = await app.request('http://local/v1/account/preferences', {
    body: JSON.stringify({
      defaultTarget: {
        kind: 'assistant',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })
  const resetAssistantBody = await resetAssistantResponse.json()

  assert.equal(resetAssistantResponse.status, 200)
  assert.equal(resetAssistantBody.ok, true)
  assert.deepEqual(resetAssistantBody.data.defaultTarget, {
    kind: 'assistant',
  })

  const resetPreferences = runtime.db.select().from(accountPreferences).get()
  assert.equal(resetPreferences?.defaultTargetKind, 'assistant')
  assert.equal(resetPreferences?.defaultAgentId, null)
  assert.equal(resetPreferences?.shortcutBindings, null)
})

test('patch account preferences route stores normalized shortcut overrides and returns only overrides', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const response = await app.request('http://local/v1/account/preferences', {
    body: JSON.stringify({
      shortcutBindings: {
        'chat.new-conversation': ' cmd + shift + n ',
        'settings.cycle-model': '',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.data.shortcutBindings, {
    'chat.new-conversation': 'Mod+Shift+N',
    'settings.cycle-model': null,
  })

  const storedPreferences = runtime.db.select().from(accountPreferences).get()
  assert.deepEqual(JSON.parse(storedPreferences?.shortcutBindings ?? '{}'), {
    'chat.new-conversation': 'Mod+Shift+N',
    'settings.cycle-model': null,
  })
})

test('patch account preferences route rejects unknown or conflicting shortcut bindings', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const unknownActionResponse = await app.request('http://local/v1/account/preferences', {
    body: JSON.stringify({
      shortcutBindings: {
        'chat.not-real': 'Mod+Shift+N',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })
  const unknownActionBody = await unknownActionResponse.json()

  assert.equal(unknownActionResponse.status, 400)
  assert.equal(unknownActionBody.error.type, 'validation')
  assert.match(unknownActionBody.error.message, /not rebindable/i)

  const conflictResponse = await app.request('http://local/v1/account/preferences', {
    body: JSON.stringify({
      shortcutBindings: {
        'chat.new-conversation': 'Mod+K',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })
  const conflictBody = await conflictResponse.json()

  assert.equal(conflictResponse.status, 400)
  assert.equal(conflictBody.error.type, 'validation')
  assert.match(conflictBody.error.message, /palette\.toggle/)
})

test('shortcut reset route removes selected overrides or clears them all', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const updateResponse = await app.request('http://local/v1/account/preferences', {
    body: JSON.stringify({
      shortcutBindings: {
        'chat.new-conversation': 'Mod+Shift+N',
        'settings.cycle-model': null,
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

  assert.equal(updateResponse.status, 200)

  const resetOneResponse = await app.request(
    'http://local/v1/account/preferences/shortcuts/reset',
    {
      body: JSON.stringify({
        actionIds: ['chat.new-conversation'],
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const resetOneBody = await resetOneResponse.json()

  assert.equal(resetOneResponse.status, 200)
  assert.deepEqual(resetOneBody.data.shortcutBindings, {
    'settings.cycle-model': null,
  })

  const resetAllResponse = await app.request(
    'http://local/v1/account/preferences/shortcuts/reset',
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const resetAllBody = await resetAllResponse.json()

  assert.equal(resetAllResponse.status, 200)
  assert.deepEqual(resetAllBody.data.shortcutBindings, {})

  const storedPreferences = runtime.db.select().from(accountPreferences).get()
  assert.equal(storedPreferences?.shortcutBindings, null)
})

test('bootstrap session respects an explicit assistant target even when the account default target is an agent', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_alice',
    name: 'Alice',
    revisionId: 'agr_alice_v1',
    slug: 'alice',
    tenantId,
    toolProfileId: 'tpf_alice',
  })

  const assignDefaultAgentResponse = await app.request('http://local/v1/account/preferences', {
    body: JSON.stringify({
      defaultTarget: {
        agentId: 'agt_alice',
        kind: 'agent',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

  assert.equal(assignDefaultAgentResponse.status, 200)

  const defaultTargetResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Use the default target',
      title: 'Default agent target',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const defaultTargetBody = await defaultTargetResponse.json()

  assert.equal(defaultTargetResponse.status, 201)
  assert.equal(defaultTargetBody.ok, true)

  const defaultRun = runtime.db
    .select()
    .from(runs)
    .where(eq(runs.id, defaultTargetBody.data.runId))
    .get()

  assert.equal(defaultRun?.agentId, 'agt_alice')
  assert.equal(defaultRun?.targetKind, 'agent')
  assert.equal(defaultRun?.toolProfileId, 'tpf_alice')

  const explicitAssistantResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Override to assistant',
      target: {
        kind: 'assistant',
      },
      title: 'Assistant override',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const explicitAssistantBody = await explicitAssistantResponse.json()

  assert.equal(explicitAssistantResponse.status, 201)
  assert.equal(explicitAssistantBody.ok, true)

  const assistantRun = runtime.db
    .select()
    .from(runs)
    .where(eq(runs.id, explicitAssistantBody.data.runId))
    .get()

  assert.equal(assistantRun?.agentId, null)
  assert.equal(assistantRun?.agentRevisionId, null)
  assert.equal(assistantRun?.targetKind, 'assistant')
  assert.equal(assistantRun?.toolProfileId, 'tpf_assistant_test')
})
