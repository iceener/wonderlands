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

