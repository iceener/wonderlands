import assert from 'node:assert/strict'
import { BACKEND_EVENT_TYPES } from '@wonderlands/contracts/chat'

import { eq } from 'drizzle-orm'
import { test } from 'vitest'
import { createDomainEventRepository } from '../src/adapters/persistence/sqlite/events/domain-event-repository'
import { createEventOutboxRepository } from '../src/adapters/persistence/sqlite/events/event-outbox-repository'
import { createEventStore } from '../src/application/commands/event-store'
import { domainEvents, eventOutbox, eventPayloadSidecars } from '../src/db/schema'
import {
  DOMAIN_EVENT_TYPES,
  TELEMETRY_EVENT_TYPES,
} from '../src/domain/events/committed-event-contract'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

test('shared BackendEvent contract covers every canonical committed event type', () => {
  const canonicalEventTypes = [...DOMAIN_EVENT_TYPES, ...TELEMETRY_EVENT_TYPES].sort()
  const sharedEventTypes = [...BACKEND_EVENT_TYPES].sort()

  assert.deepEqual(sharedEventTypes, canonicalEventTypes)
})

type EventRoutingContract = { name: string; run: () => void }
const eventRoutingContracts: EventRoutingContract[] = []
const eventRoutingContract = (name: string, run: () => void) =>
  eventRoutingContracts.push({ name, run })

eventRoutingContract(
  'event store defaults domain events to replayable category with projection and realtime delivery',
  () => {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, tenantId } = seedApiKeyAuth(runtime)

    const appended = createEventStore(runtime.db).append({
      actorAccountId: accountId,
      aggregateId: 'ses_contract_domain',
      aggregateType: 'work_session',
      payload: {
        sessionId: 'ses_contract_domain',
      },
      tenantId,
      type: 'session.created',
    })

    assert.equal(appended.ok, true)

    if (!appended.ok) {
      throw new Error(appended.error.message)
    }

    const eventRow = runtime.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, appended.value.id))
      .get()
    const outboxRows = runtime.db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, appended.value.id))
      .orderBy(eventOutbox.topic)
      .all()

    assert.equal(eventRow?.category, 'domain')
    assert.deepEqual(
      outboxRows.map((row) => row.topic),
      ['projection', 'realtime'],
    )
  },
)

eventRoutingContract('event store routes progress telemetry to realtime delivery only', () => {
  const { runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  const appended = createEventStore(runtime.db).append({
    actorAccountId: accountId,
    aggregateId: 'run_contract_telemetry',
    aggregateType: 'run',
    payload: {
      runId: 'run_contract_telemetry',
      sessionId: 'ses_contract_telemetry',
      stage: 'planning',
      status: 'running',
      threadId: 'thr_contract_telemetry',
      turn: 1,
    },
    tenantId,
    type: 'progress.reported',
  })

  assert.equal(appended.ok, true)

  if (!appended.ok) {
    throw new Error(appended.error.message)
  }

  const eventRow = runtime.db
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.id, appended.value.id))
    .get()
  const outboxRows = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, appended.value.id))
    .all()

  assert.equal(eventRow?.category, 'telemetry')
  assert.deepEqual(outboxRows.map((row) => row.topic).sort(), ['realtime'])
})

eventRoutingContract(
  'event store offloads bulky telemetry payload fragments while repositories hydrate them transparently',
  () => {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, tenantId } = seedApiKeyAuth(runtime)

    const appended = createEventStore(runtime.db).append({
      actorAccountId: accountId,
      aggregateId: 'run_contract_generation_started',
      aggregateType: 'run',
      payload: {
        inputMessages: [
          {
            content: [
              {
                text: 'x'.repeat(1600),
                type: 'text',
              },
            ],
            role: 'user',
          },
        ],
        modelParameters: {
          maxOutputTokens: 800,
        },
        provider: 'openai',
        requestedModel: 'gpt-5.4',
        runId: 'run_contract_generation_started',
        sessionId: 'ses_contract_generation_started',
        status: 'running',
        threadId: 'thr_contract_generation_started',
        tools: [
          {
            description: 'Inspect a large telemetry payload.',
            kind: 'function',
            name: 'inspect_payload',
            parameters: {
              additionalProperties: false,
              properties: {
                text: {
                  type: 'string',
                },
              },
              required: ['text'],
              type: 'object',
            },
            type: 'function',
          },
        ],
        turn: 1,
      },
      tenantId,
      type: 'generation.started',
    })

    assert.equal(appended.ok, true)

    if (!appended.ok) {
      throw new Error(appended.error.message)
    }

    const eventRow = runtime.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, appended.value.id))
      .get()
    const payloadSidecarRow = runtime.db
      .select()
      .from(eventPayloadSidecars)
      .where(eq(eventPayloadSidecars.eventId, appended.value.id))
      .get()

    assert.ok(eventRow)
    assert.ok(payloadSidecarRow)
    assert.equal(
      Object.hasOwn((eventRow?.payload as Record<string, unknown>) ?? {}, 'inputMessages'),
      false,
    )
    assert.equal(
      Object.hasOwn((eventRow?.payload as Record<string, unknown>) ?? {}, 'tools'),
      false,
    )

    const hydratedEvents = createDomainEventRepository(runtime.db).listAfterCursor(
      { accountId, tenantId },
      {
        category: 'telemetry',
        runId: 'run_contract_generation_started',
      },
    )

    assert.equal(hydratedEvents.ok, true)

    if (!hydratedEvents.ok) {
      throw new Error(hydratedEvents.error.message)
    }

    const hydratedStartedEvent = hydratedEvents.value.find(
      (event) => event.type === 'generation.started',
    )
    const claimed = createEventOutboxRepository(runtime.db).claimNext('9999-01-01T00:00:00.000Z', {
      includeTopics: ['realtime'],
    })

    assert.equal(claimed.ok, true)

    if (!claimed.ok) {
      throw new Error(claimed.error.message)
    }

    assert.equal(
      Array.isArray(
        (hydratedStartedEvent?.payload as { inputMessages?: unknown[] } | undefined)?.inputMessages,
      ),
      true,
    )
    assert.equal(
      Array.isArray((hydratedStartedEvent?.payload as { tools?: unknown[] } | undefined)?.tools),
      true,
    )
    assert.equal(
      Array.isArray(
        (claimed.value?.event.payload as { inputMessages?: unknown[] } | undefined)?.inputMessages,
      ),
      true,
    )
  },
)

eventRoutingContract('event store routes run.created to projection and realtime delivery', () => {
  const { runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  const appended = createEventStore(runtime.db).append({
    actorAccountId: accountId,
    aggregateId: 'run_contract_created',
    aggregateType: 'run',
    payload: {
      rootRunId: 'run_contract_created',
      runId: 'run_contract_created',
      sessionId: 'ses_contract_created',
      threadId: 'thr_contract_created',
    },
    tenantId,
    type: 'run.created',
  })

  assert.equal(appended.ok, true)

  if (!appended.ok) {
    throw new Error(appended.error.message)
  }

  const outboxRows = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, appended.value.id))
    .orderBy(eventOutbox.topic)
    .all()

  assert.deepEqual(
    outboxRows.map((row) => row.topic),
    ['projection', 'realtime'],
  )
})

eventRoutingContract(
  'event store defaults thread.naming.requested to background and realtime delivery',
  () => {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, tenantId } = seedApiKeyAuth(runtime)

    const appended = createEventStore(runtime.db).append({
      actorAccountId: accountId,
      aggregateId: 'thr_contract_naming',
      aggregateType: 'session_thread',
      payload: {
        requestId: 'tnr_contract_naming',
        requestedAt: '2026-03-31T12:00:00.000Z',
        sessionId: 'ses_contract_naming',
        sourceRunId: 'run_contract_naming',
        threadId: 'thr_contract_naming',
        trigger: 'auto_first_message',
      },
      tenantId,
      type: 'thread.naming.requested',
    })

    assert.equal(appended.ok, true)

    if (!appended.ok) {
      throw new Error(appended.error.message)
    }

    const outboxRows = runtime.db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, appended.value.id))
      .orderBy(eventOutbox.topic)
      .all()

    assert.deepEqual(
      outboxRows.map((row) => row.topic),
      ['background', 'realtime'],
    )
  },
)

eventRoutingContract('event store accepts tool.waiting as a canonical domain event', () => {
  const { runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  const appended = createEventStore(runtime.db).append({
    actorAccountId: accountId,
    aggregateId: 'call_contract_waiting',
    aggregateType: 'tool_execution',
    payload: {
      callId: 'call_contract_waiting',
      runId: 'run_contract_waiting',
      sessionId: 'ses_contract_waiting',
      threadId: 'thr_contract_waiting',
      tool: 'fetch_report',
      waitId: 'wte_contract_waiting',
      waitTargetKind: 'external',
      waitTargetRef: 'job_123',
      waitType: 'tool',
    },
    tenantId,
    type: 'tool.waiting',
  })

  assert.equal(appended.ok, true)

  if (!appended.ok) {
    throw new Error(appended.error.message)
  }

  const eventRow = runtime.db
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.id, appended.value.id))
    .get()
  const outboxRows = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, appended.value.id))
    .orderBy(eventOutbox.topic)
    .all()

  assert.equal(eventRow?.category, 'domain')
  assert.deepEqual(
    outboxRows.map((row) => row.topic),
    ['projection', 'realtime'],
  )
})

eventRoutingContract(
  'event store routes root run.completed to projection, realtime, and observability delivery',
  () => {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, tenantId } = seedApiKeyAuth(runtime)

    const appended = createEventStore(runtime.db).append({
      actorAccountId: accountId,
      aggregateId: 'run_contract_completed_root',
      aggregateType: 'run',
      payload: {
        rootRunId: 'run_contract_completed_root',
        runId: 'run_contract_completed_root',
        sessionId: 'ses_contract_completed_root',
        status: 'completed',
        threadId: 'thr_contract_completed_root',
      },
      tenantId,
      type: 'run.completed',
    })

    assert.equal(appended.ok, true)

    if (!appended.ok) {
      throw new Error(appended.error.message)
    }

    const outboxRows = runtime.db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, appended.value.id))
      .orderBy(eventOutbox.topic)
      .all()

    assert.deepEqual(
      outboxRows.map((row) => row.topic),
      ['observability', 'projection', 'realtime'],
    )
  },
)

eventRoutingContract(
  'event store routes child run.completed to projection and realtime delivery only',
  () => {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, tenantId } = seedApiKeyAuth(runtime)

    const appended = createEventStore(runtime.db).append({
      actorAccountId: accountId,
      aggregateId: 'run_contract_completed_child',
      aggregateType: 'run',
      payload: {
        rootRunId: 'run_contract_completed_root',
        runId: 'run_contract_completed_child',
        sessionId: 'ses_contract_completed_root',
        status: 'completed',
        threadId: 'thr_contract_completed_root',
      },
      tenantId,
      type: 'run.completed',
    })

    assert.equal(appended.ok, true)

    if (!appended.ok) {
      throw new Error(appended.error.message)
    }

    const outboxRows = runtime.db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, appended.value.id))
      .orderBy(eventOutbox.topic)
      .all()

    assert.deepEqual(
      outboxRows.map((row) => row.topic),
      ['projection', 'realtime'],
    )
  },
)

eventRoutingContract('event store accepts job.requeued as a canonical domain event', () => {
  const { runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)

  const appended = createEventStore(runtime.db).append({
    actorAccountId: accountId,
    aggregateId: 'job_contract_reopened',
    aggregateType: 'job',
    payload: {
      currentRunId: 'run_contract_reopened',
      kind: 'objective',
      parentJobId: null,
      reason: 'dependencies_satisfied',
      rootJobId: 'job_contract_reopened',
      runId: 'run_contract_reopened',
      sessionId: 'ses_contract_reopened',
      status: 'queued',
      threadId: 'thr_contract_reopened',
      updatedAt: '2026-03-30T00:00:00.000Z',
      jobId: 'job_contract_reopened',
    },
    tenantId,
    type: 'job.requeued',
  })

  assert.equal(appended.ok, true)

  if (!appended.ok) {
    throw new Error(appended.error.message)
  }

  const eventRow = runtime.db
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.id, appended.value.id))
    .get()
  const outboxRows = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, appended.value.id))
    .orderBy(eventOutbox.topic)
    .all()

  assert.equal(eventRow?.category, 'domain')
  assert.deepEqual(
    outboxRows.map((row) => row.topic),
    ['projection', 'realtime'],
  )
})

eventRoutingContract(
  'event store rejects category mismatches for canonical committed event types',
  () => {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, tenantId } = seedApiKeyAuth(runtime)

    const appended = createEventStore(runtime.db).append({
      actorAccountId: accountId,
      aggregateId: 'run_contract_mismatch',
      aggregateType: 'run',
      category: 'domain',
      payload: {
        runId: 'run_contract_mismatch',
        sessionId: 'ses_contract_mismatch',
        stage: 'planning',
        status: 'running',
        threadId: 'thr_contract_mismatch',
        turn: 1,
      },
      tenantId,
      type: 'progress.reported',
    })

    assert.equal(appended.ok, false)

    if (appended.ok) {
      throw new Error('expected event append to fail')
    }

    assert.match(appended.error.message, /must use category "telemetry"/)
  },
)

eventRoutingContract(
  'event store rejects outbox topics outside the canonical delivery contract',
  () => {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, tenantId } = seedApiKeyAuth(runtime)

    const appended = createEventStore(runtime.db).append({
      actorAccountId: accountId,
      aggregateId: 'run_contract_bad_topic',
      aggregateType: 'run',
      outboxTopics: ['projection'],
      payload: {
        runId: 'run_contract_bad_topic',
        sessionId: 'ses_contract_bad_topic',
        stage: 'planning',
        status: 'running',
        threadId: 'thr_contract_bad_topic',
        turn: 1,
      },
      tenantId,
      type: 'progress.reported',
    })

    assert.equal(appended.ok, false)

    if (appended.ok) {
      throw new Error('expected event append to fail')
    }

    assert.match(appended.error.message, /does not support the requested outbox topics/)
  },
)

test('event persistence and routing contract matrix', () => {
  for (const contract of eventRoutingContracts) {
    assert.doesNotThrow(contract.run, contract.name)
  }
})
