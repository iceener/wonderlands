import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

import { loadConfig } from '../src/app/config'
import { createDatabaseClient } from '../src/db/client'
import { openSqliteDatabase } from '../src/db/sqlite-adapter'

const createTestDatabasePath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), '05_04_api-migrations-'))

  return join(dir, 'test.sqlite')
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
