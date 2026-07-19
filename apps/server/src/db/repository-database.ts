import type { AppDatabase } from './client'

/**
 * Narrow, capability-based view of {@link AppDatabase} used both by concrete
 * Drizzle repository implementations (under `adapters/persistence/sqlite/`)
 * and by application-layer code that needs to pass a database handle
 * through to those repositories (e.g. inside `withTransaction` callbacks).
 * It only names query-builder capabilities (`select`/`insert`/`update`/
 * `delete`) and the underlying `better-sqlite3` handle -- never Drizzle
 * table/schema types -- so it is safe for both layers to reference.
 */
export type RepositoryDatabase = Pick<AppDatabase, 'delete' | 'insert' | 'select' | 'update'> & {
  sqlite?: AppDatabase['sqlite']
}
