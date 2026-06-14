import { and, eq } from 'drizzle-orm'

import { runs, workSessions } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  asAccountId,
  asRunId,
  asTenantId,
  asWorkSessionId,
  asWorkspaceId,
  type RunId,
  type TenantId,
  type WorkSessionId,
  type WorkspaceId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface WorkSessionRecord {
  archivedAt: string | null
  createdAt: string
  createdByAccountId: AccountId | null
  deletedAt: string | null
  id: WorkSessionId
  metadata: Record<string, unknown> | null
  rootRunId: RunId | null
  status: 'active' | 'archived' | 'deleted'
  tenantId: TenantId
  title: string | null
  updatedAt: string
  workspaceId: WorkspaceId | null
  workspaceRef: string | null
}

export interface CreateWorkSessionInput {
  createdAt: string
  createdByAccountId: AccountId | null
  id: WorkSessionId
  metadata: Record<string, unknown> | null
  status: 'active'
  title: string | null
  updatedAt: string
  workspaceId: WorkspaceId | null
  workspaceRef: string | null
}

export interface AssignWorkSessionRootRunInput {
  rootRunId: RunId
  sessionId: WorkSessionId
  updatedAt: string
}

export interface AssignWorkSessionWorkspaceInput {
  sessionId: WorkSessionId
  updatedAt: string
  workspaceId: WorkspaceId
  workspaceRef: string
}

const toWorkSessionRecord = (sessionRow: typeof workSessions.$inferSelect): WorkSessionRecord => ({
  archivedAt: sessionRow.archivedAt,
  createdAt: sessionRow.createdAt,
  createdByAccountId: sessionRow.createdByAccountId
    ? asAccountId(sessionRow.createdByAccountId)
    : null,
  deletedAt: sessionRow.deletedAt,
  id: asWorkSessionId(sessionRow.id),
  metadata: sessionRow.metadata as Record<string, unknown> | null,
  rootRunId: sessionRow.rootRunId ? asRunId(sessionRow.rootRunId) : null,
  status: sessionRow.status,
  tenantId: asTenantId(sessionRow.tenantId),
  title: sessionRow.title,
  updatedAt: sessionRow.updatedAt,
  workspaceId: sessionRow.workspaceId ? asWorkspaceId(sessionRow.workspaceId) : null,
  workspaceRef: sessionRow.workspaceRef,
})

export const createWorkSessionRepository = (db: RepositoryDatabase) => {
  const getById = (
    scope: TenantScope,
    sessionId: WorkSessionId,
  ): Result<WorkSessionRecord, DomainError> => {
    const sessionRecord = db
      .select()
      .from(workSessions)
      .where(and(eq(workSessions.id, sessionId), eq(workSessions.tenantId, scope.tenantId)))
      .get()

    if (!sessionRecord) {
      return err({
        message: `work session ${sessionId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toWorkSessionRecord(sessionRecord))
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateWorkSessionInput,
    ): Result<WorkSessionRecord, DomainError> => {
      try {
        const sessionRecord: WorkSessionRecord = {
          archivedAt: null,
          createdAt: input.createdAt,
          createdByAccountId: input.createdByAccountId,
          deletedAt: null,
          id: input.id,
          metadata: input.metadata,
          rootRunId: null,
          status: input.status,
          tenantId: scope.tenantId,
          title: input.title,
          updatedAt: input.updatedAt,
          workspaceId: input.workspaceId,
          workspaceRef: input.workspaceRef,
        }

        db.insert(workSessions)
          .values({
            ...sessionRecord,
          })
          .run()

        return ok(sessionRecord)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown work session create failure'

        return err({
          message: `failed to create work session ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    assignRootRun: (
      scope: TenantScope,
      input: AssignWorkSessionRootRunInput,
    ): Result<WorkSessionRecord, DomainError> => {
      const runRecord = db
        .select({
          id: runs.id,
        })
        .from(runs)
        .where(
          and(
            eq(runs.id, input.rootRunId),
            eq(runs.sessionId, input.sessionId),
            eq(runs.tenantId, scope.tenantId),
          ),
        )
        .get()

      if (!runRecord) {
        return err({
          message: `root run ${input.rootRunId} was not found in session ${input.sessionId}`,
          type: 'not_found',
        })
      }

      try {
        db.update(workSessions)
          .set({
            rootRunId: input.rootRunId,
            updatedAt: input.updatedAt,
          })
          .where(
            and(eq(workSessions.id, input.sessionId), eq(workSessions.tenantId, scope.tenantId)),
          )
          .run()

        return getById(scope, input.sessionId)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown work session root run update failure'

        return err({
          message: `failed to assign root run ${input.rootRunId} to session ${input.sessionId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    assignWorkspace: (
      scope: TenantScope,
      input: AssignWorkSessionWorkspaceInput,
    ): Result<WorkSessionRecord, DomainError> => {
      try {
        db.update(workSessions)
          .set({
            updatedAt: input.updatedAt,
            workspaceId: input.workspaceId,
            workspaceRef: input.workspaceRef,
          })
          .where(
            and(eq(workSessions.id, input.sessionId), eq(workSessions.tenantId, scope.tenantId)),
          )
          .run()

        return getById(scope, input.sessionId)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown work session workspace update failure'

        return err({
          message: `failed to assign workspace ${input.workspaceId} to session ${input.sessionId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    toRecord: toWorkSessionRecord,
  }
}
