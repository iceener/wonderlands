import { afterEach, describe, expect, test } from 'vitest'

import { createContextManifestRepository } from '../../src/adapters/persistence/sqlite/context/context-manifest-repository'
import { createDrizzleSqliteDatabase, openSqliteDatabase } from '../../src/db/sqlite-adapter'
import type {
  CreateContextManifestInput,
  RedactedContextManifest,
} from '../../src/domain/context/context-manifest-repository'
import { asAccountId, asRunId, asSessionThreadId, asTenantId } from '../../src/shared/ids'
import type { TenantScope } from '../../src/shared/scope'

const createTestDatabase = () => {
  const sqlite = openSqliteDatabase(':memory:')
  sqlite.exec(`
    CREATE TABLE context_manifests (
      assembler_version text NOT NULL,
      created_at text NOT NULL,
      generated_at text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      manifest_json text NOT NULL CHECK (json_valid(manifest_json)),
      mode text NOT NULL,
      model text NOT NULL,
      provider text NOT NULL,
      replay_hash text NOT NULL,
      run_id text NOT NULL,
      tenant_id text NOT NULL,
      thread_id text,
      turn integer NOT NULL,
      UNIQUE (tenant_id, run_id, turn, mode, assembler_version)
    );
  `)

  const db = createDrizzleSqliteDatabase(sqlite, { schema: {} }) as Parameters<
    typeof createContextManifestRepository
  >[0]

  return { close: () => sqlite.close(), db }
}

const scope: TenantScope = {
  accountId: asAccountId('acc_manifestowner'),
  role: 'owner',
  tenantId: asTenantId('ten_manifesttenant'),
}

const otherScope: TenantScope = {
  accountId: asAccountId('acc_otherowner'),
  role: 'owner',
  tenantId: asTenantId('ten_othertenant'),
}

const runId = asRunId('run_manifest')
const threadId = asSessionThreadId('thr_manifest')

const buildManifest = (
  turn: number,
  replayHash = `ctxm_replay_${turn}`,
): RedactedContextManifest => ({
  assemblerVersion: 'context-assembly/v2-shadow-1',
  budget: {
    availableInputTokens: 1_000,
    consideredArtifactTokens: 10,
    droppedArtifactTokens: 0,
    inputTokenLimit: 2_000,
    reservedOutputTokens: 1_000,
    selectedArtifactTokens: 10,
  },
  conflicts: [],
  coordinates: { runId, threadId, turn },
  dropped: [],
  generatedAt: `2026-06-0${turn}T12:00:00.000Z`,
  model: 'test-model',
  persistenceId: null,
  provider: 'test-provider',
  rejected: [],
  replayHash,
  selected: [
    {
      artifactId: `artifact-${turn}`,
      authority: 'current_user',
      estimatedTokens: 10,
      freshness: { capturedAt: '2026-06-01T12:00:00.000Z', expiresAt: null },
      layer: 'run_transcript',
      metadataStatus: 'declared',
      payloadKind: 'messages',
      sensitivity: 'restricted',
      source: { ids: [`itm_${turn}`], type: 'user_message' },
      transformation: { kind: 'none' },
    },
  ],
  transformed: [],
  version: 'context/v2',
})

const buildInput = (turn: number, id = `ctxm_${turn}`): CreateContextManifestInput => {
  const manifest = buildManifest(turn)
  return {
    assemblerVersion: manifest.assemblerVersion,
    createdAt: `2026-06-0${turn}T12:00:01.000Z`,
    generatedAt: manifest.generatedAt,
    id,
    manifest,
    mode: 'shadow',
    model: manifest.model,
    provider: manifest.provider,
    replayHash: manifest.replayHash,
    runId,
    threadId,
    turn,
  }
}

describe('context manifest repository', () => {
  const handles: Array<{ close: () => void }> = []

  afterEach(() => {
    while (handles.length > 0) {
      handles.pop()?.close()
    }
  })

  test('creates idempotently and rejects a changed replay for the same attempted turn', () => {
    const handle = createTestDatabase()
    handles.push(handle)
    const repository = createContextManifestRepository(handle.db)

    const first = repository.create(scope, buildInput(1))
    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error(first.error.message)
    }

    const retry = repository.create(scope, buildInput(1, 'ctxm_retry'))
    expect(retry.ok).toBe(true)
    if (!retry.ok) {
      throw new Error(retry.error.message)
    }
    expect(retry.value.id).toBe(first.value.id)

    const changedManifest = buildManifest(1, 'ctxm_changed_replay')
    const changed = repository.create(scope, {
      ...buildInput(1, 'ctxm_changed'),
      manifest: changedManifest,
      replayHash: changedManifest.replayHash,
    })
    expect(changed).toMatchObject({ ok: false, error: { type: 'conflict' } })
  })

  test('scopes reads to the tenant and provides bounded cursor pagination', () => {
    const handle = createTestDatabase()
    handles.push(handle)
    const repository = createContextManifestRepository(handle.db)

    for (const turn of [1, 2, 3]) {
      const created = repository.create(scope, buildInput(turn))
      expect(created.ok).toBe(true)
    }

    const firstPage = repository.list(scope, { limit: 2, runId })
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      throw new Error(firstPage.error.message)
    }
    expect(firstPage.value.map((record) => record.turn)).toEqual([3, 2])

    const last = firstPage.value[1]!
    const secondPage = repository.list(scope, {
      before: { createdAt: last.createdAt, id: last.id },
      limit: 2,
      runId,
    })
    expect(secondPage.ok).toBe(true)
    if (!secondPage.ok) {
      throw new Error(secondPage.error.message)
    }
    expect(secondPage.value.map((record) => record.turn)).toEqual([1])

    expect(repository.getById(otherScope, 'ctxm_1')).toEqual({ ok: true, value: null })
    expect(repository.list(otherScope)).toEqual({ ok: true, value: [] })
    expect(repository.list(scope, { limit: 101 })).toMatchObject({
      error: { type: 'validation' },
      ok: false,
    })
  })

  test('rejects unsafe manifest JSON before persistence', () => {
    const unsafeEntries = [
      { payload: { role: 'user' } },
      { messages: ['raw message'] },
      { apiKey: 'credential-value' },
      { fields: ['data:image/png;base64,AAAA'] },
    ]

    for (const [index, unsafeEntry] of unsafeEntries.entries()) {
      const handle = createTestDatabase()
      handles.push(handle)
      const repository = createContextManifestRepository(handle.db)
      const input = buildInput(index + 1)
      const unsafeManifest = {
        ...input.manifest,
        selected: [unsafeEntry],
      } as unknown as RedactedContextManifest

      const result = repository.create(scope, { ...input, manifest: unsafeManifest })

      expect(result).toMatchObject({ error: { type: 'validation' }, ok: false })
      expect(repository.list(scope)).toEqual({ ok: true, value: [] })
    }
  })
})
