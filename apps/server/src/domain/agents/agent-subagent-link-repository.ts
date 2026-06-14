import { and, asc, eq } from 'drizzle-orm'

import { agentSubagentLinks } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AgentId,
  type AgentRevisionId,
  type AgentSubagentLinkId,
  asAgentId,
  asAgentRevisionId,
  asAgentSubagentLinkId,
  asTenantId,
  type TenantId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { DelegationMode } from './agent-types'

export interface AgentSubagentLinkRecord {
  alias: string
  childAgentId: AgentId
  createdAt: string
  delegationMode: DelegationMode
  id: AgentSubagentLinkId
  parentAgentRevisionId: AgentRevisionId
  position: number
  tenantId: TenantId
}

export interface CreateAgentSubagentLinkInput {
  alias: string
  childAgentId: AgentId
  createdAt: string
  delegationMode: DelegationMode
  id: AgentSubagentLinkId
  parentAgentRevisionId: AgentRevisionId
  position?: number
}

const toAgentSubagentLinkRecord = (
  row: typeof agentSubagentLinks.$inferSelect,
): AgentSubagentLinkRecord => ({
  alias: row.alias,
  childAgentId: asAgentId(row.childAgentId),
  createdAt: row.createdAt,
  delegationMode: row.delegationMode,
  id: asAgentSubagentLinkId(row.id),
  parentAgentRevisionId: asAgentRevisionId(row.parentAgentRevisionId),
  position: row.position,
  tenantId: asTenantId(row.tenantId),
})

export const createAgentSubagentLinkRepository = (db: RepositoryDatabase) => ({
  create: (
    scope: TenantScope,
    input: CreateAgentSubagentLinkInput,
  ): Result<AgentSubagentLinkRecord, DomainError> => {
    try {
      const record: AgentSubagentLinkRecord = {
        alias: input.alias,
        childAgentId: input.childAgentId,
        createdAt: input.createdAt,
        delegationMode: input.delegationMode,
        id: input.id,
        parentAgentRevisionId: input.parentAgentRevisionId,
        position: input.position ?? 0,
        tenantId: scope.tenantId,
      }

      db.insert(agentSubagentLinks)
        .values({
          ...record,
        })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown subagent link create failure'

      return err({
        message: `failed to create subagent link ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByParentRevisionId: (
    scope: TenantScope,
    parentAgentRevisionId: AgentRevisionId,
  ): Result<AgentSubagentLinkRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(agentSubagentLinks)
        .where(
          and(
            eq(agentSubagentLinks.parentAgentRevisionId, parentAgentRevisionId),
            eq(agentSubagentLinks.tenantId, scope.tenantId),
          ),
        )
        .orderBy(
          asc(agentSubagentLinks.position),
          asc(agentSubagentLinks.createdAt),
          asc(agentSubagentLinks.id),
        )
        .all()

      return ok(rows.map(toAgentSubagentLinkRecord))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown subagent link list failure'

      return err({
        message: `failed to list subagent links for revision ${parentAgentRevisionId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  toRecord: toAgentSubagentLinkRecord,
})
