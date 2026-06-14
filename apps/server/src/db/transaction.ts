import type { AppDatabase } from './client'

type TransactionCallback = Parameters<AppDatabase['transaction']>[0]

export type AppTransaction = Parameters<TransactionCallback>[0]

export const withTransaction = <TValue>(
  db: AppDatabase,
  execute: (tx: AppTransaction) => TValue,
): TValue => db.transaction((tx) => execute(tx as AppTransaction))
