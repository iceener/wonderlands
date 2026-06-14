import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type { AppConfig } from '../app/config'
import { ensureMigrationJournal } from './ensure-migration-journal'
import * as schema from './schema'
import {
  createDrizzleSqliteDatabase,
  migrateSqliteDatabase,
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from './sqlite-adapter'

export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  close: () => void
  sqlite: SqliteDatabaseHandle
}

const applyPragmas = (sqlite: SqliteDatabaseHandle): void => {
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `)
}

export const createDatabaseClient = (config: AppConfig): AppDatabase => {
  mkdirSync(dirname(config.database.path), { recursive: true })

  const sqlite = openSqliteDatabase(config.database.path)
  const migrationsFolder = resolve(process.cwd(), 'drizzle')

  applyPragmas(sqlite)
  ensureMigrationJournal(sqlite, migrationsFolder)
  migrateSqliteDatabase(sqlite, {
    migrationsFolder,
  })

  const db = Object.assign(createDrizzleSqliteDatabase(sqlite, { schema }) as object, {
    close: () => {
      sqlite.close()
    },
    sqlite,
  }) as AppDatabase

  return db
}
