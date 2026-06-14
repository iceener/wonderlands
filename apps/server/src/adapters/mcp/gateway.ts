import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  type CallToolResult,
  CallToolResultSchema,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  ListResourceTemplatesResultSchema,
  type LoggingLevel,
  LoggingMessageNotificationSchema,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import { context as otelContext, type SpanContext, TraceFlags, trace } from '@opentelemetry/api'
import type { AppDatabase } from '../../db/client'
import { createWorkspaceRepository } from '../../domain/agents/workspace-repository'
import { createMcpOauthCredentialRepository } from '../../domain/mcp/mcp-oauth-credential-repository'
import {
  createMcpServerRepository,
  type McpServerRecord,
  toMcpServerConfig,
} from '../../domain/mcp/mcp-server-repository'
import { createMcpToolAssignmentRepository } from '../../domain/mcp/mcp-tool-assignment-repository'
import { createMcpToolCacheRepository } from '../../domain/mcp/mcp-tool-cache-repository'
import type { ToolContext, ToolRegistry, ToolSpec } from '../../domain/tooling/tool-registry'
import type { DomainError } from '../../shared/errors'
import type { AppLogger } from '../../shared/logger'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import {
  toLangfuseObservationId,
  toLangfuseTraceId,
} from '../observability/langfuse/trace-identity'
import { createMcpClientBundle } from './client-factory'
import { toMcpDomainError } from './errors'
import { normalizeMcpCallToolResult } from './normalize-result'
import { getMcpRuntimeNameAliasesFromRuntimeName, normalizeMcpTool } from './normalize-tool'
import {
  isAuthorizationCodeServer,
  toAuthorizationCodeServerConfig,
} from './oauth-authorization-code'
import { createStoredMcpOAuthProvider } from './oauth-provider'
import { revealStoredOauthTokens } from './stored-oauth'
import type {
  McpDiscoveredTool,
  McpGateway,
  McpServerConfig,
  McpServerSnapshot,
  McpServerStatus,
  McpStdioServerConfig,
} from './types'

interface InFlightCorrelation {
  runId: string
  tenantId: string
  toolCallId: string
}

interface ServerRegistration {
  accountId: string | null
  config: McpServerConfig
  source: 'db' | 'static'
  tenantId: string | null
}

interface ConnectedServerState {
  client: ReturnType<typeof createMcpClientBundle>['client'] | null
  connectionKey: string
  discoveredToolCount: number
  inFlight: Map<string, InFlightCorrelation>
  lastError: string | null
  registeredToolCount: number
  registration: ServerRegistration
  scope: TenantScope | null
  status: McpServerStatus
  transport: StdioClientTransport | StreamableHTTPClientTransport | null
}

const WORKSPACE_SCOPED_FILES_REMOTE_NAMES = new Set([
  'fs_manage',
  'fs_read',
  'fs_search',
  'fs_write',
])

const WORKSPACE_SCOPED_TOOL_PATH_KEYS: Record<string, Set<string>> = {
  fs_manage: new Set(['path', 'target']),
  fs_read: new Set(['path']),
  fs_search: new Set(['path']),
  fs_write: new Set(['path']),
}
const WORKSPACE_SCOPED_OUTPUT_PATH_KEYS = new Set(['path', 'target'])
const PATH_TEXT_KEYS = new Set(['diff', 'hint', 'message', 'recoveryHint'])
const WORKSPACE_SCOPED_VIRTUAL_ROOT = 'vault'

const mapLogLevel = (level: LoggingLevel): 'debug' | 'error' | 'info' | 'warn' => {
  switch (level) {
    case 'alert':
    case 'critical':
    case 'emergency':
    case 'error':
      return 'error'
    case 'warning':
      return 'warn'
    case 'debug':
      return 'debug'
    case 'info':
    case 'notice':
      return 'info'
  }
}

const summarizeError = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown MCP failure'

const looksLikeOAuthChallenge = (message: string): boolean => /unauthorized|401/i.test(message)

const toMcpTraceObservationKey = (context: ToolContext): string =>
  context.toolCallId ? `tool:${context.toolCallId}` : `run:${context.run.id}`

const toW3cTraceparent = (
  spanContext: Pick<SpanContext, 'spanId' | 'traceFlags' | 'traceId'>,
): string =>
  `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags
    .toString(16)
    .padStart(2, '0')}`

const buildMcpTraceMeta = (context: ToolContext): Record<string, string> => {
  const activeContext = otelContext.active()
  const activeSpanContext = trace.getSpan(activeContext)?.spanContext()
  const traceId = toLangfuseTraceId(context.run.rootRunId)
  const spanContext: SpanContext = {
    ...(activeSpanContext?.traceId === traceId && activeSpanContext.traceState
      ? { traceState: activeSpanContext.traceState }
      : {}),
    spanId: toLangfuseObservationId(toMcpTraceObservationKey(context)),
    traceFlags: TraceFlags.SAMPLED,
    traceId,
  }

  return {
    ...(spanContext.traceState ? { tracestate: spanContext.traceState.serialize() } : {}),
    traceparent: toW3cTraceparent(spanContext),
  }
}

const isStaticToolAllowedForTenant = (server: McpServerConfig, tenantId: string): boolean =>
  !server.allowedTenantIds || server.allowedTenantIds.length === 0
    ? true
    : server.allowedTenantIds.includes(tenantId)

const isServerAvailableForScope = (
  registration: ServerRegistration,
  tenantScope: TenantScope,
): boolean => {
  if (registration.source === 'db') {
    return (
      registration.tenantId === tenantScope.tenantId &&
      registration.accountId === tenantScope.accountId
    )
  }

  return isStaticToolAllowedForTenant(registration.config, tenantScope.tenantId)
}

const toSyntheticScope = (record: McpServerRecord): TenantScope => ({
  accountId: record.createdByAccountId,
  role: 'service',
  tenantId: record.tenantId,
})

const isToolAssignedToProfile = (
  db: AppDatabase,
  context: ToolContext,
  descriptor: McpDiscoveredTool,
): boolean => {
  if (!context.run.toolProfileId) {
    return false
  }

  return createMcpToolAssignmentRepository(db).getByAnyRuntimeName(
    context.tenantScope,
    context.run.toolProfileId,
    getMcpRuntimeNameAliasesFromRuntimeName(descriptor.runtimeName),
  ).ok
}

const getConfirmationTargetRef = (descriptor: McpDiscoveredTool): string =>
  `${descriptor.runtimeName}:${descriptor.fingerprint}`

const isWorkspaceScopedFilesServer = (
  state: ConnectedServerState,
  descriptor: McpDiscoveredTool,
): state is ConnectedServerState & {
  registration: {
    accountId: string | null
    config: McpStdioServerConfig
    source: 'db' | 'static'
    tenantId: string | null
  }
} =>
  state.registration.config.kind === 'stdio' &&
  Boolean(state.registration.config.workspaceScoped) &&
  WORKSPACE_SCOPED_FILES_REMOTE_NAMES.has(descriptor.remoteName)

const resolveWorkspaceScopedMountRoot = (config: McpStdioServerConfig): string | null => {
  const roots = (config.env?.FS_ROOTS ?? config.env?.FS_ROOT ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const firstRoot = roots[0]

  if (!firstRoot) {
    return null
  }

  return resolve(config.cwd ?? process.cwd(), firstRoot)
}

const resolveScopedFilesystemRoot = (
  db: AppDatabase,
  context: ToolContext,
  config: McpStdioServerConfig,
): Result<string, DomainError> => {
  if (config.workspaceScoped === 'run') {
    if (!context.run.workspaceRef) {
      return err({
        message: `run ${context.run.id} does not have a resolved workspaceRef`,
        type: 'conflict',
      })
    }

    return ok(resolve(context.run.workspaceRef))
  }

  if (context.run.workspaceId) {
    const workspace = createWorkspaceRepository(db).getById(
      context.tenantScope,
      context.run.workspaceId,
    )

    if (!workspace.ok) {
      return workspace
    }

    return ok(resolve(join(workspace.value.rootRef, 'vault')))
  }

  return err({
    message: `run ${context.run.id} does not have a resolved workspaceId`,
    type: 'conflict',
  })
}

const toScopedPrefix = (mountRoot: string, scopedRoot: string): Result<string, DomainError> => {
  const scopedPrefix = relative(mountRoot, scopedRoot).replace(/\\/g, '/')

  if (
    scopedPrefix.length === 0 ||
    scopedPrefix === '.' ||
    scopedPrefix.startsWith('../') ||
    scopedPrefix === '..' ||
    isAbsolute(scopedPrefix)
  ) {
    if (scopedPrefix.length === 0 || scopedPrefix === '.') {
      return ok('.')
    }

    return err({
      message: `workspace root ${scopedRoot} is outside mounted MCP root ${mountRoot}`,
      type: 'permission',
    })
  }

  return ok(scopedPrefix)
}

const normalizeWorkspaceScopedInputPath = (value: string): string => {
  const trimmed = value.trim()

  if (trimmed === '' || trimmed === '.' || trimmed === '/') {
    return '.'
  }

  const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')

  if (
    normalized === WORKSPACE_SCOPED_VIRTUAL_ROOT ||
    normalized === `${WORKSPACE_SCOPED_VIRTUAL_ROOT}/`
  ) {
    return '.'
  }

  return normalized.startsWith(`${WORKSPACE_SCOPED_VIRTUAL_ROOT}/`)
    ? normalized.slice(`${WORKSPACE_SCOPED_VIRTUAL_ROOT}/`.length)
    : normalized
}

const prefixScopedPath = (scopedPrefix: string, value: string): string => {
  const normalized = normalizeWorkspaceScopedInputPath(value)

  if (normalized === '.') {
    return scopedPrefix
  }

  return scopedPrefix === '.' ? normalized : `${scopedPrefix}/${normalized}`
}

const rewriteWorkspaceScopedArgs = (
  args: Record<string, unknown>,
  scopedPrefix: string,
  remoteName: string,
): Record<string, unknown> => {
  const nextArgs: Record<string, unknown> = {
    ...args,
  }

  const pathKeys = WORKSPACE_SCOPED_TOOL_PATH_KEYS[remoteName] ?? new Set(['path'])

  for (const key of pathKeys) {
    if (typeof nextArgs[key] === 'string') {
      nextArgs[key] = prefixScopedPath(scopedPrefix, nextArgs[key])
    }
  }

  return nextArgs
}

const stripScopedPath = (scopedPrefix: string, value: string): string => {
  const normalizedValue = value.replace(/\\/g, '/')

  if (scopedPrefix === '.') {
    return normalizedValue
  }

  if (normalizedValue === scopedPrefix) {
    return '.'
  }

  const prefix = `${scopedPrefix}/`

  return normalizedValue.startsWith(prefix) ? normalizedValue.slice(prefix.length) : normalizedValue
}

const stripScopedPathReferences = (scopedPrefix: string, value: string): string => {
  const normalizedValue = value.replace(/\\/g, '/')

  if (scopedPrefix === '.') {
    return normalizedValue
  }

  const prefix = `${scopedPrefix}/`

  return normalizedValue.split(prefix).join('')
}

const rewriteWorkspaceScopedJson = (value: unknown, scopedPrefix: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteWorkspaceScopedJson(entry, scopedPrefix))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  const rewritten: Record<string, unknown> = {}

  for (const [key, entryValue] of Object.entries(record)) {
    if (WORKSPACE_SCOPED_OUTPUT_PATH_KEYS.has(key) && typeof entryValue === 'string') {
      rewritten[key] = stripScopedPath(scopedPrefix, entryValue)
      continue
    }

    if (PATH_TEXT_KEYS.has(key) && typeof entryValue === 'string') {
      rewritten[key] = stripScopedPathReferences(scopedPrefix, entryValue)
      continue
    }

    rewritten[key] = rewriteWorkspaceScopedJson(entryValue, scopedPrefix)
  }

  return rewritten
}

const rewriteWorkspaceScopedOutput = (
  value: Awaited<ReturnType<typeof normalizeMcpCallToolResult>> extends Result<
    infer TOutput,
    DomainError
  >
    ? TOutput
    : never,
  scopedPrefix: string,
) => ({
  ...value,
  content: value.content.map((block) => {
    if (block.type !== 'text') {
      return block
    }

    try {
      const parsed = JSON.parse(block.text) as unknown
      return {
        ...block,
        text: JSON.stringify(rewriteWorkspaceScopedJson(parsed, scopedPrefix), null, 2),
      }
    } catch {
      return block
    }
  }),
  structuredContent: value.structuredContent
    ? (rewriteWorkspaceScopedJson(value.structuredContent, scopedPrefix) as Record<string, unknown>)
    : null,
})

const resolveWorkspaceScopedPrefix = (
  db: AppDatabase,
  context: ToolContext,
  descriptor: McpDiscoveredTool,
  state: ConnectedServerState,
): Result<string | null, DomainError> => {
  if (!isWorkspaceScopedFilesServer(state, descriptor)) {
    return ok(null)
  }

  const mountRoot = resolveWorkspaceScopedMountRoot(state.registration.config)

  if (!mountRoot) {
    return err({
      message: `workspace-scoped MCP server ${descriptor.serverId} is missing FS_ROOT(S)`,
      type: 'conflict',
    })
  }

  const scopedFilesystemRoot = resolveScopedFilesystemRoot(db, context, state.registration.config)

  if (!scopedFilesystemRoot.ok) {
    return scopedFilesystemRoot
  }

  return toScopedPrefix(mountRoot, scopedFilesystemRoot.value)
}

export const createMcpGateway = (input: {
  clientInfo: {
    name: string
    version: string
  }
  db: AppDatabase
  logger: AppLogger
  secretEncryptionKey: string | null
  servers: McpServerConfig[]
  toolRegistry: ToolRegistry
}): McpGateway => {
  const logger = input.logger.child({
    subsystem: 'mcp',
  })
  const registrations = new Map<string, ServerRegistration>()
  const serverStates = new Map<string, ConnectedServerState>()
  const serverToolNames = new Map<string, Set<string>>()
  const tools = new Map<string, McpDiscoveredTool>()
  let initializePromise: Promise<void> | null = null
  const oauthCredentialRepository = createMcpOauthCredentialRepository(input.db)

  const getStoredOauthCredential = (scope: TenantScope | null, serverId: string) => {
    if (!scope) {
      return null
    }

    const credential = oauthCredentialRepository.getByServerId(scope, serverId)
    return credential.ok ? credential.value : null
  }

  const getEffectiveRegistrationForScope = (
    registration: ServerRegistration,
    scope: TenantScope | null,
  ): ServerRegistration => {
    const server = registration.config

    if (!scope || server.kind !== 'streamable_http') {
      return registration
    }

    if (server.auth.kind !== 'none') {
      return registration
    }

    if (!getStoredOauthCredential(scope, server.id)) {
      return registration
    }

    return {
      ...registration,
      config: toAuthorizationCodeServerConfig(server),
    }
  }

  const getConnectionKeyForScope = (
    registration: ServerRegistration,
    scope: TenantScope | null,
  ): string | null => {
    const effectiveRegistration = getEffectiveRegistrationForScope(registration, scope)

    if (!isAuthorizationCodeServer(effectiveRegistration.config)) {
      return effectiveRegistration.config.id
    }

    if (!scope) {
      return null
    }

    return `${effectiveRegistration.config.id}:${scope.tenantId}:${scope.accountId}`
  }

  const getReadyConnectionState = (
    serverId: string,
    tenantScope: TenantScope,
  ): ConnectedServerState | null => {
    const registration = registrations.get(serverId)

    if (!registration || !isServerAvailableForScope(registration, tenantScope)) {
      return null
    }

    const connectionKey = getConnectionKeyForScope(registration, tenantScope)

    if (!connectionKey) {
      return null
    }

    const state = serverStates.get(connectionKey)
    return state?.status === 'ready' ? state : null
  }

  const resolveReadyServerState = (
    serverId: string,
    tenantScope: TenantScope,
  ): Result<
    ConnectedServerState & {
      client: NonNullable<ConnectedServerState['client']>
    },
    DomainError
  > => {
    const state = getReadyConnectionState(serverId, tenantScope)

    if (!state?.client) {
      return err({
        message: `MCP server ${serverId} is not authorized or available for this account`,
        provider: `mcp:${serverId}`,
        type: 'provider',
      })
    }

    if (state.status !== 'ready') {
      return err({
        message: `MCP server ${serverId} is not ready`,
        provider: `mcp:${serverId}`,
        type: 'provider',
      })
    }

    if (!isServerAvailableForScope(state.registration, tenantScope)) {
      return err({
        message: `MCP server ${serverId} is not available for this account`,
        type: 'permission',
      })
    }

    return ok(
      state as ConnectedServerState & {
        client: NonNullable<ConnectedServerState['client']>
      },
    )
  }

  const getSnapshotFromState = (state: ConnectedServerState): McpServerSnapshot => ({
    discoveredToolCount: state.discoveredToolCount,
    id: state.registration.config.id,
    kind: state.registration.config.kind,
    lastError: state.lastError,
    registeredToolCount: state.registeredToolCount,
    status: state.status,
  })

  const getDescriptorByRuntimeName = (runtimeName: string): McpDiscoveredTool | null => {
    for (const alias of getMcpRuntimeNameAliasesFromRuntimeName(runtimeName)) {
      const descriptor = tools.get(alias)

      if (descriptor) {
        return descriptor
      }
    }

    return null
  }

  const getRegisteredToolCount = (serverId: string): number =>
    [...tools.values()].filter((descriptor) => descriptor.serverId === serverId).length

  const getServerSnapshotForScope = (
    scope: TenantScope | null,
    serverId: string,
  ): McpServerSnapshot | null => {
    const registration = registrations.get(serverId)

    if (!registration) {
      return null
    }

    const effectiveRegistration = getEffectiveRegistrationForScope(registration, scope)
    const connectionKey = getConnectionKeyForScope(registration, scope)

    if (connectionKey) {
      const state = serverStates.get(connectionKey)

      if (state) {
        return getSnapshotFromState(state)
      }
    }

    if (!scope) {
      const scopedState = [...serverStates.values()].find(
        (state) => state.registration.config.id === serverId,
      )

      if (scopedState) {
        return getSnapshotFromState(scopedState)
      }
    }

    if (isAuthorizationCodeServer(effectiveRegistration.config)) {
      if (!scope) {
        if (!isAuthorizationCodeServer(registration.config)) {
          return null
        }

        return {
          discoveredToolCount: serverToolNames.get(serverId)?.size ?? 0,
          id: serverId,
          kind: effectiveRegistration.config.kind,
          lastError: `MCP OAuth authorization is required for ${serverId}`,
          registeredToolCount: getRegisteredToolCount(serverId),
          status: 'authorization_required',
        }
      }

      if (!isServerAvailableForScope(registration, scope)) {
        return null
      }

      const tokens = revealStoredOauthTokens(
        getStoredOauthCredential(scope, serverId)?.tokensJson,
        input.secretEncryptionKey,
      )

      return {
        discoveredToolCount: serverToolNames.get(serverId)?.size ?? 0,
        id: serverId,
        kind: effectiveRegistration.config.kind,
        lastError: tokens
          ? `MCP OAuth credentials exist for ${serverId}, but no active connection is ready`
          : `MCP OAuth authorization is required for ${serverId}`,
        registeredToolCount: getRegisteredToolCount(serverId),
        status: tokens ? 'degraded' : 'authorization_required',
      }
    }

    return null
  }

  const logProtocolMessage = (
    state: ConnectedServerState,
    level: LoggingLevel,
    payload: unknown,
  ) => {
    const correlation = state.inFlight.size === 1 ? [...state.inFlight.values()][0] : null

    logger.log(mapLogLevel(level), 'MCP protocol log', {
      data: payload,
      logger: 'protocol',
      runId: correlation?.runId ?? null,
      serverId: state.registration.config.id,
      source: 'protocol',
      tenantId: correlation?.tenantId ?? null,
      toolCallId: correlation?.toolCallId ?? null,
      transport: state.registration.config.kind,
    })
  }

  const attachTransportLogging = (state: ConnectedServerState) => {
    if (state.client) {
      state.client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
        logProtocolMessage(state, notification.params.level, {
          data: notification.params.data,
          logger: notification.params.logger ?? null,
        })
      })
    }

    if (state.transport instanceof StdioClientTransport && state.transport.stderr) {
      state.transport.stderr.on('data', (chunk) => {
        const correlation = state.inFlight.size === 1 ? [...state.inFlight.values()][0] : null

        logger.warn('MCP stderr output', {
          data: String(chunk).trimEnd(),
          logger: 'stderr',
          runId: correlation?.runId ?? null,
          serverId: state.registration.config.id,
          source: 'stderr',
          tenantId: correlation?.tenantId ?? null,
          toolCallId: correlation?.toolCallId ?? null,
          transport: state.registration.config.kind,
        })
      })
    }
  }

  const unregisterServerTools = (serverId: string) => {
    const runtimeNames = serverToolNames.get(serverId)

    if (!runtimeNames) {
      return
    }

    for (const runtimeName of runtimeNames) {
      tools.delete(runtimeName)
      input.toolRegistry.unregister(runtimeName)
    }

    serverToolNames.delete(serverId)

    for (const state of serverStates.values()) {
      if (state.registration.config.id !== serverId) {
        continue
      }

      state.registeredToolCount = 0
      state.discoveredToolCount = 0
    }
  }

  const closeServerResources = async (state: ConnectedServerState) => {
    try {
      if (state.transport instanceof StreamableHTTPClientTransport && state.transport.sessionId) {
        await state.transport.terminateSession()
      }
    } catch (error) {
      logger.warn('Failed to terminate MCP HTTP session cleanly', {
        error: summarizeError(error),
        serverId: state.registration.config.id,
      })
    }

    try {
      await state.client?.close()
    } catch (error) {
      logger.warn('Failed to close MCP client cleanly', {
        error: summarizeError(error),
        serverId: state.registration.config.id,
      })
    }
  }

  const buildToolSpec = (state: ConnectedServerState, descriptor: McpDiscoveredTool): ToolSpec => ({
    attachmentRefResolutionPolicy: isWorkspaceScopedFilesServer(state, descriptor)
      ? 'path_only'
      : 'none',
    attachmentRefTargetKeys: isWorkspaceScopedFilesServer(state, descriptor)
      ? [...(WORKSPACE_SCOPED_TOOL_PATH_KEYS[descriptor.remoteName] ?? new Set(['path']))]
      : undefined,
    description: descriptor.description,
    domain: 'mcp',
    execute: async (context, args) => {
      if (!isServerAvailableForScope(state.registration, context.tenantScope)) {
        return err({
          message: `MCP tool ${descriptor.runtimeName} is not available for this account`,
          type: 'permission',
        })
      }

      if (!isToolAssignedToProfile(context.db, context, descriptor)) {
        return err({
          message: `MCP tool ${descriptor.runtimeName} is not assigned to tool profile ${context.run.toolProfileId ?? 'none'}`,
          type: 'permission',
        })
      }

      if (state.registration.source === 'db') {
        const assignment = createMcpToolAssignmentRepository(context.db).getByAnyRuntimeName(
          context.tenantScope,
          context.run.toolProfileId ?? '',
          getMcpRuntimeNameAliasesFromRuntimeName(descriptor.runtimeName),
        )

        if (!assignment.ok) {
          return err({
            message: `MCP tool ${descriptor.runtimeName} is not assigned to tool profile ${context.run.toolProfileId ?? 'none'}`,
            type: 'permission',
          })
        }

        if (
          !getMcpRuntimeNameAliasesFromRuntimeName(descriptor.runtimeName).some((runtimeName) =>
            (context.mcpCodeModeApprovedRuntimeNames ?? []).includes(runtimeName),
          ) &&
          assignment.value.requiresConfirmation &&
          assignment.value.approvedFingerprint !== descriptor.fingerprint
        ) {
          return ok({
            kind: 'waiting',
            wait: {
              description: `Confirmation required before running ${descriptor.runtimeName}`,
              targetKind: 'human_response',
              targetRef: getConfirmationTargetRef(descriptor),
              type: 'human',
            },
          })
        }
      }

      const result = await gateway.callTool({
        args,
        context,
        runtimeName: descriptor.runtimeName,
      })

      if (!result.ok) {
        return result
      }

      return ok({
        kind: 'immediate',
        output: result.value,
      })
    },
    inputSchema: descriptor.inputSchema,
    isAvailable: (context) =>
      Boolean(getReadyConnectionState(descriptor.serverId, context.tenantScope)) &&
      isServerAvailableForScope(state.registration, context.tenantScope) &&
      isToolAssignedToProfile(context.db, context, descriptor),
    name: descriptor.runtimeName,
    strict: false,
  })

  const registerDiscoveredTool = (state: ConnectedServerState, descriptor: McpDiscoveredTool) => {
    tools.set(descriptor.runtimeName, descriptor)
    const toolNames = serverToolNames.get(descriptor.serverId) ?? new Set<string>()
    toolNames.add(descriptor.runtimeName)
    serverToolNames.set(descriptor.serverId, toolNames)

    if (!descriptor.modelVisible) {
      descriptor.registrationSkippedReason = 'app_only'
      logger.info('Skipping MCP app-only tool registration', {
        remoteName: descriptor.remoteName,
        runtimeName: descriptor.runtimeName,
        serverId: state.registration.config.id,
      })
      return
    }

    if (descriptor.execution?.taskSupport === 'required') {
      descriptor.registrationSkippedReason = 'task_required'
      logger.info('Skipping MCP task-required tool registration', {
        remoteName: descriptor.remoteName,
        runtimeName: descriptor.runtimeName,
        serverId: state.registration.config.id,
      })
      return
    }

    if (input.toolRegistry.get(descriptor.runtimeName)) {
      descriptor.registrationSkippedReason = 'duplicate_runtime_name'
      logger.warn('Skipping duplicate MCP runtime tool name', {
        runtimeName: descriptor.runtimeName,
        serverId: state.registration.config.id,
      })
      return
    }

    input.toolRegistry.register(buildToolSpec(state, descriptor))
    state.registeredToolCount += 1
  }

  const persistDiscoveredTool = (
    record: McpServerRecord,
    descriptor: McpDiscoveredTool,
    discoveredAt: string,
  ) => {
    const toolCacheRepository = createMcpToolCacheRepository(input.db)
    const persisted = toolCacheRepository.upsertForTenant(record.tenantId, {
      appsMetaJson: descriptor.apps,
      description: descriptor.description ?? null,
      executionJson:
        descriptor.execution && typeof descriptor.execution === 'object'
          ? (JSON.parse(JSON.stringify(descriptor.execution)) as Record<string, unknown>)
          : null,
      fingerprint: descriptor.fingerprint,
      id: `mct_${randomUUID().replace(/-/g, '')}`,
      inputSchemaJson: descriptor.inputSchema,
      isActive: true,
      modelVisible: descriptor.modelVisible,
      outputSchemaJson: descriptor.outputSchema,
      remoteName: descriptor.remoteName,
      runtimeName: descriptor.runtimeName,
      serverId: record.id,
      title: descriptor.title,
      updatedAt: discoveredAt,
    })

    if (!persisted.ok) {
      logger.warn('Failed to persist discovered MCP tool', {
        error: persisted.error.message,
        remoteName: descriptor.remoteName,
        serverId: record.id,
      })
    }
  }

  const discoverTools = async (
    state: ConnectedServerState,
    persistedRecord: McpServerRecord | null,
  ): Promise<void> => {
    if (!state.client) {
      return
    }

    let cursor: string | undefined
    let discoveredCount = 0
    const discoveredAt = new Date().toISOString()

    if (persistedRecord) {
      const markInactive = createMcpToolCacheRepository(input.db).markInactiveByServerId(
        persistedRecord.tenantId,
        persistedRecord.id,
        discoveredAt,
      )

      if (!markInactive.ok) {
        logger.warn('Failed to mark cached MCP tools inactive before rediscovery', {
          error: markInactive.error.message,
          serverId: persistedRecord.id,
        })
      }
    }

    do {
      const listed = await state.client.listTools(cursor ? { cursor } : undefined)

      for (const remoteTool of listed.tools) {
        const descriptor = normalizeMcpTool(state.registration.config, remoteTool)
        registerDiscoveredTool(state, descriptor)

        if (persistedRecord) {
          persistDiscoveredTool(persistedRecord, descriptor, discoveredAt)
        }

        discoveredCount += 1
      }

      cursor = listed.nextCursor
    } while (cursor)

    state.discoveredToolCount = discoveredCount
  }

  const updatePersistedServerDiscovery = (
    record: McpServerRecord | null,
    inputValue: {
      lastDiscoveredAt?: string | null
      lastError?: string | null
      updatedAt: string
    },
  ) => {
    if (!record) {
      return
    }

    const updateResult = createMcpServerRepository(input.db).updateDiscovery(
      toSyntheticScope(record),
      {
        id: record.id,
        lastDiscoveredAt: inputValue.lastDiscoveredAt ?? null,
        lastError: inputValue.lastError ?? null,
        updatedAt: inputValue.updatedAt,
      },
    )

    if (!updateResult.ok) {
      logger.warn('Failed to persist MCP server discovery state', {
        error: updateResult.error.message,
        serverId: record.id,
      })
    }
  }

  const buildOAuthProvider = (registration: ServerRegistration, scope: TenantScope | null) =>
    isAuthorizationCodeServer(registration.config) && scope
      ? createStoredMcpOAuthProvider({
          auth: registration.config.auth,
          db: input.db,
          encryptionKey: input.secretEncryptionKey,
          nowIso: () => new Date().toISOString(),
          redirectUrl: 'http://localhost/mcp/oauth/callback',
          scope,
          serverId: registration.config.id,
        })
      : undefined

  const initializeServer = async (
    registration: ServerRegistration,
    persistedRecord: McpServerRecord | null = null,
    scope: TenantScope | null = null,
  ): Promise<void> => {
    registrations.set(registration.config.id, registration)
    const effectiveRegistration = getEffectiveRegistrationForScope(registration, scope)
    const connectionKey = getConnectionKeyForScope(registration, scope)

    if (!connectionKey) {
      return
    }

    const existingState = serverStates.get(connectionKey)

    if (existingState) {
      unregisterServerTools(registration.config.id)
      await closeServerResources(existingState)
      serverStates.delete(connectionKey)
    }

    const state: ConnectedServerState = {
      client: null,
      connectionKey,
      discoveredToolCount: 0,
      inFlight: new Map(),
      lastError: null,
      registeredToolCount: 0,
      registration: effectiveRegistration,
      scope,
      status: 'connecting',
      transport: null,
    }

    serverStates.set(connectionKey, state)

    try {
      const authProvider = buildOAuthProvider(effectiveRegistration, scope)

      if (isAuthorizationCodeServer(effectiveRegistration.config)) {
        const tokens = await authProvider?.tokens()

        if (!tokens?.access_token) {
          state.status = 'authorization_required'
          state.lastError = `MCP OAuth authorization is required for ${effectiveRegistration.config.id}`
          return
        }
      }

      const bundle = createMcpClientBundle(
        effectiveRegistration.config,
        input.clientInfo,
        authProvider ? { authProvider } : undefined,
      )
      state.client = bundle.client
      state.transport = bundle.transport

      attachTransportLogging(state)

      await bundle.client.connect(bundle.transport)

      if (bundle.client.getServerCapabilities()?.logging && registration.config.logLevel) {
        try {
          await bundle.client.setLoggingLevel(registration.config.logLevel)
        } catch (error) {
          logger.warn('Failed to set MCP log level', {
            error: summarizeError(error),
            serverId: registration.config.id,
          })
        }
      }

      await discoverTools(state, persistedRecord)
      state.status = 'ready'
      state.lastError = null

      updatePersistedServerDiscovery(persistedRecord, {
        lastDiscoveredAt: new Date().toISOString(),
        lastError: null,
        updatedAt: new Date().toISOString(),
      })

      logger.info('Initialized MCP server', {
        discoveredToolCount: state.discoveredToolCount,
        kind: effectiveRegistration.config.kind,
        registeredToolCount: state.registeredToolCount,
        serverId: effectiveRegistration.config.id,
        source: effectiveRegistration.source,
      })
    } catch (error) {
      state.lastError = summarizeError(error)

      if (
        effectiveRegistration.config.kind === 'streamable_http' &&
        effectiveRegistration.config.auth.kind === 'none' &&
        looksLikeOAuthChallenge(state.lastError)
      ) {
        state.lastError = `MCP OAuth authorization is required for ${effectiveRegistration.config.id}`
        state.status = 'authorization_required'
      } else {
        state.status = 'degraded'
      }

      updatePersistedServerDiscovery(persistedRecord, {
        lastError: state.lastError,
        updatedAt: new Date().toISOString(),
      })

      logger.error('Failed to initialize MCP server', {
        error: state.lastError,
        kind: effectiveRegistration.config.kind,
        serverId: effectiveRegistration.config.id,
        source: effectiveRegistration.source,
      })
    }
  }

  const findStaticRegistration = (
    scope: TenantScope,
    serverId: string,
  ): ServerRegistration | null => {
    const server = input.servers.find(
      (entry) => entry.id === serverId && isStaticToolAllowedForTenant(entry, scope.tenantId),
    )

    return server
      ? {
          accountId: null,
          config: server,
          source: 'static',
          tenantId: null,
        }
      : null
  }

  const gateway: McpGateway = {
    callTool: async ({ args, context, runtimeName }): Promise<Result<unknown, DomainError>> => {
      const descriptor = getDescriptorByRuntimeName(runtimeName)

      if (!descriptor) {
        return err({
          message: `MCP tool ${runtimeName} is not registered`,
          type: 'not_found',
        })
      }

      const state = getReadyConnectionState(descriptor.serverId, context.tenantScope)

      if (!state?.client) {
        return err({
          message: `MCP server ${descriptor.serverId} is not authorized or available for this account`,
          provider: `mcp:${descriptor.serverId}`,
          type: 'provider',
        })
      }

      if (state.status !== 'ready') {
        return err({
          message: `MCP server ${descriptor.serverId} is not ready`,
          provider: `mcp:${descriptor.serverId}`,
          type: 'provider',
        })
      }

      if (!isServerAvailableForScope(state.registration, context.tenantScope)) {
        return err({
          message: `MCP tool ${runtimeName} is not available for this account`,
          type: 'permission',
        })
      }

      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return err({
          message: `MCP tool ${runtimeName} expects object arguments`,
          type: 'validation',
        })
      }

      const correlationKey = context.toolCallId ?? descriptor.runtimeName
      const baseArgs = Object.fromEntries(Object.entries(args))
      const scopedPrefix = resolveWorkspaceScopedPrefix(input.db, context, descriptor, state)

      if (!scopedPrefix.ok) {
        return scopedPrefix
      }

      const normalizedArgs =
        scopedPrefix.value === null
          ? baseArgs
          : rewriteWorkspaceScopedArgs(baseArgs, scopedPrefix.value, descriptor.remoteName)
      const traceMeta = buildMcpTraceMeta(context)

      state.inFlight.set(correlationKey, {
        runId: context.run.id,
        tenantId: context.tenantScope.tenantId,
        toolCallId: correlationKey,
      })

      try {
        const result = await state.client.callTool(
          {
            ...(Object.keys(traceMeta).length > 0 ? { _meta: traceMeta } : {}),
            arguments: normalizedArgs,
            name: descriptor.remoteName,
          },
          CallToolResultSchema,
        )

        if (!('content' in result)) {
          return err({
            message: `MCP tool ${runtimeName} returned an unsupported legacy result payload`,
            type: 'validation',
          })
        }

        const normalized = normalizeMcpCallToolResult(result as CallToolResult)

        if (!normalized.ok) {
          return normalized
        }

        if (scopedPrefix.value !== null) {
          return ok(rewriteWorkspaceScopedOutput(normalized.value, scopedPrefix.value))
        }

        return ok(normalized.value)
      } catch (error) {
        state.lastError = summarizeError(error)
        logger.error('MCP tool call failed', {
          error: state.lastError,
          remoteName: descriptor.remoteName,
          runId: context.run.id,
          serverId: descriptor.serverId,
          tenantId: context.tenantScope.tenantId,
          toolCallId: context.toolCallId,
        })
        return err(toMcpDomainError(descriptor.serverId, error))
      } finally {
        state.inFlight.delete(correlationKey)
      }
    },
    callServerTool: async ({
      args,
      name,
      serverId,
      tenantScope,
    }): Promise<Result<CallToolResult, DomainError>> => {
      const readyState = resolveReadyServerState(serverId, tenantScope)

      if (!readyState.ok) {
        return readyState
      }

      if (args != null && (typeof args !== 'object' || Array.isArray(args))) {
        return err({
          message: `MCP server tool ${name} expects object arguments`,
          type: 'validation',
        })
      }

      try {
        const result = await readyState.value.client.callTool(
          {
            arguments: args ?? {},
            name,
          },
          CallToolResultSchema,
        )

        if (!('content' in result)) {
          return err({
            message: `MCP server tool ${name} returned an unsupported legacy result payload`,
            type: 'validation',
          })
        }

        return ok(result as CallToolResult)
      } catch (error) {
        readyState.value.lastError = summarizeError(error)
        logger.error('MCP app tool proxy call failed', {
          error: readyState.value.lastError,
          remoteName: name,
          serverId,
          tenantId: tenantScope.tenantId,
        })
        return err(toMcpDomainError(serverId, error))
      }
    },
    close: async () => {
      await Promise.all([...serverStates.values()].map(closeServerResources))
    },
    listResourceTemplates: async ({
      cursor,
      serverId,
      tenantScope,
    }): Promise<Result<ListResourceTemplatesResult, DomainError>> => {
      const readyState = resolveReadyServerState(serverId, tenantScope)

      if (!readyState.ok) {
        return readyState
      }

      try {
        const result = await readyState.value.client.request(
          {
            method: 'resources/templates/list',
            ...(cursor ? { params: { cursor } } : {}),
          },
          ListResourceTemplatesResultSchema,
        )

        return ok(result)
      } catch (error) {
        readyState.value.lastError = summarizeError(error)
        logger.error('MCP listResourceTemplates failed', {
          cursor,
          error: readyState.value.lastError,
          serverId,
          tenantId: tenantScope.tenantId,
        })
        return err(toMcpDomainError(serverId, error))
      }
    },
    listResources: async ({
      cursor,
      serverId,
      tenantScope,
    }): Promise<Result<ListResourcesResult, DomainError>> => {
      const readyState = resolveReadyServerState(serverId, tenantScope)

      if (!readyState.ok) {
        return readyState
      }

      try {
        const result = await readyState.value.client.listResources(cursor ? { cursor } : undefined)
        return ok(result)
      } catch (error) {
        readyState.value.lastError = summarizeError(error)
        logger.error('MCP listResources failed', {
          cursor,
          error: readyState.value.lastError,
          serverId,
          tenantId: tenantScope.tenantId,
        })
        return err(toMcpDomainError(serverId, error))
      }
    },
    readRawResource: async ({
      serverId,
      tenantScope,
      uri,
    }): Promise<Result<ReadResourceResult, DomainError>> => {
      const readyState = resolveReadyServerState(serverId, tenantScope)

      if (!readyState.ok) {
        return readyState
      }

      try {
        const result = await readyState.value.client.readResource({ uri })
        return ok(result)
      } catch (error) {
        readyState.value.lastError = summarizeError(error)
        logger.error('MCP readResource failed', {
          error: readyState.value.lastError,
          serverId,
          tenantId: tenantScope.tenantId,
          uri,
        })
        return err(toMcpDomainError(serverId, error))
      }
    },
    readResource: async ({ serverId, tenantScope, uri }) => {
      const rawResult = await gateway.readRawResource({
        serverId,
        tenantScope,
        uri,
      })

      if (!rawResult.ok) {
        return rawResult
      }

      const first = rawResult.value.contents[0]

      if (!first || !('text' in first)) {
        return err({
          message: `MCP resource ${uri} returned no text content`,
          type: 'not_found',
        })
      }

      return ok({
        html: first.text,
        mimeType: first.mimeType ?? 'text/html',
      })
    },
    getServerSnapshot: (scope, serverId) => getServerSnapshotForScope(scope, serverId),
    getServerSnapshots: () =>
      [
        ...new Set([
          ...registrations.keys(),
          ...Array.from(serverStates.values(), (state) => state.registration.config.id),
        ]),
      ]
        .sort((left, right) => left.localeCompare(right))
        .flatMap((serverId) => {
          const snapshot = getServerSnapshotForScope(null, serverId)
          return snapshot ? [snapshot] : []
        }),
    getTool: (runtimeName) => getDescriptorByRuntimeName(runtimeName),
    initialize: async () => {
      if (!initializePromise) {
        initializePromise = (async () => {
          for (const server of input.servers) {
            if (!server.enabled) {
              continue
            }

            await initializeServer({
              accountId: null,
              config: server,
              source: 'static',
              tenantId: null,
            })
          }

          const storedServers = createMcpServerRepository(input.db).listEnabledForGateway()

          if (!storedServers.ok) {
            logger.error('Failed to load stored MCP servers for gateway initialization', {
              error: storedServers.error.message,
            })
            return
          }

          const storedCredentials = oauthCredentialRepository.listAll()

          if (!storedCredentials.ok) {
            logger.error('Failed to load stored MCP OAuth credentials for gateway initialization', {
              error: storedCredentials.error.message,
            })
          }

          const credentialByServerKey = new Map(
            (storedCredentials.ok ? storedCredentials.value : []).map((credential) => [
              `${credential.serverId}:${credential.tenantId}:${credential.accountId}`,
              credential,
            ]),
          )

          for (const record of storedServers.value) {
            const registration: ServerRegistration = {
              accountId: record.createdByAccountId,
              config: toMcpServerConfig(record, input.secretEncryptionKey),
              source: 'db',
              tenantId: record.tenantId,
            }
            const ownerScope = {
              accountId: record.createdByAccountId,
              role: 'owner' as const,
              tenantId: record.tenantId,
            }
            const effectiveRegistration = getEffectiveRegistrationForScope(registration, ownerScope)

            if (
              isAuthorizationCodeServer(effectiveRegistration.config) &&
              credentialByServerKey.has(
                `${record.id}:${record.tenantId}:${record.createdByAccountId}`,
              )
            ) {
              await initializeServer(registration, record, ownerScope)
              continue
            }

            await initializeServer(registration, record)
          }

          if (storedCredentials.ok) {
            for (const credential of storedCredentials.value) {
              if (
                storedServers.ok &&
                storedServers.value.some((record) => record.id === credential.serverId)
              ) {
                continue
              }

              const registration = findStaticRegistration(
                {
                  accountId: credential.accountId,
                  role: 'owner',
                  tenantId: credential.tenantId,
                },
                credential.serverId,
              )
              const scope = {
                accountId: credential.accountId,
                role: 'owner' as const,
                tenantId: credential.tenantId,
              }
              const effectiveRegistration = registration
                ? getEffectiveRegistrationForScope(registration, scope)
                : null

              if (
                !registration ||
                !effectiveRegistration ||
                !isAuthorizationCodeServer(effectiveRegistration.config)
              ) {
                continue
              }

              await initializeServer(registration, null, scope)
            }
          }
        })()
      }

      await initializePromise
    },
    listTools: () => [...tools.values()],
    removeRegisteredServer: async (scope, serverId) => {
      const matchingStates = [...serverStates.values()].filter(
        (state) => state.registration.config.id === serverId,
      )

      if (matchingStates.length === 0) {
        return ok({ id: serverId })
      }

      const state = matchingStates[0]

      if (
        !state ||
        state.registration.source !== 'db' ||
        state.registration.tenantId !== scope.tenantId ||
        state.registration.accountId !== scope.accountId
      ) {
        return err({
          message: `MCP server ${serverId} is not available for account ${scope.accountId}`,
          type: 'permission',
        })
      }

      unregisterServerTools(serverId)
      await Promise.all(
        matchingStates.map(async (entry) => {
          await closeServerResources(entry)
          serverStates.delete(entry.connectionKey)
        }),
      )
      registrations.delete(serverId)

      return ok({ id: serverId })
    },
    refreshServer: async (scope, serverId) => {
      const repository = createMcpServerRepository(input.db)
      const stored = repository.getById(scope, serverId)

      if (stored.ok) {
        const registration: ServerRegistration = {
          accountId: stored.value.createdByAccountId,
          config: toMcpServerConfig(stored.value, input.secretEncryptionKey),
          source: 'db',
          tenantId: stored.value.tenantId,
        }

        await initializeServer(
          registration,
          stored.value,
          isAuthorizationCodeServer(getEffectiveRegistrationForScope(registration, scope).config)
            ? scope
            : null,
        )

        const snapshot = getServerSnapshotForScope(scope, serverId)

        if (!snapshot) {
          return err({
            message: `MCP server ${serverId} did not produce a refresh snapshot`,
            type: 'conflict',
          })
        }

        return ok(snapshot)
      }

      const registration = findStaticRegistration(scope, serverId)

      if (!registration) {
        return stored
      }

      await initializeServer(
        registration,
        null,
        isAuthorizationCodeServer(getEffectiveRegistrationForScope(registration, scope).config)
          ? scope
          : null,
      )

      const snapshot = getServerSnapshotForScope(scope, serverId)

      if (!snapshot) {
        return err({
          message: `MCP server ${serverId} did not produce a refresh snapshot`,
          type: 'conflict',
        })
      }

      return ok(snapshot)
    },
  }

  return gateway
}
