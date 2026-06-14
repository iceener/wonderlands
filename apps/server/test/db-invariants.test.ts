import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import {
  accounts,
  agentRevisions,
  agents,
  contextSummaries,
  domainEvents,
  eventOutbox,
  items,
  runDependencies,
  runs,
  sessionMessages,
  sessionThreads,
  tenants,
  workSessions,
  workspaces,
} from '../src/db/schema'
import { createTestHarness } from './helpers/create-test-app'

const seedSessionGraph = (runtime: ReturnType<typeof createTestHarness>['runtime']) => {
  runtime.db
    .insert(tenants)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      id: 'ten_test',
      name: 'Tenant',
      slug: 'tenant',
      status: 'active',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      deletedAt: null,
      id: 'ses_test',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Session',
      updatedAt: '2026-03-29T00:00:00.000Z',
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'thr_test',
      parentThreadId: null,
      sessionId: 'ses_test',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Thread',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()
}

const expectSqliteError = (operation: () => void, messagePattern: RegExp) => {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, messagePattern)

    return true
  })
}

const seedAccount = (runtime: ReturnType<typeof createTestHarness>['runtime'], id = 'acc_test') => {
  runtime.db
    .insert(accounts)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      email: `${id}@example.com`,
      id,
      name: 'Account',
      preferences: null,
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()
}

const insertRun = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: Record<string, unknown> & {
    agentId?: string | null
    profile?: string
    targetKind?: 'agent' | 'assistant'
  },
) => {
  const { profile: _legacyProfile, targetKind, ...values } = input

  runtime.db
    .insert(runs)
    .values({
      ...values,
      targetKind:
        targetKind ??
        (typeof values.agentId === 'string' && values.agentId.length > 0 ? 'agent' : 'assistant'),
      toolProfileId: null,
    })
    .run()
}

const insertRuns = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  inputs: Array<
    Record<string, unknown> & {
      agentId?: string | null
      profile?: string
      targetKind?: 'agent' | 'assistant'
    }
  >,
) => {
  for (const input of inputs) {
    insertRun(runtime, input)
  }
}

test('runs rejects invalid root-run combinations', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  expectSqliteError(() => {
    insertRun(runtime, {
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:00:00.000Z',
      errorJson: null,
      id: 'run_invalid',
      lastProgressAt: null,
      parentRunId: null,
      profile: 'default',
      resultJson: null,
      rootRunId: 'run_other',
      sessionId: 'ses_test',
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: 'Task',
      tenantId: 'ten_test',
      threadId: 'thr_test',
      turnCount: 0,
      updatedAt: '2026-03-29T00:00:00.000Z',
      version: 1,
      workspaceRef: null,
    })
  }, /CHECK constraint failed: runs_root_run_rule/)
})

test('wait_entries rejects invalid agent wait semantics', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  insertRun(runtime, {
    completedAt: null,
    configSnapshot: {},
    createdAt: '2026-03-29T00:00:00.000Z',
    errorJson: null,
    id: 'run_root',
    lastProgressAt: null,
    parentRunId: null,
    profile: 'default',
    resultJson: null,
    rootRunId: 'run_root',
    sessionId: 'ses_test',
    sourceCallId: null,
    startedAt: null,
    status: 'pending',
    task: 'Task',
    tenantId: 'ten_test',
    threadId: 'thr_test',
    turnCount: 0,
    updatedAt: '2026-03-29T00:00:00.000Z',
    version: 1,
    workspaceRef: null,
  })

  expectSqliteError(() => {
    runtime.db
      .insert(runDependencies)
      .values({
        callId: 'call_1',
        createdAt: '2026-03-29T00:00:00.000Z',
        description: null,
        id: 'wte_invalid',
        resolutionJson: null,
        resolvedAt: null,
        runId: 'run_root',
        status: 'pending',
        targetKind: 'tool_execution',
        targetRef: null,
        targetRunId: null,
        tenantId: 'ten_test',
        timeoutAt: null,
        type: 'agent',
      })
      .run()
  }, /CHECK constraint failed: run_dependencies_agent_target_rule/)
})

test('context_summaries rejects inverted sequence ranges', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  insertRun(runtime, {
    completedAt: null,
    configSnapshot: {},
    createdAt: '2026-03-29T00:00:00.000Z',
    errorJson: null,
    id: 'run_root',
    lastProgressAt: null,
    parentRunId: null,
    profile: 'default',
    resultJson: null,
    rootRunId: 'run_root',
    sessionId: 'ses_test',
    sourceCallId: null,
    startedAt: null,
    status: 'pending',
    task: 'Task',
    tenantId: 'ten_test',
    threadId: 'thr_test',
    turnCount: 0,
    updatedAt: '2026-03-29T00:00:00.000Z',
    version: 1,
    workspaceRef: null,
  })

  expectSqliteError(() => {
    runtime.db
      .insert(contextSummaries)
      .values({
        content: 'Summary',
        createdAt: '2026-03-29T00:00:00.000Z',
        fromSequence: 10,
        id: 'sum_invalid',
        modelKey: 'default',
        previousSummaryId: null,
        runId: 'run_root',
        tenantId: 'ten_test',
        throughSequence: 5,
        tokensAfter: null,
        tokensBefore: null,
        turnNumber: null,
      })
      .run()
  }, /CHECK constraint failed: context_summaries_sequence_rule/)
})

test('context_summaries rejects previous summaries outside the same run', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  insertRuns(runtime, [
    {
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:00:00.000Z',
      errorJson: null,
      id: 'run_root',
      lastProgressAt: null,
      parentRunId: null,
      profile: 'default',
      resultJson: null,
      rootRunId: 'run_root',
      sessionId: 'ses_test',
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: 'Root task',
      tenantId: 'ten_test',
      threadId: 'thr_test',
      turnCount: 0,
      updatedAt: '2026-03-29T00:00:00.000Z',
      version: 1,
      workspaceRef: null,
    },
    {
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:01:00.000Z',
      errorJson: null,
      id: 'run_other',
      lastProgressAt: null,
      parentRunId: null,
      profile: 'default',
      resultJson: null,
      rootRunId: 'run_other',
      sessionId: 'ses_test',
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: 'Other task',
      tenantId: 'ten_test',
      threadId: 'thr_test',
      turnCount: 0,
      updatedAt: '2026-03-29T00:01:00.000Z',
      version: 1,
      workspaceRef: null,
    },
  ])

  runtime.db
    .insert(contextSummaries)
    .values({
      content: 'Other run summary',
      createdAt: '2026-03-29T00:02:00.000Z',
      fromSequence: 1,
      id: 'sum_other',
      modelKey: 'summary-model',
      previousSummaryId: null,
      runId: 'run_other',
      tenantId: 'ten_test',
      throughSequence: 3,
      tokensAfter: 10,
      tokensBefore: 30,
      turnNumber: 1,
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(contextSummaries)
      .values({
        content: 'Invalid linked summary',
        createdAt: '2026-03-29T00:03:00.000Z',
        fromSequence: 4,
        id: 'sum_invalid_scope',
        modelKey: 'summary-model',
        previousSummaryId: 'sum_other',
        runId: 'run_root',
        tenantId: 'ten_test',
        throughSequence: 6,
        tokensAfter: 12,
        tokensBefore: 40,
        turnNumber: 2,
      })
      .run()
  }, /context_summaries\.previous_summary_id must reference a summary in the same run and tenant/)
})

test('context_summaries rejects overlapping sequence ranges within the same run', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  insertRun(runtime, {
    completedAt: null,
    configSnapshot: {},
    createdAt: '2026-03-29T00:00:00.000Z',
    errorJson: null,
    id: 'run_root',
    lastProgressAt: null,
    parentRunId: null,
    profile: 'default',
    resultJson: null,
    rootRunId: 'run_root',
    sessionId: 'ses_test',
    sourceCallId: null,
    startedAt: null,
    status: 'pending',
    task: 'Root task',
    tenantId: 'ten_test',
    threadId: 'thr_test',
    turnCount: 0,
    updatedAt: '2026-03-29T00:00:00.000Z',
    version: 1,
    workspaceRef: null,
  })

  runtime.db
    .insert(contextSummaries)
    .values({
      content: 'First summary',
      createdAt: '2026-03-29T00:01:00.000Z',
      fromSequence: 1,
      id: 'sum_first',
      modelKey: 'summary-model',
      previousSummaryId: null,
      runId: 'run_root',
      tenantId: 'ten_test',
      throughSequence: 5,
      tokensAfter: 15,
      tokensBefore: 45,
      turnNumber: 1,
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(contextSummaries)
      .values({
        content: 'Overlapping summary',
        createdAt: '2026-03-29T00:02:00.000Z',
        fromSequence: 5,
        id: 'sum_overlap',
        modelKey: 'summary-model',
        previousSummaryId: 'sum_first',
        runId: 'run_root',
        tenantId: 'ten_test',
        throughSequence: 8,
        tokensAfter: 14,
        tokensBefore: 30,
        turnNumber: 2,
      })
      .run()
  }, /context_summaries sequence ranges must not overlap within the same run/)
})

test('session_threads rejects tenant mismatches with the parent session', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  runtime.db
    .insert(tenants)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      id: 'ten_other',
      name: 'Other Tenant',
      slug: 'other-tenant',
      status: 'active',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(sessionThreads)
      .values({
        createdAt: '2026-03-29T00:00:00.000Z',
        createdByAccountId: null,
        id: 'thr_wrong_tenant',
        parentThreadId: null,
        sessionId: 'ses_test',
        status: 'active',
        tenantId: 'ten_other',
        title: 'Wrong tenant thread',
        updatedAt: '2026-03-29T00:00:00.000Z',
      })
      .run()
  }, /FOREIGN KEY constraint failed/)
})

test('session_threads rejects parent threads that belong to a different session', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      deletedAt: null,
      id: 'ses_other',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other session',
      updatedAt: '2026-03-29T00:00:00.000Z',
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'thr_other',
      parentThreadId: null,
      sessionId: 'ses_other',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other thread',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(sessionThreads)
      .values({
        createdAt: '2026-03-29T00:00:00.000Z',
        createdByAccountId: null,
        id: 'thr_invalid_parent_scope',
        parentThreadId: 'thr_other',
        sessionId: 'ses_test',
        status: 'active',
        tenantId: 'ten_test',
        title: 'Wrong parent thread',
        updatedAt: '2026-03-29T00:00:00.000Z',
      })
      .run()
  }, /FOREIGN KEY constraint failed/)
})

test('session_messages rejects threads that do not belong to the declared session', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      deletedAt: null,
      id: 'ses_other',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other session',
      updatedAt: '2026-03-29T00:00:00.000Z',
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'thr_other',
      parentThreadId: null,
      sessionId: 'ses_other',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other thread',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(sessionMessages)
      .values({
        authorAccountId: null,
        authorKind: 'user',
        content: [{ text: 'hello', type: 'text' }],
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'msg_invalid_thread_scope',
        metadata: null,
        runId: null,
        sequence: 1,
        sessionId: 'ses_test',
        tenantId: 'ten_test',
        threadId: 'thr_other',
      })
      .run()
  }, /FOREIGN KEY constraint failed/)
})

test('session_messages rejects runs that do not belong to the declared session', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      deletedAt: null,
      id: 'ses_other',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other session',
      updatedAt: '2026-03-29T00:00:00.000Z',
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'thr_other',
      parentThreadId: null,
      sessionId: 'ses_other',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other thread',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  insertRun(runtime, {
    completedAt: null,
    configSnapshot: {},
    createdAt: '2026-03-29T00:00:00.000Z',
    errorJson: null,
    id: 'run_other',
    lastProgressAt: null,
    parentRunId: null,
    profile: 'default',
    resultJson: null,
    rootRunId: 'run_other',
    sessionId: 'ses_other',
    sourceCallId: null,
    startedAt: null,
    status: 'pending',
    task: 'Task',
    tenantId: 'ten_test',
    threadId: 'thr_other',
    turnCount: 0,
    updatedAt: '2026-03-29T00:00:00.000Z',
    version: 1,
    workspaceRef: null,
  })

  expectSqliteError(() => {
    runtime.db
      .insert(sessionMessages)
      .values({
        authorAccountId: null,
        authorKind: 'user',
        content: [{ text: 'hello', type: 'text' }],
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'msg_invalid_run_scope',
        metadata: null,
        runId: 'run_other',
        sequence: 1,
        sessionId: 'ses_test',
        tenantId: 'ten_test',
        threadId: 'thr_test',
      })
      .run()
  }, /FOREIGN KEY constraint failed/)
})

test('work_sessions rejects root runs during insert before the run exists', () => {
  const { runtime } = createTestHarness()

  runtime.db
    .insert(tenants)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      id: 'ten_test',
      name: 'Tenant',
      slug: 'tenant',
      status: 'active',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(workSessions)
      .values({
        archivedAt: null,
        createdAt: '2026-03-29T00:00:00.000Z',
        createdByAccountId: null,
        deletedAt: null,
        id: 'ses_invalid_root_run',
        metadata: null,
        rootRunId: 'run_missing',
        status: 'active',
        tenantId: 'ten_test',
        title: 'Session',
        updatedAt: '2026-03-29T00:00:00.000Z',
        workspaceRef: null,
      })
      .run()
  }, /work_sessions\.root_run_id must be assigned after the root run exists/)
})

test('work_sessions rejects root runs that do not belong to the same session', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      deletedAt: null,
      id: 'ses_other',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other session',
      updatedAt: '2026-03-29T00:00:00.000Z',
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'thr_other',
      parentThreadId: null,
      sessionId: 'ses_other',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other thread',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  insertRun(runtime, {
    completedAt: null,
    configSnapshot: {},
    createdAt: '2026-03-29T00:00:00.000Z',
    errorJson: null,
    id: 'run_other',
    lastProgressAt: null,
    parentRunId: null,
    profile: 'default',
    resultJson: null,
    rootRunId: 'run_other',
    sessionId: 'ses_other',
    sourceCallId: null,
    startedAt: null,
    status: 'pending',
    task: 'Task',
    tenantId: 'ten_test',
    threadId: 'thr_other',
    turnCount: 0,
    updatedAt: '2026-03-29T00:00:00.000Z',
    version: 1,
    workspaceRef: null,
  })

  expectSqliteError(() => {
    runtime.db
      .update(workSessions)
      .set({
        rootRunId: 'run_other',
      })
      .where(eq(workSessions.id, 'ses_test'))
      .run()
  }, /work_sessions\.root_run_id must reference a run in the same session and tenant/)
})

test('items rejects message rows without message payload', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  insertRun(runtime, {
    completedAt: null,
    configSnapshot: {},
    createdAt: '2026-03-29T00:00:00.000Z',
    errorJson: null,
    id: 'run_root',
    lastProgressAt: null,
    parentRunId: null,
    profile: 'default',
    resultJson: null,
    rootRunId: 'run_root',
    sessionId: 'ses_test',
    sourceCallId: null,
    startedAt: null,
    status: 'pending',
    task: 'Task',
    tenantId: 'ten_test',
    threadId: 'thr_test',
    turnCount: 0,
    updatedAt: '2026-03-29T00:00:00.000Z',
    version: 1,
    workspaceRef: null,
  })

  expectSqliteError(() => {
    runtime.db
      .insert(items)
      .values({
        arguments: null,
        callId: null,
        content: null,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'itm_invalid_message',
        name: null,
        output: null,
        providerPayload: null,
        role: 'user',
        runId: 'run_root',
        sequence: 1,
        summary: null,
        tenantId: 'ten_test',
        type: 'message',
      })
      .run()
  }, /CHECK constraint failed: items_type_payload_rule/)
})

test('runs rejects child parents outside the same session and root scope', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      deletedAt: null,
      id: 'ses_other',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other session',
      updatedAt: '2026-03-29T00:00:00.000Z',
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'thr_other',
      parentThreadId: null,
      sessionId: 'ses_other',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Other thread',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  insertRuns(runtime, [
    {
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:00:00.000Z',
      errorJson: null,
      id: 'run_root',
      lastProgressAt: null,
      parentRunId: null,
      profile: 'default',
      resultJson: null,
      rootRunId: 'run_root',
      sessionId: 'ses_test',
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: 'Task',
      tenantId: 'ten_test',
      threadId: 'thr_test',
      turnCount: 0,
      updatedAt: '2026-03-29T00:00:00.000Z',
      version: 1,
      workspaceRef: null,
    },
    {
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:00:00.000Z',
      errorJson: null,
      id: 'run_other_root',
      lastProgressAt: null,
      parentRunId: null,
      profile: 'default',
      resultJson: null,
      rootRunId: 'run_other_root',
      sessionId: 'ses_other',
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: 'Task',
      tenantId: 'ten_test',
      threadId: 'thr_other',
      turnCount: 0,
      updatedAt: '2026-03-29T00:00:00.000Z',
      version: 1,
      workspaceRef: null,
    },
  ])

  expectSqliteError(() => {
    insertRun(runtime, {
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:00:00.000Z',
      errorJson: null,
      id: 'run_invalid_child',
      lastProgressAt: null,
      parentRunId: 'run_other_root',
      profile: 'default',
      resultJson: null,
      rootRunId: 'run_root',
      sessionId: 'ses_test',
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: 'Task',
      tenantId: 'ten_test',
      threadId: null,
      turnCount: 0,
      updatedAt: '2026-03-29T00:00:00.000Z',
      version: 1,
      workspaceRef: null,
    })
  }, /runs\.parent_run_id must reference a run in the same session, root run, and tenant/)
})

test('runs allows private child runs without a visible thread binding', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  insertRun(runtime, {
    completedAt: null,
    configSnapshot: {},
    createdAt: '2026-03-29T00:00:00.000Z',
    errorJson: null,
    id: 'run_root',
    lastProgressAt: null,
    parentRunId: null,
    profile: 'default',
    resultJson: null,
    rootRunId: 'run_root',
    sessionId: 'ses_test',
    sourceCallId: null,
    startedAt: null,
    status: 'pending',
    task: 'Task',
    tenantId: 'ten_test',
    threadId: 'thr_test',
    turnCount: 0,
    updatedAt: '2026-03-29T00:00:00.000Z',
    version: 1,
    workspaceRef: null,
  })

  insertRun(runtime, {
    completedAt: null,
    configSnapshot: {},
    createdAt: '2026-03-29T00:00:00.000Z',
    errorJson: null,
    id: 'run_child_private',
    lastProgressAt: null,
    parentRunId: 'run_root',
    profile: 'default',
    resultJson: null,
    rootRunId: 'run_root',
    sessionId: 'ses_test',
    sourceCallId: 'call_delegate_1',
    startedAt: null,
    status: 'pending',
    task: 'Child task',
    tenantId: 'ten_test',
    threadId: null,
    turnCount: 0,
    updatedAt: '2026-03-29T00:00:00.000Z',
    version: 1,
    workspaceRef: null,
  })

  const inserted = runtime.db.select().from(runs).where(eq(runs.id, 'run_child_private')).get()

  assert.equal(inserted?.threadId ?? null, null)
  assert.equal(inserted?.parentRunId, 'run_root')
})

test('agent_revisions rejects tenant mismatches with the parent agent', () => {
  const { runtime } = createTestHarness()

  runtime.db
    .insert(tenants)
    .values([
      {
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_test',
        name: 'Tenant',
        slug: 'tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
      {
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_other',
        name: 'Other Tenant',
        slug: 'other-tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: null,
      archivedAt: null,
      baseAgentId: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'agt_test',
      kind: 'primary',
      name: 'Default Agent',
      ownerAccountId: null,
      slug: 'default',
      status: 'active',
      tenantId: 'ten_test',
      updatedAt: '2026-03-29T00:00:00.000Z',
      visibility: 'system',
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(agentRevisions)
      .values({
        agentId: 'agt_test',
        checksumSha256: 'sha256-test',
        createdAt: '2026-03-29T00:00:00.000Z',
        createdByAccountId: null,
        frontmatterJson: {},
        gardenFocusJson: {},
        id: 'agr_invalid_tenant',
        instructionsMd: 'Do the work.',
        kernelPolicyJson: {},
        memoryPolicyJson: {},
        modelConfigJson: {},
        resolvedConfigJson: {},
        sourceMarkdown: '---\nname: Default Agent\n---\nDo the work.',
        tenantId: 'ten_other',
        toolPolicyJson: {},
        version: 1,
        sandboxPolicyJson: {},
        workspacePolicyJson: {},
      })
      .run()
  }, /FOREIGN KEY constraint failed/)
})

test('runs rejects partial agent bindings', () => {
  const { runtime } = createTestHarness()

  seedSessionGraph(runtime)

  expectSqliteError(() => {
    insertRun(runtime, {
      agentId: 'agt_partial',
      agentRevisionId: null,
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:00:00.000Z',
      errorJson: null,
      id: 'run_partial_agent',
      lastProgressAt: null,
      parentRunId: null,
      profile: 'default',
      resultJson: null,
      rootRunId: 'run_partial_agent',
      sessionId: 'ses_test',
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: 'Task',
      tenantId: 'ten_test',
      threadId: 'thr_test',
      turnCount: 0,
      updatedAt: '2026-03-29T00:00:00.000Z',
      version: 1,
      workspaceId: null,
      workspaceRef: null,
    })
  }, /runs\.agent_id and runs\.agent_revision_id must be assigned together/)
})

test('runs rejects agent revisions from another tenant', () => {
  const { runtime } = createTestHarness()

  runtime.db
    .insert(tenants)
    .values([
      {
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_test',
        name: 'Tenant',
        slug: 'tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
      {
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_other',
        name: 'Other Tenant',
        slug: 'other-tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      deletedAt: null,
      id: 'ses_test',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Session',
      updatedAt: '2026-03-29T00:00:00.000Z',
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'thr_test',
      parentThreadId: null,
      sessionId: 'ses_test',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Thread',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: null,
      archivedAt: null,
      baseAgentId: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      id: 'agt_other',
      kind: 'primary',
      name: 'Other Agent',
      ownerAccountId: null,
      slug: 'other',
      status: 'active',
      tenantId: 'ten_other',
      updatedAt: '2026-03-29T00:00:00.000Z',
      visibility: 'system',
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId: 'agt_other',
      checksumSha256: 'sha256-other',
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: null,
      frontmatterJson: {},
      gardenFocusJson: {},
      id: 'agr_other',
      instructionsMd: 'Do the work.',
      kernelPolicyJson: {},
      memoryPolicyJson: {},
      modelConfigJson: {},
      resolvedConfigJson: {},
      sourceMarkdown: '---\nname: Other Agent\n---\nDo the work.',
      tenantId: 'ten_other',
      toolPolicyJson: {},
      version: 1,
      sandboxPolicyJson: {},
      workspacePolicyJson: {},
    })
    .run()

  expectSqliteError(() => {
    insertRun(runtime, {
      agentId: 'agt_other',
      agentRevisionId: 'agr_other',
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:00:00.000Z',
      errorJson: null,
      id: 'run_invalid_agent_revision',
      lastProgressAt: null,
      parentRunId: null,
      profile: 'default',
      resultJson: null,
      rootRunId: 'run_invalid_agent_revision',
      sessionId: 'ses_test',
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: 'Task',
      tenantId: 'ten_test',
      threadId: 'thr_test',
      turnCount: 0,
      updatedAt: '2026-03-29T00:00:00.000Z',
      version: 1,
      workspaceId: null,
      workspaceRef: null,
    })
  }, /runs\.agent_revision_id must reference an agent revision in the same tenant/)
})

test('work_sessions rejects workspace bindings from another tenant', () => {
  const { runtime } = createTestHarness()

  seedAccount(runtime)

  runtime.db
    .insert(tenants)
    .values([
      {
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_test',
        name: 'Tenant',
        slug: 'tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
      {
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_other',
        name: 'Other Tenant',
        slug: 'other-tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(workspaces)
    .values({
      accountId: 'acc_test',
      createdAt: '2026-03-29T00:00:00.000Z',
      id: 'wsp_other',
      kind: 'account_root',
      label: 'Other workspace',
      rootRef: 'var/workspaces/ten_other/acc_test',
      status: 'active',
      tenantId: 'ten_other',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(workSessions)
      .values({
        archivedAt: null,
        createdAt: '2026-03-29T00:00:00.000Z',
        createdByAccountId: null,
        deletedAt: null,
        id: 'ses_invalid_workspace',
        metadata: null,
        rootRunId: null,
        status: 'active',
        tenantId: 'ten_test',
        title: 'Session',
        updatedAt: '2026-03-29T00:00:00.000Z',
        workspaceId: 'wsp_other',
        workspaceRef: null,
      })
      .run()
  }, /work_sessions\.workspace_id must reference a workspace in the same tenant/)
})

test('event_outbox rejects tenant mismatches with the referenced domain event', () => {
  const { runtime } = createTestHarness()

  runtime.db
    .insert(tenants)
    .values([
      {
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_test',
        name: 'Tenant',
        slug: 'tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
      {
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_other',
        name: 'Other Tenant',
        slug: 'other-tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(domainEvents)
    .values({
      actorAccountId: null,
      aggregateId: 'ses_test',
      aggregateType: 'work_session',
      category: 'domain',
      causationId: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      eventNo: 1,
      id: 'evt_test',
      payload: { sessionId: 'ses_test' },
      tenantId: 'ten_test',
      traceId: null,
      type: 'session.created',
    })
    .run()

  expectSqliteError(() => {
    runtime.db
      .insert(eventOutbox)
      .values({
        attempts: 0,
        availableAt: '2026-03-29T00:00:00.000Z',
        createdAt: '2026-03-29T00:00:00.000Z',
        eventId: 'evt_test',
        id: 'obx_invalid_tenant',
        lastError: null,
        processedAt: null,
        status: 'pending',
        tenantId: 'ten_other',
        topic: 'projection',
      })
      .run()
  }, /FOREIGN KEY constraint failed/)
})
