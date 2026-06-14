import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../adapters/mcp/normalize-tool'
import type { AgentRevisionRecord } from '../../domain/agents/agent-revision-repository'
import type { RepositoryDatabase } from '../../domain/database-port'
import { createMcpToolAssignmentRepository } from '../../domain/mcp/mcp-tool-assignment-repository'
import {
  createMcpToolCacheRepository,
  type McpToolCacheRecord,
} from '../../domain/mcp/mcp-tool-cache-repository'
import type { ToolRegistry } from '../../domain/tooling/tool-registry'
import type { DomainError } from '../../shared/errors'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { parseStoredAgentFrontmatter } from './agent-markdown'
import { getGrantedToolProfileId } from './agent-runtime-policy'

export interface AgentCapabilitySummary {
  description: string | null
  kind: 'mcp' | 'native' | 'provider'
  name: string
  title: string | null
}

const providerNativeToolDescriptions: Record<string, string> = {
  web_search: 'Search the web for public information.',
}
const capabilityKindOrder: Record<AgentCapabilitySummary['kind'], number> = {
  native: 0,
  provider: 1,
  mcp: 2,
}

const normalizeText = (value: string, maxLength = 220): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

const toOptionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const getNativeToolNames = (revision: Pick<AgentRevisionRecord, 'toolPolicyJson'>): string[] => {
  const rawNativeTools = Array.isArray(revision.toolPolicyJson.native)
    ? revision.toolPolicyJson.native
    : []

  return Array.from(
    new Set(
      rawNativeTools
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

export const getAgentDescription = (
  revision: Pick<AgentRevisionRecord, 'frontmatterJson'>,
): Result<string | null, DomainError> => {
  const parsedFrontmatter = parseStoredAgentFrontmatter(revision.frontmatterJson)

  if (!parsedFrontmatter.ok) {
    return parsedFrontmatter
  }

  return ok(parsedFrontmatter.value.description ?? null)
}

export const listAgentCapabilities = (input: {
  db: RepositoryDatabase
  revision: Pick<AgentRevisionRecord, 'toolPolicyJson' | 'toolProfileId'>
  scope: TenantScope
  toolRegistry: Pick<ToolRegistry, 'get'>
}): Result<AgentCapabilitySummary[], DomainError> => {
  const capabilities: AgentCapabilitySummary[] = getNativeToolNames(input.revision).map((name) => {
    const description =
      providerNativeToolDescriptions[name] ?? input.toolRegistry.get(name)?.description ?? null

    return {
      description: description ? normalizeText(description) : null,
      kind: name in providerNativeToolDescriptions ? 'provider' : 'native',
      name,
      title: null,
    }
  })

  const toolProfileId = getGrantedToolProfileId(input.revision)

  if (!toolProfileId) {
    return ok(capabilities)
  }

  const assignmentRepository = createMcpToolAssignmentRepository(input.db)
  const cacheRepository = createMcpToolCacheRepository(input.db)
  const assignments = assignmentRepository.listByProfile(input.scope, toolProfileId)

  if (!assignments.ok) {
    return assignments
  }

  if (assignments.value.length === 0) {
    return ok(capabilities)
  }

  const cachedTools: McpToolCacheRecord[] = []

  for (const serverId of new Set(assignments.value.map((assignment) => assignment.serverId))) {
    const serverTools = cacheRepository.listByServerId(input.scope, serverId)

    if (!serverTools.ok) {
      return serverTools
    }

    cachedTools.push(...serverTools.value)
  }

  for (const assignment of assignments.value) {
    const cachedTool =
      cachedTools.find(
        (candidate) =>
          candidate.serverId === assignment.serverId &&
          getMcpRuntimeNameAliasesFromRuntimeName(candidate.runtimeName).includes(
            assignment.runtimeName,
          ),
      ) ?? null

    if (!cachedTool?.modelVisible) {
      continue
    }

    const resolvedName = cachedTool.runtimeName

    if (
      capabilities.some(
        (capability) => capability.kind === 'mcp' && capability.name === resolvedName,
      )
    ) {
      continue
    }

    capabilities.push({
      description: cachedTool?.description ? normalizeText(cachedTool.description) : null,
      kind: 'mcp',
      name: resolvedName,
      title: toOptionalText(cachedTool?.title),
    })
  }

  capabilities.sort((left, right) => {
    const leftRank = capabilityKindOrder[left.kind]
    const rightRank = capabilityKindOrder[right.kind]

    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }

    return left.name.localeCompare(right.name)
  })

  return ok(capabilities)
}
