import type { AppDatabase } from '../db/client'

export type RepositoryDatabase = Pick<AppDatabase, 'delete' | 'insert' | 'select' | 'update'> & {
  sqlite?: AppDatabase['sqlite']
}
