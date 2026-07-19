import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { pruneThreadHistoryInTransaction } from '../src/application/commands/thread-history-pruning'
import { withTransaction } from '../src/db/transaction'
import {
  domainEvents,
  eventPayloadSidecars,
  sessionThreads,
  tenants,
  workSessions,
  runs,
} from '../src/db/schema'
import { createTestHarness } from './helpers/create-test-app'

const now = '2026-03-29T00:00:00.000Z'

const seedSessionGraph = (runtime: ReturnType<typeof createTestHarness>['runtime']) => {
  runtime.db
    .insert(tenants)
    .values({
      createdAt: now,
      id: 'ten_test',
      name: 'Tenant',
      slug: 'tenant',
      status: 'active',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: null,
      deletedAt: null,
      id: 'ses_test',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Session',
      updatedAt: now,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: now,
      createdByAccountId: null,
      id: 'thr_test',
      parentThreadId: null,
      sessionId: 'ses_test',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Thread',
      updatedAt: now,
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      completedAt: now,
      configSnapshot: {},
      createdAt: now,
      errorJson: null,
      id: 'run_root',
      lastProgressAt: null,
      parentRunId: null,
      resultJson: null,
      rootRunId: 'run_root',
      sessionId: 'ses_test',
      sourceCallId: null,
      startedAt: now,
      status: 'completed',
      targetKind: 'assistant',
      task: 'Task',
      tenantId: 'ten_test',
      threadId: 'thr_test',
      toolProfileId: null,
      turnCount: 1,
      updatedAt: now,
      version: 1,
      workspaceRef: null,
    })
    .run()
}

test('pruneThreadHistoryInTransaction deletes event payload sidecars before their domain events and leaves no orphans', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  runtime.db
    .insert(domainEvents)
    .values({
      aggregateId: 'run_root',
      aggregateType: 'run',
      category: 'domain',
      createdAt: now,
      eventNo: 1,
      id: 'evt_generation_completed',
      payload: { status: 'completed' },
      tenantId: 'ten_test',
      traceId: 'trace_test',
      type: 'generation.completed',
    })
    .run()

  runtime.db
    .insert(eventPayloadSidecars)
    .values({
      createdAt: now,
      encoding: 'gzip-json-v1',
      eventId: 'evt_generation_completed',
      payloadCompressed: Buffer.from('compressed-payload-fixture'),
    })
    .run()

  const result = withTransaction(runtime.db, (tx) =>
    pruneThreadHistoryInTransaction(tx, {
      rootRunIds: ['run_root'],
      sessionId: 'ses_test',
      tenantId: 'ten_test',
    }),
  )

  assert.equal(result.ok, true)

  if (!result.ok) {
    return
  }

  assert.deepEqual(result.value.deletedRunIds, ['run_root'])

  assert.equal(
    runtime.db.select().from(domainEvents).where(eq(domainEvents.id, 'evt_generation_completed')).get(),
    undefined,
  )
  assert.equal(
    runtime.db
      .select()
      .from(eventPayloadSidecars)
      .where(eq(eventPayloadSidecars.eventId, 'evt_generation_completed'))
      .get(),
    undefined,
  )
})
