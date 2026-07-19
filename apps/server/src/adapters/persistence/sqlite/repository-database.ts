/**
 * Re-export of the shared repository database handle type. Concrete
 * repository adapters under `adapters/persistence/sqlite/**` import from
 * here (shorter relative path); the canonical definition lives in
 * `db/repository-database.ts` so application-layer code can reference the
 * same handle type without reaching into the adapters layer.
 */
export type { RepositoryDatabase } from '../../../db/repository-database'
