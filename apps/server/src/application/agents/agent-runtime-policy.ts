import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../adapters/mcp/normalize-tool'
import type { ToolSpec } from '../../application/tooling/tool-registry'
import type { RepositoryDatabase } from '../../db/repository-database'
import type { AgentRevisionRecord } from '../../domain/agents/agent-revision-repository'
import type { AiProviderName } from '../../domain/ai/types'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { ToolProfileId } from '../../shared/ids'
import type { TenantScope } from '../../shared/scope'
import {
  createAgentRevisionRepository,
  createMcpToolAssignmentRepository,
} from '../persistence/repositories'
import { parseSandboxPolicyJson } from '../sandbox/sandbox-policy'

export interface AgentRuntimeSettings {
  toolProfileId: ToolProfileId | null
  resolvedConfigSnapshot: {
    model: string | null
    modelAlias: string | null
    provider: AiProviderName | null
    reasoning: Record<string, unknown> | null
  }
}

export type AgentMcpMode = 'direct' | 'code'

const isModelProvider = (value: unknown): value is AiProviderName =>
  value === 'openai' || value === 'google' || value === 'openrouter'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const getOptionalString = (value: Record<string, unknown>, key: string): string | null =>
  typeof value[key] === 'string' && value[key]!.trim().length > 0 ? (value[key] as string) : null

const getToolPolicy = (
  revision: Pick<AgentRevisionRecord, 'toolPolicyJson'>,
): Record<string, unknown> =>
  isPlainObject(revision.toolPolicyJson) ? revision.toolPolicyJson : {}

export const getConfiguredMcpMode = (
  revision: Pick<AgentRevisionRecord, 'toolPolicyJson'>,
): AgentMcpMode => (getToolPolicy(revision).mcpMode === 'code' ? 'code' : 'direct')

export const getGrantedToolProfileId = (
  revision: Pick<AgentRevisionRecord, 'toolProfileId'>,
): ToolProfileId | null => revision.toolProfileId

export const resolveRuntimeSettingsFromAgentRevision = (
  revision: Pick<AgentRevisionRecord, 'modelConfigJson' | 'toolProfileId'>,
  fallbackToolProfileId: ToolProfileId | null,
  overrides?: {
    model?: string | null
    modelAlias?: string | null
    provider?: AiProviderName | null
    reasoning?: Record<string, unknown> | null
  },
): AgentRuntimeSettings => {
  const modelConfig = isPlainObject(revision.modelConfigJson) ? revision.modelConfigJson : {}
  const toolProfileId = getGrantedToolProfileId(revision) ?? fallbackToolProfileId

  return {
    toolProfileId,
    resolvedConfigSnapshot: {
      model: overrides?.model ?? null,
      modelAlias: overrides?.modelAlias ?? getOptionalString(modelConfig, 'modelAlias'),
      provider:
        overrides?.provider ??
        (isModelProvider(modelConfig.provider) ? modelConfig.provider : null),
      reasoning:
        overrides?.reasoning ??
        (isPlainObject(modelConfig.reasoning) ? modelConfig.reasoning : null),
    },
  }
}

export const hasNativeToolGrant = (
  revision: Pick<AgentRevisionRecord, 'toolPolicyJson'>,
  toolName: string,
): boolean => {
  const toolPolicy = getToolPolicy(revision)
  const nativeTools = Array.isArray(toolPolicy.native)
    ? toolPolicy.native.filter((value): value is string => typeof value === 'string')
    : []

  if (toolName === 'suspend_run') {
    return nativeTools.includes('suspend_run') || nativeTools.includes('block_run')
  }

  if (toolName === 'resume_delegated_run') {
    return nativeTools.includes('resume_delegated_run') || nativeTools.includes('delegate_to_agent')
  }

  if (toolName === 'get_tools') {
    return nativeTools.includes('get_tools') || nativeTools.includes('get_tool')
  }

  return nativeTools.includes(toolName)
}

export const getGrantedMcpProfile = (
  revision: Pick<AgentRevisionRecord, 'toolProfileId'>,
): string | null => getGrantedToolProfileId(revision)

export const resolveMcpModeForRun = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'agentRevisionId'>,
): AgentMcpMode => {
  if (!run.agentRevisionId) {
    return 'direct'
  }

  const revision = createAgentRevisionRepository(db).getById(scope, run.agentRevisionId)

  if (!revision.ok) {
    return 'direct'
  }

  const sandboxPolicy = parseSandboxPolicyJson(revision.value.sandboxPolicyJson)

  if (!sandboxPolicy.ok || !sandboxPolicy.value.enabled) {
    return 'direct'
  }

  return getConfiguredMcpMode(revision.value) === 'code' &&
    hasNativeToolGrant(revision.value, 'execute')
    ? 'code'
    : 'direct'
}

const hasMcpToolGrant = (
  db: RepositoryDatabase,
  scope: TenantScope,
  toolProfileId: ToolProfileId | null,
  toolName: string,
): boolean =>
  toolProfileId !== null &&
  createMcpToolAssignmentRepository(db).getByAnyRuntimeName(
    scope,
    toolProfileId,
    getMcpRuntimeNameAliasesFromRuntimeName(toolName),
  ).ok

export const isNativeToolAllowedForRun = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'agentRevisionId'>,
  toolName: string,
): boolean => {
  if (!run.agentRevisionId) {
    return false
  }

  const revision = createAgentRevisionRepository(db).getById(scope, run.agentRevisionId)

  return revision.ok && hasNativeToolGrant(revision.value, toolName)
}

export const isToolAllowedForRun = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'agentRevisionId' | 'toolProfileId'>,
  tool: Pick<ToolSpec, 'domain' | 'name'>,
): boolean => {
  if (!run.agentRevisionId) {
    switch (tool.domain) {
      case 'native':
        return false
      case 'mcp':
        return hasMcpToolGrant(db, scope, run.toolProfileId, tool.name)
      case 'provider':
      case 'system':
        return false
    }
  }

  const revision = createAgentRevisionRepository(db).getById(scope, run.agentRevisionId)

  if (!revision.ok) {
    return false
  }

  switch (tool.domain) {
    case 'native':
      return hasNativeToolGrant(revision.value, tool.name)
    case 'mcp': {
      const grantedProfile = getGrantedToolProfileId(revision.value)

      return (
        grantedProfile !== null &&
        run.toolProfileId === grantedProfile &&
        hasMcpToolGrant(db, scope, grantedProfile, tool.name)
      )
    }
    case 'provider':
    case 'system':
      return false
  }
}
