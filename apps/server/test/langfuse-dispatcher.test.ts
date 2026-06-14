import assert from 'node:assert/strict'
import { test } from 'vitest'

import type { LangfuseExporter } from '../src/adapters/observability/langfuse/exporter'
import { dispatchLangfuseEvent } from '../src/application/events/langfuse-dispatcher'
import type { EventOutboxRecord } from '../src/domain/events/event-outbox-repository'
import { asAccountId, asEventId, asTenantId } from '../src/shared/ids'
import { ok } from '../src/shared/result'

const NOW = '2026-04-02T02:30:37.952Z'

const createEntry = (type: string): EventOutboxRecord => ({
  attempts: 0,
  availableAt: NOW,
  createdAt: NOW,
  event: {
    actorAccountId: asAccountId('acc_test'),
    aggregateId: 'run_root',
    aggregateType: 'run',
    category: 'domain',
    createdAt: NOW,
    eventNo: 1,
    id: asEventId('evt_test'),
    payload: {
      rootRunId: 'run_root',
      runId: 'run_root',
      sessionId: 'ses_test',
    },
    tenantId: asTenantId('ten_test'),
    type,
  },
  eventId: asEventId('evt_test'),
  id: 'obx_evt_test',
  lastError: null,
  processedAt: null,
  status: 'pending',
  tenantId: asTenantId('ten_test'),
  topic: 'observability',
})

test('dispatcher delegates observability entries to the Langfuse exporter', async () => {
  const calls: EventOutboxRecord[] = []
  const exporter: LangfuseExporter = {
    enabled: true,
    environment: 'test',
    exportOutboxEntry: async (entry) => {
      calls.push(entry)
      return ok(null)
    },
    shutdown: async () => {},
  }

  const entry = createEntry('run.completed')
  const result = await dispatchLangfuseEvent(exporter, entry)

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [entry])
})
