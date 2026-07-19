import type { AppDatabase } from '../../../db/client'

/**
 * Narrow, adapter-owned view of {@link AppDatabase} used by concrete Drizzle
 * repository implementations. This lives under `adapters/persistence/sqlite`
 * (not `domain`) because it names Drizzle query-builder capabilities
 * (`select`/`insert`/`update`/`delete`) and the underlying `better-sqlite3`
 * handle; domain repository ports must stay persistence-neutral.
 */
export type RepositoryDatabase = Pick<AppDatabase, 'delete' | 'insert' | 'select' | 'update'> & {
  sqlite?: AppDatabase['sqlite']
}
