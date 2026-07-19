import type { FileLinkRecord } from './file-link-repository'

export interface FileDeletionPlan {
  blobStorageKeys: string[]
  fileIdsToDelete: string[]
  fileLinkIdsToDelete: string[]
  uploadIdsToDelete: string[]
}

export interface BuildFileDeletionPlanFromDirectLinksInput {
  directLinkRows: FileLinkRecord[]
  sessionId: string
  tenantId: string
}

export interface SelectFileDeletionPlanInput {
  messageIds: string[]
  runIds: string[]
  sessionId: string
  tenantId: string
  threadIds: string[]
  toolExecutionIds: string[]
}

/**
 * Persistence-neutral port that computes which files, uploads, and file
 * links become orphaned (and therefore deletable) once a set of "direct"
 * file links is removed. Concrete implementations (e.g. the Drizzle/SQLite
 * adapter) live under `adapters/persistence/sqlite/`. This module must not
 * import anything from `db`, `drizzle-orm`, `application`, or `adapters` --
 * see `test/architecture-guardrails.test.ts`.
 */
export interface FileDeletionPlanRepository {
  buildFromDirectLinks: (input: BuildFileDeletionPlanFromDirectLinksInput) => FileDeletionPlan
  selectPlan: (input: SelectFileDeletionPlanInput) => FileDeletionPlan
}
