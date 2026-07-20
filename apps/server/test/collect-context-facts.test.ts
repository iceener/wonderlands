import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createRunRepository } from '../src/adapters/persistence/sqlite/runtime/run-repository'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { collectContextFacts } from '../src/application/context/collect-context-facts'
import { prepareContextState } from '../src/application/context/prepare-context-state'
import { agentRevisions, agents, memoryRecords, runs } from '../src/db/schema'
import type { RunRecord } from '../src/domain/runtime/run-repository'
import { asAccountId, asRunId, asTenantId } from '../src/shared/ids'
import type { TenantScope } from '../src/shared/scope'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const now = '2026-04-09T10:00:00.000Z'
const collectionOptions = { compact: false, observe: false, reflect: false } as const

const scopeFor = (accountId: string, tenantId: string): TenantScope => ({
  accountId: asAccountId(accountId),
  role: 'admin',
  tenantId: asTenantId(tenantId),
})

const requireRun = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  scope: TenantScope,
  runId: string,
): RunRecord => {
  const result = createRunRepository(runtime.db).getById(scope, asRunId(runId))

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }

  return result.value
}

const seedAgent = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    agentId: string
    description: string
    instructions: string
    name: string
    nativeTools?: string[]
    preferredSlugs?: string[]
    revisionId: string
    slug: string
    tenantId: string
  },
) => {
  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: input.revisionId,
      archivedAt: null,
      baseAgentId: null,
      createdAt: now,
      createdByAccountId: input.accountId,
      id: input.agentId,
      kind: 'primary',
      name: input.name,
      ownerAccountId: input.accountId,
      slug: input.slug,
      status: 'active',
      tenantId: input.tenantId,
      updatedAt: now,
      visibility: 'account_private',
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId: input.agentId,
      checksumSha256: `${input.revisionId}_checksum`,
      createdAt: now,
      createdByAccountId: input.accountId,
      frontmatterJson: {
        agent_id: input.agentId,
        description: input.description,
        kind: 'primary',
        name: input.name,
        revision_id: input.revisionId,
        schema: 'agent/v1',
        slug: input.slug,
        visibility: 'account_private',
      },
      gardenFocusJson: { preferredSlugs: input.preferredSlugs ?? [] },
      id: input.revisionId,
      instructionsMd: input.instructions,
      kernelPolicyJson: {},
      memoryPolicyJson: {},
      modelConfigJson: { modelAlias: 'gpt-5.4', provider: 'openai' },
      resolvedConfigJson: {},
      sandboxPolicyJson: {},
      sourceMarkdown: `---\nschema: agent/v1\nname: ${input.name}\nslug: ${input.slug}\nkind: primary\nvisibility: account_private\ndescription: ${input.description}\n---\n${input.instructions}`,
      tenantId: input.tenantId,
      toolPolicyJson: { native: input.nativeTools ?? [] },
      version: 1,
      workspacePolicyJson: {},
    })
    .run()
}

const snapshotTableCounts = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
): Record<string, number> => {
  const tableRows = runtime.db.sqlite
    .prepare<{ name: string }>(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
    )
    .all()

  return Object.fromEntries(
    tableRows.map(({ name }) => {
      const escapedName = name.replaceAll('"', '""')
      const row = runtime.db.sqlite
        .prepare<{ count: number }>(`select count(*) as count from "${escapedName}"`)
        .get()

      return [name, row?.count ?? 0]
    }),
  )
}

const bootstrapAgentRun = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Read the attached facts and remember the Garden.',
      target: { agentId: 'agt_facts_parent', kind: 'agent' },
      title: 'Context facts',
    }),
    headers: { ...headers, 'content-type': 'application/json' },
    method: 'POST',
  })

  assert.equal(response.status, 201)
  return (await response.json()) as {
    data: { messageId: string; runId: string; sessionId: string; threadId: string }
  }
}

test('collectContextFacts uses child run-local memory and prepared child boundaries', async () => {
  const { app, runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const auth = seedApiKeyAuth(runtime)
  const scope = scopeFor(auth.accountId, auth.tenantId)
  seedAgent(runtime, {
    accountId: auth.accountId,
    agentId: 'agt_facts_parent',
    description: 'Parent.',
    instructions: 'Parent facts.',
    name: 'Facts Parent',
    revisionId: 'agr_facts_parent_v1',
    slug: 'facts-parent',
    tenantId: auth.tenantId,
  })
  const bootstrap = await bootstrapAgentRun(app, auth.headers)
  const rootRun = requireRun(runtime, scope, bootstrap.data.runId)
  const rootRow = runtime.db.select().from(runs).get()

  assert.ok(rootRow)
  runtime.db
    .insert(runs)
    .values({
      ...rootRow,
      id: 'run_facts_child',
      jobId: null,
      parentRunId: rootRun.id,
      rootRunId: rootRun.id,
      sourceCallId: 'call_facts_child',
      threadId: null,
      updatedAt: '2026-04-09T10:00:03.000Z',
    })
    .run()
  const childRun = requireRun(runtime, scope, 'run_facts_child')
  runtime.db
    .insert(memoryRecords)
    .values({
      content: { observations: [{ text: 'Child-local observation.' }], source: 'observer_v1' },
      createdAt: now,
      generation: 1,
      id: 'mrec_facts_child_observation',
      kind: 'observation',
      ownerRunId: childRun.id,
      parentRecordId: null,
      rootRunId: rootRun.id,
      scopeKind: 'run_local',
      scopeRef: childRun.id,
      sessionId: childRun.sessionId,
      status: 'active',
      tenantId: childRun.tenantId,
      threadId: null,
      tokenCount: 3,
      visibility: 'private',
    })
    .run()

  const context = createInternalCommandContext(runtime, scope)
  const prepared = await prepareContextState(context, childRun, collectionOptions)

  assert.equal(prepared.ok, true)
  if (!prepared.ok) {
    throw new Error(prepared.error.message)
  }

  const beforeCounts = snapshotTableCounts(runtime)
  const collected = await collectContextFacts(context, prepared.value)

  assert.equal(collected.ok, true)
  assert.deepEqual(snapshotTableCounts(runtime), beforeCounts)
  if (!collected.ok) {
    throw new Error(collected.error.message)
  }

  assert.equal(collected.value.run.parentRunId, rootRun.id)
  assert.equal(collected.value.capturedAt, '2026-04-09T10:00:03.000Z')
  assert.deepEqual(collected.value.visibleMessages, [])
  assert.deepEqual(collected.value.items, [])
  assert.deepEqual(
    collected.value.observations.map((record) => record.id),
    ['mrec_facts_child_observation'],
  )
  assert.equal(collected.value.activeReflection, null)
})
