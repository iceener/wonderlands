import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'vitest'

import { loadConfig } from '../src/app/config'
import { createDatabaseClient } from '../src/db/client'
import { openSqliteDatabase, type SqliteDatabaseHandle } from '../src/db/sqlite-adapter'

const createTestDatabasePath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), '05_04_api-migrations-'))

  return join(dir, 'test.sqlite')
}

const readExpectedMigrationTimestamps = (): number[] => {
  const journalPath = resolve(process.cwd(), 'drizzle/meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ when: number }>
  }

  return journal.entries.map((entry) => entry.when)
}

const readMigrationJournal = (): Array<{ tag: string; when: number }> => {
  const journalPath = resolve(process.cwd(), 'drizzle/meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>
  }

  return journal.entries
}

const readMigrationHash = (tag: string): string =>
  createHash('sha256')
    .update(readFileSync(resolve(process.cwd(), `drizzle/${tag}.sql`)))
    .digest('hex')

const executeMigrationFile = (sqlite: SqliteDatabaseHandle, relativePath: string): void => {
  const sql = readFileSync(resolve(process.cwd(), relativePath), 'utf8')

  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()

    if (trimmed.length > 0) {
      sqlite.exec(trimmed)
    }
  }
}

test('createDatabaseClient baselines legacy managed SQLite files before applying migrations', () => {
  const databasePath = createTestDatabasePath()
  const sqlite = openSqliteDatabase(databasePath)

  executeMigrationFile(sqlite, 'drizzle/0000_overjoyed_jack_murdock.sql')
  executeMigrationFile(sqlite, 'drizzle/0001_oval_toxin.sql')
  sqlite.close()

  const config = loadConfig({
    DATABASE_PATH: databasePath,
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
  })
  const db = createDatabaseClient(config)
  const migrationRows = db.sqlite
    .prepare('SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at')
    .all() as Array<{ created_at: number; hash: string }>
  const expectedCreatedAt = readExpectedMigrationTimestamps()

  assert.equal(migrationRows.length, expectedCreatedAt.length)
  assert.deepEqual(
    migrationRows.map((row) => row.created_at),
    expectedCreatedAt,
  )

  db.close()
})

test('createDatabaseClient refuses to baseline unknown SQLite schemas without a migration journal', () => {
  const databasePath = createTestDatabasePath()
  const sqlite = openSqliteDatabase(databasePath)

  sqlite.exec(`
    CREATE TABLE tenants (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL
    )
  `)
  sqlite.close()

  const config = loadConfig({
    DATABASE_PATH: databasePath,
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
  })

  assert.throws(() => {
    createDatabaseClient(config)
  }, /supported legacy managed schema/i)
})

test('createDatabaseClient upgrades a populated pre-0009 runtime database without dropping run references', () => {
  const databasePath = createTestDatabasePath()
  const sqlite = openSqliteDatabase(databasePath)
  const journal = readMigrationJournal()
  const pre0009Journal = journal.slice(
    0,
    journal.findIndex((entry) => entry.tag === '0009_great_dark_phoenix'),
  )

  for (const entry of pre0009Journal) {
    executeMigrationFile(sqlite, `drizzle/${entry.tag}.sql`)
  }

  sqlite.exec(`
    CREATE TABLE "__drizzle_migrations" (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      hash text NOT NULL,
      created_at numeric
    );
  `)

  const migrationInsert = sqlite.prepare(
    'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
  )

  for (const entry of pre0009Journal) {
    migrationInsert.run(readMigrationHash(entry.tag), entry.when)
  }

  sqlite.exec(`
    INSERT INTO accounts (id, name, email, preferences, created_at, updated_at)
    VALUES ('acc_test', 'Account', 'acc@example.com', NULL, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');

    INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
    VALUES ('ten_test', 'Tenant', 'tenant', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');

    INSERT INTO work_sessions (id, tenant_id, created_by_account_id, title, status, root_run_id, workspace_ref, metadata, created_at, updated_at, archived_at, deleted_at)
    VALUES ('ses_test', 'ten_test', 'acc_test', 'Session', 'active', NULL, NULL, NULL, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', NULL, NULL);

    INSERT INTO session_threads (id, session_id, parent_thread_id, created_by_account_id, title, status, tenant_id, created_at, updated_at)
    VALUES ('thr_test', 'ses_test', NULL, 'acc_test', 'Thread', 'active', 'ten_test', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');

    INSERT INTO runs (id, tenant_id, session_id, thread_id, parent_run_id, root_run_id, source_call_id, profile, task, status, result_json, error_json, config_snapshot, workspace_ref, turn_count, version, created_at, started_at, completed_at, last_progress_at, updated_at)
    VALUES ('run_root', 'ten_test', 'ses_test', 'thr_test', NULL, 'run_root', NULL, 'default', 'Task', 'completed', '{"ok":true}', NULL, '{}', NULL, 1, 2, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', '2026-03-29T00:01:00.000Z', '2026-03-29T00:01:00.000Z', '2026-03-29T00:01:00.000Z');

    UPDATE work_sessions
    SET root_run_id = 'run_root'
    WHERE id = 'ses_test';

    INSERT INTO session_messages (id, tenant_id, session_id, thread_id, author_kind, author_account_id, run_id, sequence, content, metadata, created_at)
    VALUES ('msg_test', 'ten_test', 'ses_test', 'thr_test', 'user', 'acc_test', 'run_root', 1, '[{"type":"text","text":"Hello"}]', NULL, '2026-03-29T00:00:00.000Z');

    INSERT INTO items (id, tenant_id, run_id, sequence, type, role, content, call_id, name, arguments, output, summary, provider_payload, created_at)
    VALUES ('itm_test', 'ten_test', 'run_root', 1, 'message', 'user', '[{"type":"text","text":"Hello"}]', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-29T00:00:00.000Z');
  `)

  sqlite.close()

  const config = loadConfig({
    DATABASE_PATH: databasePath,
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
  })
  const db = createDatabaseClient(config)
  const runRow = db.sqlite
    .prepare('SELECT agent_id, agent_revision_id, workspace_id FROM runs WHERE id = ?')
    .get('run_root') as {
    agent_id: string | null
    agent_revision_id: string | null
    workspace_id: string | null
  }
  const sessionRow = db.sqlite
    .prepare('SELECT workspace_id FROM work_sessions WHERE id = ?')
    .get('ses_test') as { workspace_id: string | null }
  const searchRows = db.sqlite
    .prepare(
      `
        SELECT thread_id, source_type, source_id
        FROM conversation_search
        WHERE conversation_search MATCH ?
        ORDER BY source_type, source_id
      `,
    )
    .all('hello*') as Array<{
    source_id: string
    source_type: 'message' | 'thread'
    thread_id: string
  }>

  assert.deepEqual(runRow, {
    agent_id: null,
    agent_revision_id: null,
    workspace_id: null,
  })
  assert.deepEqual(sessionRow, {
    workspace_id: null,
  })
  assert.deepEqual(searchRows, [
    {
      source_id: 'msg_test',
      source_type: 'message',
      thread_id: 'thr_test',
    },
  ])

  db.close()
})
