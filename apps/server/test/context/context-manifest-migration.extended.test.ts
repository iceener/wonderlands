import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { loadConfig } from '../../src/app/config'
import { type AppDatabase, createDatabaseClient } from '../../src/db/client'

const createMigratedDatabase = (): AppDatabase => {
  const directory = mkdtempSync(join(tmpdir(), 'wonderlands-context-manifests-'))
  return createDatabaseClient(
    loadConfig({
      DATABASE_PATH: join(directory, 'test.sqlite'),
      LOG_LEVEL: 'error',
      NODE_ENV: 'test',
    }),
  )
}

describe('context manifest migration', () => {
  const databases: AppDatabase[] = []

  afterEach(() => {
    while (databases.length > 0) {
      databases.pop()?.close()
    }
  })

  test('creates the tenant-scoped idempotency and retention schema', () => {
    const db = createMigratedDatabase()
    databases.push(db)

    const table = db.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'context_manifests'")
      .get() as { sql: string } | undefined
    const indexes = db.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'context_manifests' ORDER BY name",
      )
      .all() as Array<{ name: string }>
    const foreignKeys = db.sqlite
      .prepare('PRAGMA foreign_key_list(context_manifests)')
      .all() as Array<{
      from: string
      table: string
      to: string
    }>

    expect(table?.sql).toContain('context_manifests_turn_nonnegative')
    expect(table?.sql).toContain('context_manifests_mode_valid')
    expect(table?.sql).toContain('json_valid(`manifest_json`)')
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'context_manifests_attempt_unique',
        'context_manifests_created_at_idx',
        'context_manifests_tenant_created_at_idx',
        'context_manifests_tenant_run_idx',
        'context_manifests_tenant_thread_idx',
      ]),
    )
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'run_id', table: 'runs', to: 'id' }),
        expect.objectContaining({ from: 'tenant_id', table: 'runs', to: 'tenant_id' }),
        expect.objectContaining({ from: 'thread_id', table: 'session_threads', to: 'id' }),
        expect.objectContaining({ from: 'tenant_id', table: 'session_threads', to: 'tenant_id' }),
      ]),
    )
  })
})
