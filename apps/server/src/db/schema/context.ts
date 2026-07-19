import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import {
  contextManifestModeValues,
  type RedactedContextManifest,
} from '../../domain/context/context-manifest-repository'
import { runs, sessionThreads } from './collaboration'
import { tenants } from './identity'

export const contextManifests = sqliteTable(
  'context_manifests',
  {
    assemblerVersion: text('assembler_version').notNull(),
    createdAt: text('created_at').notNull(),
    generatedAt: text('generated_at').notNull(),
    id: text('id').primaryKey(),
    manifestJson: text('manifest_json', { mode: 'json' })
      .$type<RedactedContextManifest>()
      .notNull(),
    mode: text('mode', { enum: contextManifestModeValues }).notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    replayHash: text('replay_hash').notNull(),
    runId: text('run_id').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    threadId: text('thread_id'),
    turn: integer('turn').notNull(),
  },
  (table) => [
    check('context_manifests_turn_nonnegative', sql`${table.turn} >= 0`),
    check('context_manifests_mode_valid', sql`${table.mode} in ('shadow', 'active')`),
    check('context_manifests_manifest_json_valid', sql`json_valid(${table.manifestJson})`),
    uniqueIndex('context_manifests_attempt_unique').on(
      table.tenantId,
      table.runId,
      table.turn,
      table.mode,
      table.assemblerVersion,
    ),
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'context_manifests_run_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.threadId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.tenantId],
      name: 'context_manifests_thread_tenant_fk',
    }).onDelete('cascade'),
    index('context_manifests_tenant_run_idx').on(
      table.tenantId,
      table.runId,
      table.createdAt,
      table.id,
    ),
    index('context_manifests_tenant_thread_idx').on(
      table.tenantId,
      table.threadId,
      table.createdAt,
      table.id,
    ),
    index('context_manifests_tenant_created_at_idx').on(table.tenantId, table.createdAt, table.id),
    index('context_manifests_created_at_idx').on(table.createdAt),
  ],
)
