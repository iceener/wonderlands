import { and, asc, eq } from 'drizzle-orm'

import { agentRevisions } from '../../../../db/schema'
import type {
  AgentRevisionRecord,
  AgentRevisionRepository,
  CreateAgentRevisionInput,
} from '../../../../domain/agents/agent-revision-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  type AgentId,
  type AgentRevisionId,
  asAccountId,
  asAgentId,
  asAgentRevisionId,
  asTenantId,
  asToolProfileId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toAgentRevisionRecord = (row: typeof agentRevisions.$inferSelect): AgentRevisionRecord => ({
  agentId: asAgentId(row.agentId),
  checksumSha256: row.checksumSha256,
  createdAt: row.createdAt,
  createdByAccountId: row.createdByAccountId ? asAccountId(row.createdByAccountId) : null,
  frontmatterJson: row.frontmatterJson as Record<string, unknown>,
  gardenFocusJson: row.gardenFocusJson as Record<string, unknown>,
  id: asAgentRevisionId(row.id),
  instructionsMd: row.instructionsMd,
  kernelPolicyJson: row.kernelPolicyJson as Record<string, unknown>,
  memoryPolicyJson: row.memoryPolicyJson as Record<string, unknown>,
  modelConfigJson: row.modelConfigJson as Record<string, unknown>,
  resolvedConfigJson: row.resolvedConfigJson as Record<string, unknown>,
  sandboxPolicyJson: row.sandboxPolicyJson as Record<string, unknown>,
  sourceMarkdown: row.sourceMarkdown,
  tenantId: asTenantId(row.tenantId),
  toolProfileId: row.toolProfileId ? asToolProfileId(row.toolProfileId) : null,
  toolPolicyJson: row.toolPolicyJson as Record<string, unknown>,
  version: row.version,
  workspacePolicyJson: row.workspacePolicyJson as Record<string, unknown>,
})

export const createAgentRevisionRepository = (db: RepositoryDatabase): AgentRevisionRepository => {
  const getById = (
    scope: TenantScope,
    revisionId: AgentRevisionId,
  ): Result<AgentRevisionRecord, DomainError> => {
    const row = db
      .select()
      .from(agentRevisions)
      .where(and(eq(agentRevisions.id, revisionId), eq(agentRevisions.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `agent revision ${revisionId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toAgentRevisionRecord(row))
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateAgentRevisionInput,
    ): Result<AgentRevisionRecord, DomainError> => {
      try {
        const record: AgentRevisionRecord = {
          agentId: input.agentId,
          checksumSha256: input.checksumSha256,
          createdAt: input.createdAt,
          createdByAccountId: input.createdByAccountId ?? null,
          frontmatterJson: input.frontmatterJson,
          gardenFocusJson: input.gardenFocusJson ?? {},
          id: input.id,
          instructionsMd: input.instructionsMd,
          kernelPolicyJson: input.kernelPolicyJson,
          memoryPolicyJson: input.memoryPolicyJson,
          modelConfigJson: input.modelConfigJson,
          resolvedConfigJson: input.resolvedConfigJson,
          sandboxPolicyJson: input.sandboxPolicyJson,
          sourceMarkdown: input.sourceMarkdown,
          tenantId: scope.tenantId,
          toolProfileId: input.toolProfileId ?? null,
          toolPolicyJson: input.toolPolicyJson,
          version: input.version,
          workspacePolicyJson: input.workspacePolicyJson,
        }

        db.insert(agentRevisions)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent revision create failure'

        return err({
          message: `failed to create agent revision ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByAgentId: (
      scope: TenantScope,
      agentId: AgentId,
    ): Result<AgentRevisionRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(agentRevisions)
          .where(
            and(eq(agentRevisions.agentId, agentId), eq(agentRevisions.tenantId, scope.tenantId)),
          )
          .orderBy(
            asc(agentRevisions.version),
            asc(agentRevisions.createdAt),
            asc(agentRevisions.id),
          )
          .all()

        return ok(rows.map(toAgentRevisionRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent revision list failure'

        return err({
          message: `failed to list revisions for agent ${agentId}: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
