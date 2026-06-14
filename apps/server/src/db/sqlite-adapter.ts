import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

const isBunRuntime = (): boolean => process.versions.bun !== undefined

export interface SqliteStatement<TResult = unknown> {
  all: (...params: unknown[]) => TResult[]
  get: (...params: unknown[]) => TResult | undefined
  run: (...params: unknown[]) => unknown
  values: (...params: unknown[]) => unknown[][]
}

type TransactionRunner = {
  deferred?: () => unknown
  exclusive?: () => unknown
  immediate?: () => unknown
}

export interface SqliteDatabaseHandle {
  close: () => void
  exec: (sql: string) => unknown
  prepare: <TResult = unknown>(sql: string) => SqliteStatement<TResult>
  transaction: <TArgs extends unknown[], TResult>(
    callback: (...args: TArgs) => TResult,
  ) => ((...args: TArgs) => TResult) & TransactionRunner
}

export const openSqliteDatabase = (filename: string): SqliteDatabaseHandle => {
  if (isBunRuntime()) {
    const { Database } = require('bun:sqlite') as {
      Database: new (filename?: string, options?: Record<string, unknown>) => SqliteDatabaseHandle
    }

    return new Database(filename)
  }

  const BetterSqlite3 = require('better-sqlite3') as new (filename: string) => SqliteDatabaseHandle

  return new BetterSqlite3(filename)
}

export const createDrizzleSqliteDatabase = <TSchema extends Record<string, unknown>>(
  sqlite: SqliteDatabaseHandle,
  config: { schema: TSchema },
): unknown => {
  if (isBunRuntime()) {
    const { drizzle } = require('drizzle-orm/bun-sqlite') as {
      drizzle: (client: SqliteDatabaseHandle, config: { schema: TSchema }) => unknown
    }

    return drizzle(sqlite, config)
  }

  const { drizzle } = require('drizzle-orm/better-sqlite3') as {
    drizzle: (client: SqliteDatabaseHandle, config: { schema: TSchema }) => unknown
  }

  return drizzle(sqlite, config)
}

export const migrateSqliteDatabase = (
  sqlite: SqliteDatabaseHandle,
  config: { migrationsFolder: string },
): void => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `)

  const journalPath = join(config.migrationsFolder, 'meta', '_journal.json')

  if (!existsSync(journalPath)) {
    throw new Error(`Migration journal not found at ${journalPath}`)
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>
  }
  const appliedMigrations = new Set(
    (
      sqlite
        .prepare<{ created_at: number }>(
          `
            SELECT created_at
            FROM "__drizzle_migrations"
            ORDER BY created_at
          `,
        )
        .all() as Array<{ created_at: number }>
    ).map((entry) => entry.created_at),
  )
  const insertMigration = sqlite.prepare(`
    INSERT INTO "__drizzle_migrations" ("hash", "created_at")
    VALUES (?, ?)
  `)

  for (const entry of journal.entries) {
    if (appliedMigrations.has(entry.when)) {
      continue
    }

    const migrationPath = join(config.migrationsFolder, `${entry.tag}.sql`)

    if (!existsSync(migrationPath)) {
      throw new Error(`Migration file not found at ${migrationPath}`)
    }

    const sql = readFileSync(migrationPath, 'utf8')
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)
      .map((statement) => normalizeMigrationStatement(statement))
    const hash = createHash('sha256').update(readFileSync(migrationPath)).digest('hex')
    const requiresAutocommit = statements.some((statement) =>
      /PRAGMA\s+foreign_keys\s*=/i.test(statement),
    )

    if (requiresAutocommit) {
      // SQLite ignores foreign_keys pragma changes inside an open transaction.
      // Table-rebuild migrations that toggle it must therefore run statement-by-statement.
      for (const statement of statements) {
        sqlite.exec(statement)
      }

      insertMigration.run(hash, entry.when)
      continue
    }

    const applyMigration = sqlite.transaction(() => {
      for (const statement of statements) {
        sqlite.exec(statement)
      }

      insertMigration.run(hash, entry.when)
    })

    applyMigration()
  }
}

const normalizeMigrationStatement = (statement: string): string => {
  if (!isBunRuntime()) {
    return statement
  }

  return statement
    .replace(/"__new_[^"]+"\."([^"]+)"/g, '"$1"')
    .replace(/`__new_[^`]+`\.`([^`]+)`/g, '`$1`')
}
