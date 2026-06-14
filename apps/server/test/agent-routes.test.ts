import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'
import {
  parseAgentMarkdown,
  serializeAgentMarkdown,
} from '../src/application/agents/agent-markdown'
import {
  accountPreferences,
  accounts,
  agentRevisions,
  agentSubagentLinks,
  agents,
  domainEvents,
  tenantMemberships,
  toolProfiles,
} from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const baseCreatePayload = {
  description: 'Coordinates planning and execution work.',
  instructionsMd: 'You are Alpha.\n\nPlan clearly.',
  kind: 'primary' as const,
  memory: {
    childPromotion: 'explicit',
    profileScope: true,
  },
  model: {
    modelAlias: 'gpt-5.4',
    provider: 'openai',
    reasoning: {
      effort: 'medium',
    },
  },
  name: 'Alpha',
  slug: 'alpha',
  tools: {
    toolProfileId: 'tpf_assistant_test',
    native: ['suspend_run'],
  },
  visibility: 'account_private' as const,
  workspace: {
    strategy: 'isolated_run',
  },
}

const seedAgent = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    activeRevisionId: string
    agentId: string
    createdByAccountId: string
    name: string
    ownerAccountId: string | null
    revisionId: string
    slug: string
    sourceMarkdown: string
    tenantId?: string
    visibility: 'account_private' | 'tenant_shared' | 'system'
  },
) => {
  const tenantId = input.tenantId ?? 'ten_test'

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: input.activeRevisionId,
      archivedAt: null,
      baseAgentId: null,
      createdAt: '2026-03-30T04:30:00.000Z',
      createdByAccountId: input.createdByAccountId,
      id: input.agentId,
      kind: 'primary',
      name: input.name,
      ownerAccountId: input.ownerAccountId,
      slug: input.slug,
      status: 'active',
      tenantId,
      updatedAt: '2026-03-30T04:30:00.000Z',
      visibility: input.visibility,
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId: input.agentId,
      checksumSha256: `${input.revisionId}_checksum`,
      createdAt: '2026-03-30T04:30:00.000Z',
      createdByAccountId: input.createdByAccountId,
      frontmatterJson: {
        agent_id: input.agentId,
        kind: 'primary',
        name: input.name,
        revision_id: input.revisionId,
        schema: 'agent/v1',
        slug: input.slug,
        visibility: input.visibility,
      },
      gardenFocusJson: {},
      id: input.revisionId,
      instructionsMd: 'Seeded instructions',
      kernelPolicyJson: {},
      memoryPolicyJson: {},
      modelConfigJson: {},
      resolvedConfigJson: {},
      sourceMarkdown: input.sourceMarkdown,
      tenantId,
      toolPolicyJson: {},
      version: 1,
      sandboxPolicyJson: {},
      workspacePolicyJson: {},
    })
    .run()
}

test('agent routes create, list, update, and export markdown through revisioned APIs', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  runtime.db
    .insert(toolProfiles)
    .values({
      accountId,
      createdAt: '2026-03-30T05:10:00.000Z',
      id: 'tpf_research_test',
      name: 'Research tools',
      scope: 'account_private',
      status: 'active',
      tenantId,
      updatedAt: '2026-03-30T05:10:00.000Z',
    })
    .run()

  const createResponse = await app.request('http://local/v1/agents', {
    body: JSON.stringify(baseCreatePayload),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()

  assert.equal(createResponse.status, 201)
  assert.equal(createBody.ok, true)
  assert.equal(createBody.data.name, 'Alpha')
  assert.equal(createBody.data.description, 'Coordinates planning and execution work.')
  assert.equal(createBody.data.slug, 'alpha')
  assert.equal(createBody.data.activeRevision.version, 1)
  assert.equal(createBody.data.activeRevision.toolProfileId, 'tpf_assistant_test')

  const listResponse = await app.request('http://local/v1/agents', {
    headers,
  })
  const listBody = await listResponse.json()

  assert.equal(listResponse.status, 200)
  assert.equal(listBody.data.length, 1)
  assert.equal(listBody.data[0]?.id, createBody.data.id)
  assert.equal(listBody.data[0]?.activeRevisionVersion, 1)

  const markdownResponse = await app.request(
    `http://local/v1/agents/${createBody.data.id}/markdown`,
    {
      headers,
    },
  )
  const markdownBody = await markdownResponse.json()

  assert.equal(markdownResponse.status, 200)
  assert.equal(markdownBody.data.agentId, createBody.data.id)
  assert.equal(markdownBody.data.revisionId, createBody.data.activeRevision.id)

  const parsedMarkdown = parseAgentMarkdown(markdownBody.data.markdown)

  assert.equal(parsedMarkdown.ok, true)
  assert.equal(parsedMarkdown.value.frontmatter.name, 'Alpha')
  assert.equal(
    parsedMarkdown.value.frontmatter.description,
    'Coordinates planning and execution work.',
  )
  assert.equal(parsedMarkdown.value.frontmatter.slug, 'alpha')
  assert.equal(parsedMarkdown.value.frontmatter.tools?.toolProfileId, 'tpf_assistant_test')

  const updateResponse = await app.request(`http://local/v1/agents/${createBody.data.id}`, {
    body: JSON.stringify({
      ...baseCreatePayload,
      description: 'Writes directly and keeps drafts tight.',
      instructionsMd: 'You are Bravo.\n\nWrite directly.',
      name: 'Bravo',
      revisionId: createBody.data.activeRevision.id,
      slug: 'bravo',
      tools: {
        native: ['suspend_run'],
        toolProfileId: 'tpf_research_test',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PUT',
  })
  const updateBody = await updateResponse.json()

  assert.equal(updateResponse.status, 200)
  assert.equal(updateBody.ok, true)
  assert.equal(updateBody.data.name, 'Bravo')
  assert.equal(updateBody.data.description, 'Writes directly and keeps drafts tight.')
  assert.equal(updateBody.data.slug, 'bravo')
  assert.equal(updateBody.data.activeRevision.version, 2)
  assert.equal(updateBody.data.activeRevision.instructionsMd, 'You are Bravo.\n\nWrite directly.')
  assert.equal(updateBody.data.activeRevision.toolProfileId, 'tpf_research_test')
})

test('agent routes soft-delete owned agents and active lists hide them', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime, {
    accountId: 'acc_owner',
  })

  seedAgent(runtime, {
    activeRevisionId: 'agr_owned',
    agentId: 'agt_owned',
    createdByAccountId: accountId,
    name: 'Owned Agent',
    ownerAccountId: accountId,
    revisionId: 'agr_owned',
    slug: 'owned-agent',
    sourceMarkdown:
      '---\nname: Owned Agent\nschema: agent/v1\nslug: owned-agent\nvisibility: account_private\nkind: primary\n---\nOwned.',
    tenantId,
    visibility: 'account_private',
  })

  runtime.db
    .update(accountPreferences)
    .set({
      defaultAgentId: 'agt_owned',
      defaultTargetKind: 'agent',
      updatedAt: '2026-03-30T04:30:00.000Z',
    })
    .where(eq(accountPreferences.accountId, accountId))
    .run()

  const deleteResponse = await app.request('http://local/v1/agents/agt_owned', {
    headers,
    method: 'DELETE',
  })
  const deleteBody = await deleteResponse.json()

  assert.equal(deleteResponse.status, 200)
  assert.equal(deleteBody.ok, true)
  assert.deepEqual(deleteBody.data, {
    agentId: 'agt_owned',
    deleted: true,
  })

  const deletedAgent = runtime.db.select().from(agents).where(eq(agents.id, 'agt_owned')).get()
  assert.equal(deletedAgent?.status, 'deleted')

  const remainingDefault = runtime.db
    .select()
    .from(accountPreferences)
    .where(eq(accountPreferences.defaultAgentId, 'agt_owned'))
    .get()
  assert.equal(remainingDefault, undefined)

  const activeListResponse = await app.request('http://local/v1/agents?status=active', {
    headers,
  })
  const activeListBody = await activeListResponse.json()

  assert.equal(activeListResponse.status, 200)
  assert.deepEqual(activeListBody.data, [])

  const recreateResponse = await app.request('http://local/v1/agents', {
    body: JSON.stringify({
      description: 'Replacement agent after a soft delete.',
      instructionsMd: 'You are the replacement agent.',
      kind: 'primary',
      model: {
        modelAlias: 'gpt-5.4',
        provider: 'openai',
      },
      name: 'Owned Agent Replacement',
      slug: 'owned-agent',
      visibility: 'account_private',
      workspace: {
        strategy: 'isolated_run',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const recreateBody = await recreateResponse.json()

  assert.equal(recreateResponse.status, 201)
  assert.equal(recreateBody.ok, true)
  assert.equal(recreateBody.data.slug, 'owned-agent')
})

test('agent routes hide deleted subagents from detail and markdown export', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime, {
    accountId: 'acc_owner',
  })

  seedAgent(runtime, {
    activeRevisionId: 'agr_parent',
    agentId: 'agt_parent',
    createdByAccountId: accountId,
    name: 'Parent Agent',
    ownerAccountId: accountId,
    revisionId: 'agr_parent',
    slug: 'parent-agent',
    sourceMarkdown:
      '---\nname: Parent Agent\nschema: agent/v1\nslug: parent-agent\nvisibility: account_private\nkind: primary\n---\nParent.',
    tenantId,
    visibility: 'account_private',
  })

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: null,
      archivedAt: '2026-03-30T04:40:00.000Z',
      baseAgentId: null,
      createdAt: '2026-03-30T04:30:00.000Z',
      createdByAccountId: accountId,
      id: 'agt_deleted_child',
      kind: 'specialist',
      name: 'Deleted Child',
      ownerAccountId: accountId,
      slug: 'deleted-child',
      status: 'deleted',
      tenantId,
      updatedAt: '2026-03-30T04:40:00.000Z',
      visibility: 'account_private',
    })
    .run()

  runtime.db
    .insert(agentSubagentLinks)
    .values({
      alias: 'child',
      childAgentId: 'agt_deleted_child',
      createdAt: '2026-03-30T04:30:00.000Z',
      delegationMode: 'async_join',
      id: 'asl_deleted_child',
      parentAgentRevisionId: 'agr_parent',
      position: 0,
      tenantId,
    })
    .run()

  const detailResponse = await app.request('http://local/v1/agents/agt_parent', {
    headers,
  })
  const detailBody = await detailResponse.json()

  assert.equal(detailResponse.status, 200)
  assert.equal(detailBody.ok, true)
  assert.deepEqual(detailBody.data.subagents, [])

  const markdownResponse = await app.request('http://local/v1/agents/agt_parent/markdown', {
    headers,
  })
  const markdownBody = await markdownResponse.json()

  assert.equal(markdownResponse.status, 200)
  assert.equal(markdownBody.ok, true)

  const parsedMarkdown = parseAgentMarkdown(markdownBody.data.markdown)

  assert.equal(parsedMarkdown.ok, true)
  assert.deepEqual(parsedMarkdown.value.frontmatter.subagents ?? [], [])
})

test('agent routes enforce shared vs private visibility across accounts in the same tenant', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers, tenantId } = seedApiKeyAuth(runtime, {
    accountId: 'acc_owner',
  })

  runtime.db
    .insert(accounts)
    .values({
      createdAt: '2026-03-30T04:30:00.000Z',
      email: 'other@example.com',
      id: 'acc_other',
      name: 'Other',
      preferences: null,
      updatedAt: '2026-03-30T04:30:00.000Z',
    })
    .run()

  runtime.db
    .insert(tenantMemberships)
    .values({
      accountId: 'acc_other',
      createdAt: '2026-03-30T04:30:00.000Z',
      id: 'mem_other',
      role: 'member',
      tenantId,
    })
    .run()

  seedAgent(runtime, {
    activeRevisionId: 'agr_owned',
    agentId: 'agt_owned',
    createdByAccountId: 'acc_owner',
    name: 'Owned Private',
    ownerAccountId: 'acc_owner',
    revisionId: 'agr_owned',
    slug: 'owned-private',
    sourceMarkdown:
      '---\nname: Owned Private\nschema: agent/v1\nslug: owned-private\nvisibility: account_private\nkind: primary\n---\nOwned.',
    visibility: 'account_private',
  })
  seedAgent(runtime, {
    activeRevisionId: 'agr_shared',
    agentId: 'agt_shared',
    createdByAccountId: 'acc_other',
    name: 'Shared Specialist',
    ownerAccountId: 'acc_other',
    revisionId: 'agr_shared',
    slug: 'shared-specialist',
    sourceMarkdown:
      '---\nname: Shared Specialist\nschema: agent/v1\nslug: shared-specialist\nvisibility: tenant_shared\nkind: primary\n---\nShared.',
    visibility: 'tenant_shared',
  })
  seedAgent(runtime, {
    activeRevisionId: 'agr_hidden',
    agentId: 'agt_hidden',
    createdByAccountId: 'acc_other',
    name: 'Hidden Private',
    ownerAccountId: 'acc_other',
    revisionId: 'agr_hidden',
    slug: 'hidden-private',
    sourceMarkdown:
      '---\nname: Hidden Private\nschema: agent/v1\nslug: hidden-private\nvisibility: account_private\nkind: primary\n---\nHidden.',
    visibility: 'account_private',
  })

  const listResponse = await app.request('http://local/v1/agents', {
    headers,
  })
  const listBody = await listResponse.json()

  assert.equal(listResponse.status, 200)
  assert.deepEqual(listBody.data.map((agent: { id: string }) => agent.id).sort(), [
    'agt_owned',
    'agt_shared',
  ])

  const hiddenResponse = await app.request('http://local/v1/agents/agt_hidden', {
    headers,
  })
  const hiddenBody = await hiddenResponse.json()

  assert.equal(hiddenResponse.status, 403)
  assert.equal(hiddenBody.ok, false)
  assert.equal(hiddenBody.error.type, 'permission')
})

test('agent routes update markdown and can be selected as the current account default target', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const createResponse = await app.request('http://local/v1/agents', {
    body: JSON.stringify(baseCreatePayload),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()

  const markdownResponse = await app.request(
    `http://local/v1/agents/${createBody.data.id}/markdown`,
    {
      headers,
    },
  )
  const markdownBody = await markdownResponse.json()
  const parsedMarkdown = parseAgentMarkdown(markdownBody.data.markdown)

  assert.equal(parsedMarkdown.ok, true)

  const updatedMarkdown = serializeAgentMarkdown({
    ...parsedMarkdown.value,
    frontmatter: {
      ...parsedMarkdown.value.frontmatter,
      description: 'Markdown-driven update for Alpha.',
      name: 'Alpha Markdown',
      slug: 'alpha-markdown',
    },
    instructionsMd: 'You are Alpha Markdown.\n\nWork precisely.',
  })

  const updateMarkdownResponse = await app.request(
    `http://local/v1/agents/${createBody.data.id}/markdown`,
    {
      body: JSON.stringify({
        markdown: updatedMarkdown,
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'PUT',
    },
  )
  const updateMarkdownBody = await updateMarkdownResponse.json()

  assert.equal(updateMarkdownResponse.status, 200)
  assert.equal(updateMarkdownBody.data.description, 'Markdown-driven update for Alpha.')
  assert.equal(updateMarkdownBody.data.name, 'Alpha Markdown')
  assert.equal(updateMarkdownBody.data.slug, 'alpha-markdown')
  assert.equal(updateMarkdownBody.data.activeRevision.version, 2)

  const defaultResponse = await app.request('http://local/v1/account/preferences', {
    body: JSON.stringify({
      defaultTarget: {
        agentId: createBody.data.id,
        kind: 'agent',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })
  const defaultBody = await defaultResponse.json()

  assert.equal(defaultResponse.status, 200)
  assert.equal(defaultBody.ok, true)
  assert.deepEqual(defaultBody.data.defaultTarget, {
    agentId: createBody.data.id,
    kind: 'agent',
  })

  const defaultRows = runtime.db.select().from(accountPreferences).all()
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .slice()
    .sort((left, right) => left.eventNo - right.eventNo)
    .map((event) => event.type)

  assert.equal(defaultRows.length, 1)
  assert.equal(defaultRows[0]?.defaultAgentId, createBody.data.id)
  assert.equal(eventTypes.includes('agent.created'), true)
  assert.equal(eventTypes.filter((type) => type === 'agent.revision.created').length, 2)
})

test('structured agent updates preserve existing subagent links when the payload omits them', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const createJennyResponse = await app.request('http://local/v1/agents', {
    body: JSON.stringify({
      ...baseCreatePayload,
      name: 'Jenny',
      slug: 'jenny',
      tools: {
        toolProfileId: null,
        native: ['suspend_run'],
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createJennyBody = await createJennyResponse.json()

  assert.equal(createJennyResponse.status, 201)
  assert.equal(createJennyBody.data.activeRevision.toolProfileId, null)

  const createAliceResponse = await app.request('http://local/v1/agents', {
    body: JSON.stringify({
      ...baseCreatePayload,
      name: 'Alice',
      slug: 'alice',
      subagents: [
        {
          alias: 'jenny',
          mode: 'async_join',
          slug: 'jenny',
        },
      ],
      tools: {
        toolProfileId: null,
        native: ['delegate_to_agent', 'web_search'],
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createAliceBody = await createAliceResponse.json()

  assert.equal(createAliceResponse.status, 201)
  assert.equal(createAliceBody.data.subagents.length, 1)
  assert.equal(
    createAliceBody.data.subagents[0]?.childDescription,
    'Coordinates planning and execution work.',
  )
  assert.equal(createAliceBody.data.subagents[0]?.childSlug, 'jenny')
  assert.equal(createAliceBody.data.activeRevision.toolProfileId, null)

  const updateAliceResponse = await app.request(
    `http://local/v1/agents/${createAliceBody.data.id}`,
    {
      body: JSON.stringify({
        instructionsMd: 'You are Alice.\n\nUse tools precisely.',
        kind: 'primary',
        model: {
          modelAlias: 'default',
          provider: 'openai',
          reasoning: {
            effort: 'medium',
          },
        },
        name: 'Alice',
        revisionId: createAliceBody.data.activeRevision.id,
        slug: 'alice',
        tools: {
          toolProfileId: null,
          native: ['delegate_to_agent', 'web_search'],
        },
        visibility: 'account_private',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'PUT',
    },
  )
  const updateAliceBody = await updateAliceResponse.json()

  assert.equal(updateAliceResponse.status, 200)
  assert.equal(updateAliceBody.data.subagents.length, 1)
  assert.equal(
    updateAliceBody.data.subagents[0]?.childDescription,
    'Coordinates planning and execution work.',
  )
  assert.equal(updateAliceBody.data.subagents[0]?.childSlug, 'jenny')

  const markdownResponse = await app.request(
    `http://local/v1/agents/${createAliceBody.data.id}/markdown`,
    {
      headers,
    },
  )
  const markdownBody = await markdownResponse.json()
  const parsedMarkdown = parseAgentMarkdown(markdownBody.data.markdown)

  assert.equal(markdownResponse.status, 200)
  assert.equal(parsedMarkdown.ok, true)
  assert.deepEqual(parsedMarkdown.value.frontmatter.subagents, [
    {
      alias: 'jenny',
      mode: 'async_join',
      slug: createJennyBody.data.slug,
    },
  ])
})

test('agent routes derive sandbox native grants from sandbox policy on create', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const createResponse = await app.request('http://local/v1/agents', {
    body: JSON.stringify({
      ...baseCreatePayload,
      sandbox: {
        enabled: true,
        vault: {
          allowedRoots: ['/vault/overment'],
          mode: 'read_write',
        },
      },
      tools: {
        native: ['web_search'],
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()

  assert.equal(createResponse.status, 201)
  assert.equal(createBody.ok, true)
  assert.deepEqual(createBody.data.activeRevision.toolPolicyJson, {
    native: ['web_search', 'execute', 'commit_sandbox_writeback'],
  })
})

test('agent routes persist sandbox engine policy and shell metadata on create', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const createResponse = await app.request('http://local/v1/agents', {
    body: JSON.stringify({
      ...baseCreatePayload,
      sandbox: {
        enabled: true,
        packages: {
          allowedPackages: [
            {
              name: 'csv-parse',
              runtimes: ['lo', 'node'],
              versionRange: '5.6.0',
            },
          ],
          mode: 'allow_list',
        },
        runtime: {
          allowAutomaticCompatFallback: true,
          allowedEngines: ['lo', 'node'],
          defaultEngine: 'lo',
        },
        shell: {
          allowedCommands: ['find', 'grep'],
        },
        vault: {
          allowedRoots: ['/vault/overment'],
          mode: 'read_only',
        },
      },
      tools: {
        native: ['web_search'],
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()

  assert.equal(createResponse.status, 201)
  assert.equal(createBody.ok, true)
  assert.deepEqual(createBody.data.activeRevision.sandboxPolicyJson.runtime, {
    allowAutomaticCompatFallback: true,
    allowedEngines: ['lo', 'node'],
    allowWorkspaceScripts: false,
    defaultEngine: 'lo',
    maxDurationSec: 120,
    maxInputBytes: 25000000,
    maxMemoryMb: 512,
    maxOutputBytes: 25000000,
    nodeVersion: '22',
  })
  assert.deepEqual(createBody.data.activeRevision.sandboxPolicyJson.shell, {
    allowedCommands: ['find', 'grep'],
  })

  const parsedMarkdown = parseAgentMarkdown(createBody.data.activeRevision.sourceMarkdown)

  assert.equal(parsedMarkdown.ok, true)

  if (!parsedMarkdown.ok) {
    throw new Error('expected created agent markdown to parse')
  }

  assert.equal(
    parsedMarkdown.value.frontmatter.sandbox?.runtime?.allowAutomaticCompatFallback,
    true,
  )
  assert.deepEqual(parsedMarkdown.value.frontmatter.sandbox?.runtime?.allowedEngines, [
    'lo',
    'node',
  ])
  assert.equal(parsedMarkdown.value.frontmatter.sandbox?.runtime?.defaultEngine, 'lo')
  assert.equal(
    parsedMarkdown.value.frontmatter.sandbox?.packages?.allowedPackages?.[0]?.name,
    'csv-parse',
  )
  assert.deepEqual(
    parsedMarkdown.value.frontmatter.sandbox?.packages?.allowedPackages?.[0]?.runtimes,
    ['lo', 'node'],
  )
  assert.equal(
    parsedMarkdown.value.frontmatter.sandbox?.packages?.allowedPackages?.[0]?.versionRange,
    '5.6.0',
  )
  assert.deepEqual(parsedMarkdown.value.frontmatter.sandbox?.shell, {
    allowedCommands: ['find', 'grep'],
  })
})

test('agent routes derive browser native grants from kernel policy on create', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const createResponse = await app.request('http://local/v1/agents', {
    body: JSON.stringify({
      ...baseCreatePayload,
      kernel: {
        enabled: true,
        browser: {
          maxDurationSec: 90,
        },
      },
      tools: {
        native: ['web_search'],
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()

  assert.equal(createResponse.status, 201)
  assert.equal(createBody.ok, true)
  assert.deepEqual(createBody.data.activeRevision.toolPolicyJson, {
    native: ['web_search', 'browse'],
  })
  assert.equal(createBody.data.activeRevision.kernelPolicyJson.enabled, true)
  assert.equal(createBody.data.activeRevision.kernelPolicyJson.browser.maxDurationSec, 90)
})
