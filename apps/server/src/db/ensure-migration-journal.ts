import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SqliteDatabaseHandle } from './sqlite-adapter'

const migrationsTableName = '__drizzle_migrations'
const managedTableNamesV0 = [
  'accounts',
  'api_keys',
  'domain_events',
  'event_outbox',
  'items',
  'run_dependencies',
  'runs',
  'session_messages',
  'session_threads',
  'tenant_memberships',
  'tenants',
  'tool_executions',
  'usage_ledger',
  'work_sessions',
] as const
const managedTableNamesV1 = [
  'accounts',
  'api_keys',
  'context_summaries',
  'domain_events',
  'event_outbox',
  'file_links',
  'files',
  'items',
  'run_claims',
  'run_dependencies',
  'runs',
  'session_messages',
  'session_threads',
  'tenant_memberships',
  'tenants',
  'tool_executions',
  'usage_ledger',
  'work_sessions',
] as const
const managedTableNamesV2 = [
  'accounts',
  'api_keys',
  'context_summaries',
  'domain_events',
  'event_outbox',
  'file_links',
  'files',
  'items',
  'run_claims',
  'run_dependencies',
  'runs',
  'session_messages',
  'session_threads',
  'tenant_memberships',
  'tenants',
  'tool_executions',
  'uploads',
  'usage_ledger',
  'work_sessions',
] as const

interface MigrationJournalEntry {
  idx: number
  tag: string
  when: number
}

interface MigrationJournal {
  entries: MigrationJournalEntry[]
}

const getUserTableNames = (sqlite: SqliteDatabaseHandle): string[] => {
  const rows = sqlite
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all() as Array<{ name: string }>

  return rows.map((row) => row.name)
}

const matchesTableSet = (tableNames: string[], expected: readonly string[]): boolean => {
  if (tableNames.length !== expected.length) {
    return false
  }

  return expected.every((tableName, index) => tableName === tableNames[index])
}

const hasSchemaObject = (
  sqlite: SqliteDatabaseHandle,
  type: 'index' | 'table',
  name: string,
): boolean =>
  sqlite
    .prepare(
      `
        SELECT 1
        FROM sqlite_master
        WHERE type = ?
          AND name = ?
        LIMIT 1
      `,
    )
    .get(type, name) !== undefined

const resolveLegacyBaselineTag = (sqlite: SqliteDatabaseHandle, tableNames: string[]): string => {
  if (matchesTableSet(tableNames, managedTableNamesV0)) {
    return '0000_overjoyed_jack_murdock'
  }

  if (!matchesTableSet(tableNames, managedTableNamesV1)) {
    if (matchesTableSet(tableNames, managedTableNamesV2)) {
      return '0006_tan_uploads'
    }

    throw new Error(
      'Existing SQLite database has no migration journal and does not match a supported legacy managed schema. Reset it or migrate it manually before starting the app.',
    )
  }

  if (hasSchemaObject(sqlite, 'index', 'runs_id_tenant_unique')) {
    return '0002_sharp_stature'
  }

  return '0001_oval_toxin'
}

const readMigrationJournal = (migrationsFolder: string): MigrationJournal => {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json')

  if (!existsSync(journalPath)) {
    throw new Error(`Migration journal not found at ${journalPath}`)
  }

  return JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal
}

const readMigrationHash = (migrationsFolder: string, tag: string): string => {
  const migrationPath = join(migrationsFolder, `${tag}.sql`)

  if (!existsSync(migrationPath)) {
    throw new Error(`Migration file not found at ${migrationPath}`)
  }

  return createHash('sha256').update(readFileSync(migrationPath)).digest('hex')
}

const createMigrationsTable = (sqlite: SqliteDatabaseHandle): void => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "${migrationsTableName}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `)
}

export const ensureMigrationJournal = (
  sqlite: SqliteDatabaseHandle,
  migrationsFolder: string,
): void => {
  const tableNames = getUserTableNames(sqlite)

  if (tableNames.includes(migrationsTableName)) {
    return
  }

  if (tableNames.length === 0) {
    return
  }

  const journal = readMigrationJournal(migrationsFolder)
  const baselineTag = resolveLegacyBaselineTag(sqlite, tableNames)
  const baselineIndex = journal.entries.findIndex((entry) => entry.tag === baselineTag)

  if (baselineIndex === -1) {
    throw new Error(
      `Legacy baseline tag ${baselineTag} is missing from the committed migration journal`,
    )
  }

  const baselineEntries = journal.entries.slice(0, baselineIndex + 1)

  createMigrationsTable(sqlite)

  const insertMigration = sqlite.prepare(`
    INSERT INTO "${migrationsTableName}" ("hash", "created_at")
    VALUES (?, ?)
  `)

  const applyBaseline = sqlite.transaction((entries: MigrationJournalEntry[]) => {
    for (const entry of entries) {
      insertMigration.run(readMigrationHash(migrationsFolder, entry.tag), entry.when)
    }
  })

  applyBaseline(baselineEntries)
}
