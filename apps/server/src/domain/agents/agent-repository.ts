import { and, asc, eq, ne } from 'drizzle-orm'

import { agents } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  type AgentId,
  type AgentRevisionId,
  asAccountId,
  asAgentId,
  asAgentRevisionId,
  asTenantId,
  type TenantId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { AgentKind, AgentStatus, AgentVisibility } from './agent-types'

export interface AgentRecord {
  activeRevisionId: AgentRevisionId | null
  archivedAt: string | null
  baseAgentId: AgentId | null
  createdAt: string
  createdByAccountId: AccountId | null
  id: AgentId
  kind: AgentKind
  name: string
  ownerAccountId: AccountId | null
  slug: string
  status: AgentStatus
  tenantId: TenantId
  updatedAt: string
  visibility: AgentVisibility
}

export interface CreateAgentInput {
  activeRevisionId?: AgentRevisionId | null
  baseAgentId?: AgentId | null
  createdAt: string
  createdByAccountId?: AccountId | null
  id: AgentId
  kind: AgentKind
  name: string
  ownerAccountId?: AccountId | null
  slug: string
  status: Extract<AgentStatus, 'active' | 'archived'>
  updatedAt: string
  visibility: AgentVisibility
}

export interface AssignAgentActiveRevisionInput {
  activeRevisionId: AgentRevisionId
  agentId: AgentId
  updatedAt: string
}

export interface UpdateAgentDefinitionInput {
  agentId: AgentId
  kind: AgentKind
  name: string
  ownerAccountId?: AccountId | null
  slug: string
  updatedAt: string
  visibility: AgentVisibility
}

export interface UpdateAgentStatusInput {
  agentId: AgentId
  archivedAt: string | null
  status: AgentStatus
  updatedAt: string
}

const toAgentRecord = (row: typeof agents.$inferSelect): AgentRecord => ({
  activeRevisionId: row.activeRevisionId ? asAgentRevisionId(row.activeRevisionId) : null,
  archivedAt: row.archivedAt,
  baseAgentId: row.baseAgentId ? asAgentId(row.baseAgentId) : null,
  createdAt: row.createdAt,
  createdByAccountId: row.createdByAccountId ? asAccountId(row.createdByAccountId) : null,
  id: asAgentId(row.id),
  kind: row.kind,
  name: row.name,
  ownerAccountId: row.ownerAccountId ? asAccountId(row.ownerAccountId) : null,
  slug: row.slug,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  updatedAt: row.updatedAt,
  visibility: row.visibility,
})

export const createAgentRepository = (db: RepositoryDatabase) => {
  const getById = (scope: TenantScope, agentId: AgentId): Result<AgentRecord, DomainError> => {
    const row = db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `agent ${agentId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toAgentRecord(row))
  }

  return {
    assignActiveRevision: (
      scope: TenantScope,
      input: AssignAgentActiveRevisionInput,
    ): Result<AgentRecord, DomainError> => {
      try {
        const result = db
          .update(agents)
          .set({
            activeRevisionId: input.activeRevisionId,
            updatedAt: input.updatedAt,
          })
          .where(and(eq(agents.id, input.agentId), eq(agents.tenantId, scope.tenantId)))
          .run()

        if (result.changes === 0) {
          return err({
            message: `agent ${input.agentId} could not update its active revision`,
            type: 'conflict',
          })
        }

        return getById(scope, input.agentId)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown active revision update failure'

        return err({
          message: `failed to update active revision for agent ${input.agentId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    updateDefinition: (
      scope: TenantScope,
      input: UpdateAgentDefinitionInput,
    ): Result<AgentRecord, DomainError> => {
      try {
        const result = db
          .update(agents)
          .set({
            kind: input.kind,
            name: input.name,
            ownerAccountId: input.ownerAccountId ?? null,
            slug: input.slug,
            updatedAt: input.updatedAt,
            visibility: input.visibility,
          })
          .where(and(eq(agents.id, input.agentId), eq(agents.tenantId, scope.tenantId)))
          .run()

        if (result.changes === 0) {
          return err({
            message: `agent ${input.agentId} could not update its definition`,
            type: 'conflict',
          })
        }

        return getById(scope, input.agentId)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent definition update failure'

        return err({
          message: `failed to update definition for agent ${input.agentId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    updateStatus: (
      scope: TenantScope,
      input: UpdateAgentStatusInput,
    ): Result<AgentRecord, DomainError> => {
      try {
        const result = db
          .update(agents)
          .set({
            archivedAt: input.archivedAt,
            status: input.status,
            updatedAt: input.updatedAt,
          })
          .where(and(eq(agents.id, input.agentId), eq(agents.tenantId, scope.tenantId)))
          .run()

        if (result.changes === 0) {
          return err({
            message: `agent ${input.agentId} could not update its status`,
            type: 'conflict',
          })
        }

        return getById(scope, input.agentId)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent status update failure'

        return err({
          message: `failed to update status for agent ${input.agentId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    create: (scope: TenantScope, input: CreateAgentInput): Result<AgentRecord, DomainError> => {
      try {
        const record: AgentRecord = {
          activeRevisionId: input.activeRevisionId ?? null,
          archivedAt: input.status === 'archived' ? input.updatedAt : null,
          baseAgentId: input.baseAgentId ?? null,
          createdAt: input.createdAt,
          createdByAccountId: input.createdByAccountId ?? null,
          id: input.id,
          kind: input.kind,
          name: input.name,
          ownerAccountId: input.ownerAccountId ?? null,
          slug: input.slug,
          status: input.status,
          tenantId: scope.tenantId,
          updatedAt: input.updatedAt,
          visibility: input.visibility,
        }

        db.insert(agents)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown agent create failure'

        return err({
          message: `failed to create agent ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    getBySlug: (scope: TenantScope, slug: string): Result<AgentRecord, DomainError> => {
      const rows = db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.slug, slug),
            eq(agents.tenantId, scope.tenantId),
            ne(agents.status, 'deleted'),
          ),
        )
        .orderBy(asc(agents.createdAt), asc(agents.id))
        .all()

      if (rows.length === 0) {
        return err({
          message: `agent slug ${slug} not found in tenant ${scope.tenantId}`,
          type: 'not_found',
        })
      }

      if (rows.length > 1) {
        return err({
          message: `agent slug ${slug} resolves to multiple live agents in tenant ${scope.tenantId}`,
          type: 'conflict',
        })
      }

      return ok(toAgentRecord(rows[0]))
    },
    listByTenant: (scope: TenantScope): Result<AgentRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(agents)
          .where(eq(agents.tenantId, scope.tenantId))
          .orderBy(asc(agents.createdAt), asc(agents.id))
          .all()

        return ok(rows.map(toAgentRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown agent list failure'

        return err({
          message: `failed to list agents in tenant ${scope.tenantId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    toRecord: toAgentRecord,
  }
}
