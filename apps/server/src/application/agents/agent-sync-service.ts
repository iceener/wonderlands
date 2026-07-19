import { createHash } from 'node:crypto'
import type { AppDatabase } from '../../db/client'
import { withTransaction } from '../../db/transaction'
import type { AgentRecord } from '../../domain/agents/agent-repository'
import type { AgentRevisionRecord } from '../../domain/agents/agent-revision-repository'
import type { AgentSubagentLinkRecord } from '../../domain/agents/agent-subagent-link-repository'
import type { KernelPolicy } from '../../domain/kernel/types'
import type { SandboxPolicy } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  type AgentId,
  type AgentRevisionId,
  asAgentId,
  asAgentRevisionId,
  asAgentSubagentLinkId,
  asToolProfileId,
  createPrefixedId,
  type ToolProfileId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { createEventStore } from '../commands/event-store'
import { parseKernelPolicyJson } from '../kernel/kernel-policy'
import {
  createAgentRepository,
  createAgentRevisionRepository,
  createAgentSubagentLinkRepository,
} from '../persistence/repositories'
import { parseSandboxPolicyJson } from '../sandbox/sandbox-policy'
import { buildEffectiveNativeTools } from './agent-capability-tools'
import {
  type AgentMarkdownDocument,
  type AgentMarkdownFrontmatter,
  type AgentMarkdownSubagent,
  parseAgentMarkdown,
  parseStoredAgentFrontmatter,
  serializeAgentMarkdown,
  toAgentMarkdownFrontmatterJson,
} from './agent-markdown'

export interface AgentMarkdownExport {
  agent: AgentRecord
  revision: AgentRevisionRecord
  markdown: string
  subagentLinks: AgentSubagentLinkRecord[]
}

export interface AgentMarkdownImportResult extends AgentMarkdownExport {
  created: boolean
}

export interface AgentSyncService {
  exportMarkdown: (
    scope: TenantScope,
    input: {
      agentId: AgentId
      revisionId?: AgentRevisionId
    },
  ) => Result<AgentMarkdownExport, DomainError>
  importMarkdown: (
    scope: TenantScope,
    input: {
      actorAccountId?: AccountId | null
      markdown: string
    },
  ) => Result<AgentMarkdownImportResult, DomainError>
}

export interface CreateAgentSyncServiceDependencies {
  createId?: (prefix: string) => string
  db: AppDatabase
  now?: () => string
}

const buildChecksumSha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

const toValidationError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'validation',
  })

const toConflictError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'conflict',
  })

const toJsonRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>

const buildModelConfigJson = (frontmatter: AgentMarkdownFrontmatter): Record<string, unknown> =>
  frontmatter.model
    ? {
        modelAlias: frontmatter.model.modelAlias,
        provider: frontmatter.model.provider,
        ...(frontmatter.model.reasoning
          ? {
              reasoning: {
                effort: frontmatter.model.reasoning.effort,
              },
            }
          : {}),
      }
    : {}

const buildToolPolicyJson = (
  frontmatter: AgentMarkdownFrontmatter,
  capabilities: {
    kernel: KernelPolicy
    sandbox: SandboxPolicy
  },
): Record<string, unknown> => {
  const native = buildEffectiveNativeTools(frontmatter.tools, capabilities)
  const mcpMode = frontmatter.tools?.mcpMode

  return {
    ...(mcpMode ? { mcpMode } : {}),
    ...(native ? { native } : {}),
  }
}

const buildGardenFocusJson = (frontmatter: AgentMarkdownFrontmatter): Record<string, unknown> =>
  frontmatter.garden?.preferredSlugs && frontmatter.garden.preferredSlugs.length > 0
    ? {
        preferredSlugs: [...frontmatter.garden.preferredSlugs],
      }
    : {}

const buildMemoryPolicyJson = (frontmatter: AgentMarkdownFrontmatter): Record<string, unknown> =>
  frontmatter.memory
    ? {
        ...(frontmatter.memory.profileScope !== undefined
          ? {
              profileScope: frontmatter.memory.profileScope,
            }
          : {}),
        ...(frontmatter.memory.childPromotion
          ? {
              childPromotion: frontmatter.memory.childPromotion,
            }
          : {}),
      }
    : {}

const buildWorkspacePolicyJson = (
  frontmatter: AgentMarkdownFrontmatter,
): Record<string, unknown> =>
  frontmatter.workspace
    ? {
        strategy: frontmatter.workspace.strategy,
      }
    : {}

const buildSandboxPolicy = (
  frontmatter: AgentMarkdownFrontmatter,
): Result<SandboxPolicy, DomainError> => parseSandboxPolicyJson(frontmatter.sandbox)

const buildKernelPolicy = (
  frontmatter: AgentMarkdownFrontmatter,
): Result<KernelPolicy, DomainError> => parseKernelPolicyJson(frontmatter.kernel)

const buildResolvedConfigJson = (
  frontmatter: AgentMarkdownFrontmatter,
  capabilities: {
    kernel: KernelPolicy
    sandbox: SandboxPolicy
  },
): Record<string, unknown> => ({
  garden: buildGardenFocusJson(frontmatter),
  kernel: toJsonRecord(capabilities.kernel),
  memory: buildMemoryPolicyJson(frontmatter),
  model: buildModelConfigJson(frontmatter),
  sandbox: toJsonRecord(capabilities.sandbox),
  subagents:
    frontmatter.subagents?.map((subagent) => ({
      alias: subagent.alias,
      mode: subagent.mode,
      slug: subagent.slug,
    })) ?? [],
  tools: buildToolPolicyJson(frontmatter, capabilities),
  workspace: buildWorkspacePolicyJson(frontmatter),
})

const normalizeTools = (
  tools: AgentMarkdownFrontmatter['tools'] | undefined,
): AgentMarkdownFrontmatter['tools'] | undefined => {
  const mcpMode = tools?.mcpMode
  const native =
    Array.isArray(tools?.native) && tools.native.length > 0 ? [...tools.native] : undefined
  const normalizedToolProfileId =
    typeof tools?.toolProfileId === 'string'
      ? tools.toolProfileId.trim() || null
      : (tools?.toolProfileId ?? undefined)

  if (!native && mcpMode === undefined && normalizedToolProfileId === undefined) {
    return undefined
  }

  return {
    ...(mcpMode !== undefined ? { mcpMode } : {}),
    ...(normalizedToolProfileId !== undefined ? { toolProfileId: normalizedToolProfileId } : {}),
    ...(native ? { native } : {}),
  }
}

const normalizeGarden = (
  garden: AgentMarkdownFrontmatter['garden'] | undefined,
): AgentMarkdownFrontmatter['garden'] | undefined => {
  const preferredSlugs =
    Array.isArray(garden?.preferredSlugs) && garden.preferredSlugs.length > 0
      ? Array.from(new Set(garden.preferredSlugs.map((slug) => slug.trim()).filter(Boolean)))
      : undefined

  return preferredSlugs ? { preferredSlugs } : undefined
}

const toRevisionToolProfileId = (
  tools: AgentMarkdownFrontmatter['tools'] | undefined,
): ToolProfileId | null => {
  if (typeof tools?.toolProfileId !== 'string') {
    return null
  }

  const normalized = tools.toolProfileId.trim()

  if (!normalized.startsWith('tpf_')) {
    return null
  }

  return asToolProfileId(normalized)
}

const resolveSubagentDefinitions = (
  scope: TenantScope,
  frontmatter: AgentMarkdownFrontmatter,
  agentRepository: ReturnType<typeof createAgentRepository>,
): Result<Array<AgentMarkdownSubagent & { childAgentId: AgentId }>, DomainError> => {
  const resolved: Array<AgentMarkdownSubagent & { childAgentId: AgentId }> = []

  for (const subagent of frontmatter.subagents ?? []) {
    const childAgent = agentRepository.getBySlug(scope, subagent.slug)

    if (!childAgent.ok) {
      return toValidationError(
        `subagent slug "${subagent.slug}" does not resolve to an existing agent in tenant ${scope.tenantId}`,
      )
    }

    if (childAgent.value.status !== 'active') {
      return toValidationError(
        `subagent slug "${subagent.slug}" does not resolve to an active agent in tenant ${scope.tenantId}`,
      )
    }

    if (frontmatter.agentId && childAgent.value.id === frontmatter.agentId) {
      return toValidationError('agent markdown cannot delegate to itself')
    }

    resolved.push({
      ...subagent,
      childAgentId: childAgent.value.id,
    })
  }

  return ok(resolved)
}

const ensureAgentSlugAvailable = (
  scope: TenantScope,
  agentRepository: ReturnType<typeof createAgentRepository>,
  slug: string,
  currentAgentId?: AgentId,
): Result<null, DomainError> => {
  const existing = agentRepository.getBySlug(scope, slug)

  if (!existing.ok) {
    if (existing.error.type === 'not_found') {
      return ok(null)
    }

    return existing
  }

  if (currentAgentId && existing.value.id === currentAgentId) {
    return ok(null)
  }

  return toValidationError(`agent slug "${slug}" is already in use`)
}

const toExportDocument = (
  agent: AgentRecord,
  revision: AgentRevisionRecord,
  subagents: AgentMarkdownSubagent[],
): Result<AgentMarkdownDocument, DomainError> => {
  const storedFrontmatter = parseStoredAgentFrontmatter(revision.frontmatterJson)

  if (!storedFrontmatter.ok) {
    return storedFrontmatter
  }

  return ok({
    frontmatter: {
      ...storedFrontmatter.value,
      agentId: agent.id,
      kind: agent.kind,
      name: agent.name,
      revisionId: revision.id,
      slug: agent.slug,
      subagents,
      visibility: agent.visibility,
    },
    instructionsMd: revision.instructionsMd,
  })
}

export const createAgentSyncService = ({
  createId = createPrefixedId,
  db,
  now = () => new Date().toISOString(),
}: CreateAgentSyncServiceDependencies): AgentSyncService => ({
  exportMarkdown: (scope, input): Result<AgentMarkdownExport, DomainError> => {
    const agentRepository = createAgentRepository(db)
    const revisionRepository = createAgentRevisionRepository(db)
    const subagentLinkRepository = createAgentSubagentLinkRepository(db)

    const agent = agentRepository.getById(scope, input.agentId)

    if (!agent.ok) {
      return agent
    }

    const revisionId = input.revisionId ?? agent.value.activeRevisionId

    if (!revisionId) {
      return err({
        message: `agent ${input.agentId} has no active revision to export`,
        type: 'not_found',
      })
    }

    const revision = revisionRepository.getById(scope, revisionId)

    if (!revision.ok) {
      return revision
    }

    const subagentLinks = subagentLinkRepository.listByParentRevisionId(scope, revision.value.id)

    if (!subagentLinks.ok) {
      return subagentLinks
    }

    const subagents: AgentMarkdownSubagent[] = []

    for (const link of subagentLinks.value) {
      const childAgent = agentRepository.getById(scope, link.childAgentId)

      if (!childAgent.ok) {
        return err({
          message: `child agent ${link.childAgentId} could not be loaded for revision ${revision.value.id}`,
          type: 'conflict',
        })
      }

      if (childAgent.value.status !== 'active') {
        continue
      }

      subagents.push({
        alias: link.alias,
        mode: link.delegationMode,
        slug: childAgent.value.slug,
      })
    }

    const exportDocument = toExportDocument(agent.value, revision.value, subagents)

    if (!exportDocument.ok) {
      return exportDocument
    }

    return ok({
      agent: agent.value,
      markdown: serializeAgentMarkdown(exportDocument.value),
      revision: revision.value,
      subagentLinks: subagentLinks.value,
    })
  },
  importMarkdown: (scope, input): Result<AgentMarkdownImportResult, DomainError> =>
    withTransaction(db, (tx) => {
      const parsed = parseAgentMarkdown(input.markdown)

      if (!parsed.ok) {
        return parsed
      }

      const agentRepository = createAgentRepository(tx)
      const revisionRepository = createAgentRevisionRepository(tx)
      const subagentLinkRepository = createAgentSubagentLinkRepository(tx)
      const eventStore = createEventStore(tx)
      const timestamp = now()
      let created = false
      let agent: AgentRecord
      let currentRevisions: AgentRevisionRecord[] = []

      if (parsed.value.frontmatter.agentId) {
        const currentAgent = agentRepository.getById(scope, parsed.value.frontmatter.agentId)

        if (!currentAgent.ok) {
          return currentAgent
        }

        if (currentAgent.value.status !== 'active') {
          return toConflictError(`agent ${currentAgent.value.id} is not active`)
        }

        if (!parsed.value.frontmatter.revisionId) {
          return toConflictError('existing agent markdown imports must include revision_id')
        }

        if (currentAgent.value.activeRevisionId !== parsed.value.frontmatter.revisionId) {
          return toConflictError(
            `agent ${currentAgent.value.id} is at revision ${currentAgent.value.activeRevisionId ?? 'none'}, not ${parsed.value.frontmatter.revisionId}`,
          )
        }

        const availableSlug = ensureAgentSlugAvailable(
          scope,
          agentRepository,
          parsed.value.frontmatter.slug,
          currentAgent.value.id,
        )

        if (!availableSlug.ok) {
          return availableSlug
        }

        const revisions = revisionRepository.listByAgentId(scope, currentAgent.value.id)

        if (!revisions.ok) {
          return revisions
        }

        const updatedAgent = agentRepository.updateDefinition(scope, {
          agentId: currentAgent.value.id,
          kind: parsed.value.frontmatter.kind,
          name: parsed.value.frontmatter.name,
          ownerAccountId:
            parsed.value.frontmatter.visibility === 'system'
              ? null
              : (currentAgent.value.ownerAccountId ?? input.actorAccountId ?? scope.accountId),
          slug: parsed.value.frontmatter.slug,
          updatedAt: timestamp,
          visibility: parsed.value.frontmatter.visibility,
        })

        if (!updatedAgent.ok) {
          return updatedAgent
        }

        agent = updatedAgent.value
        currentRevisions = revisions.value
      } else {
        if (parsed.value.frontmatter.revisionId) {
          return toValidationError('new agent markdown cannot provide revision_id without agent_id')
        }

        const availableSlug = ensureAgentSlugAvailable(
          scope,
          agentRepository,
          parsed.value.frontmatter.slug,
        )

        if (!availableSlug.ok) {
          return availableSlug
        }

        const agentId = asAgentId(createId('agt'))
        const createdAgent = agentRepository.create(scope, {
          createdAt: timestamp,
          createdByAccountId: input.actorAccountId ?? scope.accountId,
          id: agentId,
          kind: parsed.value.frontmatter.kind,
          name: parsed.value.frontmatter.name,
          ownerAccountId:
            parsed.value.frontmatter.visibility === 'system'
              ? null
              : (input.actorAccountId ?? scope.accountId),
          slug: parsed.value.frontmatter.slug,
          status: 'active',
          updatedAt: timestamp,
          visibility: parsed.value.frontmatter.visibility,
        })

        if (!createdAgent.ok) {
          return createdAgent
        }

        created = true
        agent = createdAgent.value

        const agentCreatedEvent = eventStore.append({
          actorAccountId: input.actorAccountId ?? scope.accountId,
          aggregateId: createdAgent.value.id,
          aggregateType: 'agent',
          outboxTopics: ['projection', 'realtime'],
          payload: {
            agentId: createdAgent.value.id,
            kind: createdAgent.value.kind,
            name: createdAgent.value.name,
            ownerAccountId: createdAgent.value.ownerAccountId,
            slug: createdAgent.value.slug,
            status: createdAgent.value.status,
            visibility: createdAgent.value.visibility,
          },
          tenantId: scope.tenantId,
          type: 'agent.created',
        })

        if (!agentCreatedEvent.ok) {
          return agentCreatedEvent
        }
      }

      const resolvedSubagents = resolveSubagentDefinitions(
        scope,
        {
          ...parsed.value.frontmatter,
          agentId: agent.id,
        },
        agentRepository,
      )

      if (!resolvedSubagents.ok) {
        return resolvedSubagents
      }

      const revisionId = asAgentRevisionId(createId('agr'))
      const nextVersion =
        currentRevisions.reduce(
          (highestVersion, revision) => Math.max(highestVersion, revision.version),
          0,
        ) + 1

      const canonicalDocument: AgentMarkdownDocument = {
        frontmatter: {
          ...parsed.value.frontmatter,
          agentId: agent.id,
          garden: normalizeGarden(parsed.value.frontmatter.garden),
          kind: agent.kind,
          name: agent.name,
          revisionId,
          slug: agent.slug,
          subagents: resolvedSubagents.value.map((subagent) => ({
            alias: subagent.alias,
            mode: subagent.mode,
            slug: subagent.slug,
          })),
          tools: normalizeTools(parsed.value.frontmatter.tools),
          visibility: agent.visibility,
        },
        instructionsMd: parsed.value.instructionsMd,
      }

      const sourceMarkdown = serializeAgentMarkdown(canonicalDocument)
      const checksumSha256 = buildChecksumSha256(sourceMarkdown)

      const sandboxPolicy = buildSandboxPolicy(canonicalDocument.frontmatter)

      if (!sandboxPolicy.ok) {
        return sandboxPolicy
      }

      const kernelPolicy = buildKernelPolicy(canonicalDocument.frontmatter)

      if (!kernelPolicy.ok) {
        return kernelPolicy
      }

      const capabilities = {
        kernel: kernelPolicy.value,
        sandbox: sandboxPolicy.value,
      }
      const toolPolicyJson = buildToolPolicyJson(canonicalDocument.frontmatter, capabilities)
      const resolvedConfigJson = buildResolvedConfigJson(
        canonicalDocument.frontmatter,
        capabilities,
      )

      if (currentRevisions.some((revision) => revision.checksumSha256 === checksumSha256)) {
        return toConflictError(`agent ${agent.id} import produced no revision changes`)
      }

      const revision = revisionRepository.create(scope, {
        agentId: agent.id,
        checksumSha256,
        createdAt: timestamp,
        createdByAccountId: input.actorAccountId ?? scope.accountId,
        frontmatterJson: toAgentMarkdownFrontmatterJson(canonicalDocument.frontmatter),
        gardenFocusJson: buildGardenFocusJson(canonicalDocument.frontmatter),
        id: revisionId,
        instructionsMd: canonicalDocument.instructionsMd,
        kernelPolicyJson: toJsonRecord(kernelPolicy.value),
        memoryPolicyJson: buildMemoryPolicyJson(canonicalDocument.frontmatter),
        modelConfigJson: buildModelConfigJson(canonicalDocument.frontmatter),
        resolvedConfigJson,
        sandboxPolicyJson: toJsonRecord(sandboxPolicy.value),
        sourceMarkdown,
        toolProfileId: toRevisionToolProfileId(canonicalDocument.frontmatter.tools),
        toolPolicyJson,
        version: nextVersion,
        workspacePolicyJson: buildWorkspacePolicyJson(canonicalDocument.frontmatter),
      })

      if (!revision.ok) {
        return revision
      }

      const revisionCreatedEvent = eventStore.append({
        actorAccountId: input.actorAccountId ?? scope.accountId,
        aggregateId: revision.value.id,
        aggregateType: 'agent_revision',
        outboxTopics: ['projection', 'realtime'],
        payload: {
          agentId: agent.id,
          checksumSha256: revision.value.checksumSha256,
          revisionId: revision.value.id,
          slug: agent.slug,
          version: revision.value.version,
        },
        tenantId: scope.tenantId,
        type: 'agent.revision.created',
      })

      if (!revisionCreatedEvent.ok) {
        return revisionCreatedEvent
      }

      const subagentLinks: AgentSubagentLinkRecord[] = []

      for (const [index, subagent] of resolvedSubagents.value.entries()) {
        const link = subagentLinkRepository.create(scope, {
          alias: subagent.alias,
          childAgentId: subagent.childAgentId,
          createdAt: timestamp,
          delegationMode: subagent.mode,
          id: asAgentSubagentLinkId(createId('asl')),
          parentAgentRevisionId: revision.value.id,
          position: index,
        })

        if (!link.ok) {
          return link
        }

        subagentLinks.push(link.value)
      }

      const updatedAgent = agentRepository.assignActiveRevision(scope, {
        activeRevisionId: revision.value.id,
        agentId: agent.id,
        updatedAt: timestamp,
      })

      if (!updatedAgent.ok) {
        return updatedAgent
      }

      return ok({
        agent: updatedAgent.value,
        created,
        markdown: sourceMarkdown,
        revision: revision.value,
        subagentLinks,
      })
    }),
})
