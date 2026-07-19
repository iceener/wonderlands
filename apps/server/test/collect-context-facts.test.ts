import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createRunRepository } from '../src/adapters/persistence/sqlite/runtime/run-repository'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { collectContextFacts } from '../src/application/context/collect-context-facts'
import { projectContextFactsToThreadContextData } from '../src/application/context/context-facts'
import { prepareContextState } from '../src/application/context/prepare-context-state'
import { loadThreadContext } from '../src/application/interactions/load-thread-context'
import {
  agentRevisions,
  agentSubagentLinks,
  agents,
  contextSummaries,
  fileLinks,
  files,
  gardenSites,
  memoryRecords,
  runDependencies,
  runs,
} from '../src/db/schema'
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

const seedGarden = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  accountId: string,
  tenantId: string,
) => {
  runtime.db
    .insert(gardenSites)
    .values({
      buildMode: 'manual',
      createdAt: now,
      createdByAccountId: accountId,
      currentBuildId: null,
      currentPublishedBuildId: null,
      deployMode: 'api_hosted',
      id: 'gst_facts_demo',
      isDefault: true,
      name: 'Facts Garden',
      protectedAccessMode: 'none',
      protectedSecretRef: null,
      protectedSessionTtlSeconds: 3600,
      slug: 'facts-demo',
      sourceScopePath: 'facts-demo',
      status: 'active',
      tenantId,
      updatedAt: now,
      updatedByAccountId: accountId,
    })
    .run()
}

const seedLinkedFile = async (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    body: string
    fileId: string
    linkType: 'message' | 'run'
    mimeType: string
    targetId: string
    tenantId: string
  },
) => {
  const storageKey = `${input.tenantId}/facts/${input.fileId}`
  const stored = await runtime.services.files.blobStore.put({
    data: Buffer.from(input.body),
    storageKey,
  })

  assert.equal(stored.ok, true)
  runtime.db
    .insert(files)
    .values({
      accessScope: 'session_local',
      checksumSha256: null,
      createdAt: now,
      createdByAccountId: input.accountId,
      createdByRunId: input.linkType === 'run' ? input.targetId : null,
      id: input.fileId,
      metadata: null,
      mimeType: input.mimeType,
      originUploadId: null,
      originalFilename: `${input.fileId}.txt`,
      sizeBytes: Buffer.byteLength(input.body),
      sourceKind: input.linkType === 'run' ? 'generated' : 'upload',
      status: 'ready',
      storageKey,
      tenantId: input.tenantId,
      title: `${input.fileId}.txt`,
      updatedAt: now,
    })
    .run()
  runtime.db
    .insert(fileLinks)
    .values({
      createdAt: now,
      fileId: input.fileId,
      id: `flk_${input.fileId}`,
      linkType: input.linkType,
      targetId: input.targetId,
      tenantId: input.tenantId,
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

const seedRootMemoryAndBoundaries = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  run: RunRecord,
) => {
  runtime.db
    .insert(contextSummaries)
    .values({
      content: 'Earlier durable summary.',
      createdAt: now,
      fromSequence: 0,
      id: 'sum_facts_root',
      modelKey: 'main_thread_compaction_v1',
      previousSummaryId: null,
      runId: run.id,
      tenantId: run.tenantId,
      throughSequence: 0,
      tokensAfter: 5,
      tokensBefore: 20,
      turnNumber: 0,
    })
    .run()
  runtime.db
    .insert(memoryRecords)
    .values([
      {
        content: { observations: [{ text: 'Root observation.' }], source: 'observer_v1' },
        createdAt: '2026-04-09T10:00:01.000Z',
        generation: 1,
        id: 'mrec_facts_root_observation',
        kind: 'observation',
        ownerRunId: run.id,
        parentRecordId: null,
        rootRunId: run.id,
        scopeKind: 'agent_profile',
        scopeRef: run.agentId!,
        sessionId: run.sessionId,
        status: 'active',
        tenantId: run.tenantId,
        threadId: run.threadId,
        tokenCount: 4,
        visibility: 'private',
      },
      {
        content: { reflection: 'Root reflection.', source: 'reflector_v1' },
        createdAt: '2026-04-09T10:00:02.000Z',
        generation: 1,
        id: 'mrec_facts_root_reflection',
        kind: 'reflection',
        ownerRunId: run.id,
        parentRecordId: null,
        rootRunId: run.id,
        scopeKind: 'agent_profile',
        scopeRef: run.agentId!,
        sessionId: run.sessionId,
        status: 'active',
        tenantId: run.tenantId,
        threadId: run.threadId,
        tokenCount: 4,
        visibility: 'private',
      },
    ])
    .run()
  runtime.db
    .insert(runDependencies)
    .values({
      callId: 'call_facts_pending',
      createdAt: now,
      description: 'Await durable child result',
      id: 'dep_facts_pending',
      resolutionJson: null,
      resolvedAt: null,
      runId: run.id,
      status: 'pending',
      targetKind: 'human_response',
      targetRef: 'researcher',
      targetRunId: null,
      tenantId: run.tenantId,
      timeoutAt: null,
      type: 'human',
    })
    .run()
}

test('collectContextFacts is immutable, deeply deterministic, read-only, and projects legacy shape', async () => {
  const { app, runtime } = createTestHarness({ AUTH_MODE: 'api_key', NODE_ENV: 'test' })
  const auth = seedApiKeyAuth(runtime)
  const scope = scopeFor(auth.accountId, auth.tenantId)

  seedAgent(runtime, {
    accountId: auth.accountId,
    agentId: 'agt_facts_parent',
    description: 'Coordinates durable context.',
    instructions: 'Use only prepared facts.',
    name: 'Facts Parent',
    preferredSlugs: ['facts-demo'],
    revisionId: 'agr_facts_parent_v1',
    slug: 'facts-parent',
    tenantId: auth.tenantId,
  })
  seedAgent(runtime, {
    accountId: auth.accountId,
    agentId: 'agt_facts_child',
    description: 'Researches immutable context.',
    instructions: 'Research facts.',
    name: 'Facts Child',
    nativeTools: ['web_search'],
    revisionId: 'agr_facts_child_v1',
    slug: 'facts-child',
    tenantId: auth.tenantId,
  })
  runtime.db
    .insert(agentSubagentLinks)
    .values({
      alias: 'researcher',
      childAgentId: 'agt_facts_child',
      createdAt: now,
      delegationMode: 'async_join',
      id: 'asl_facts_child',
      parentAgentRevisionId: 'agr_facts_parent_v1',
      position: 0,
      tenantId: auth.tenantId,
    })
    .run()
  seedGarden(runtime, auth.accountId, auth.tenantId)

  const bootstrap = await bootstrapAgentRun(app, auth.headers)
  const run = requireRun(runtime, scope, bootstrap.data.runId)
  await seedLinkedFile(runtime, {
    accountId: auth.accountId,
    body: 'Message-linked immutable text.',
    fileId: 'fil_facts_message',
    linkType: 'message',
    mimeType: 'text/plain',
    targetId: bootstrap.data.messageId,
    tenantId: auth.tenantId,
  })
  await seedLinkedFile(runtime, {
    accountId: auth.accountId,
    body: 'Run-generated immutable text.',
    fileId: 'fil_facts_run',
    linkType: 'run',
    mimeType: 'text/plain',
    targetId: run.id,
    tenantId: auth.tenantId,
  })
  seedRootMemoryAndBoundaries(runtime, run)

  const context = createInternalCommandContext(runtime, scope)
  const prepared = await prepareContextState(context, run, collectionOptions)

  assert.equal(prepared.ok, true)
  if (!prepared.ok) {
    throw new Error(prepared.error.message)
  }

  let aiCalls = 0
  runtime.services.ai.interactions.generate = async () => {
    aiCalls += 1
    throw new Error('fact collection must not invoke AI')
  }
  let clockCalls = 0
  const originalNowIso = runtime.services.clock.nowIso
  runtime.services.clock.nowIso = () => {
    clockCalls += 1
    return originalNowIso()
  }

  const beforeCounts = snapshotTableCounts(runtime)
  const first = await collectContextFacts(context, prepared.value)
  const second = await collectContextFacts(context, prepared.value)
  const afterCounts = snapshotTableCounts(runtime)

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.deepEqual(afterCounts, beforeCounts)
  assert.equal(aiCalls, 0)
  assert.equal(clockCalls, 0)
  if (!first.ok || !second.ok) {
    throw new Error('facts were not collected')
  }

  assert.deepEqual(first.value, second.value)
  assert.notEqual(first.value, second.value)
  assert.equal(first.value.capturedAt, prepared.value.run.updatedAt)
  assert.deepEqual(first.value.readiness, prepared.value.readiness)
  assert.equal(Object.isFrozen(first.value), true)
  assert.equal(Object.isFrozen(first.value.visibleFiles), true)
  assert.equal(Object.isFrozen(first.value.run), true)
  assert.equal(first.value.items[0]?.role, 'user')
  assert.equal(first.value.summary?.id, 'sum_facts_root')
  assert.equal(first.value.pendingWaits[0]?.id, 'dep_facts_pending')
  assert.equal(first.value.attachmentRefs[0]?.fileId, 'fil_facts_message')
  assert.deepEqual(first.value.visibleFiles.map((entry) => entry.fileId).sort(), [
    'fil_facts_message',
    'fil_facts_run',
  ])
  assert.equal(first.value.agentProfile?.instructionsMd, 'Use only prepared facts.')
  assert.deepEqual(first.value.agentProfile?.subagents, [
    {
      alias: 'researcher',
      childAgentId: 'agt_facts_child',
      childDescription: 'Researches immutable context.',
      childName: 'Facts Child',
      childSlug: 'facts-child',
      delegationMode: 'async_join',
      tools: [
        {
          description: 'Search the web for public information.',
          kind: 'provider',
          name: 'web_search',
          title: null,
        },
      ],
    },
  ])
  assert.equal(first.value.gardenContext?.recommendedGarden?.slug, 'facts-demo')
  assert.equal(first.value.observations[0]?.id, 'mrec_facts_root_observation')
  assert.equal(first.value.activeReflection?.id, 'mrec_facts_root_reflection')

  runtime.services.clock.nowIso = originalNowIso
  const legacy = await loadThreadContext(context, run, collectionOptions)

  assert.equal(legacy.ok, true)
  assert.deepEqual(
    projectContextFactsToThreadContextData(first.value),
    legacy.ok ? legacy.value : null,
  )
  assert.equal(Object.isFrozen(projectContextFactsToThreadContextData(first.value)), false)
})

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
