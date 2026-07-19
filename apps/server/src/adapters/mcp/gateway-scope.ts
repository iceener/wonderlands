import { isAbsolute, join, relative, resolve } from 'node:path'
import type { AppDatabase } from '../../db/client'
import type { ToolContext } from '../../application/tooling/tool-registry'
import { createWorkspaceRepository } from '../persistence/sqlite/agents/workspace-repository'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { ConnectedServerState } from './gateway-state'
import type { McpDiscoveredTool, McpStdioServerConfig } from './types'

export const WORKSPACE_SCOPED_FILES_REMOTE_NAMES = new Set([
  'fs_manage',
  'fs_read',
  'fs_search',
  'fs_write',
])

export const WORKSPACE_SCOPED_TOOL_PATH_KEYS: Record<string, Set<string>> = {
  fs_manage: new Set(['path', 'target']),
  fs_read: new Set(['path']),
  fs_search: new Set(['path']),
  fs_write: new Set(['path']),
}
const WORKSPACE_SCOPED_OUTPUT_PATH_KEYS = new Set(['path', 'target'])
const PATH_TEXT_KEYS = new Set(['diff', 'hint', 'message', 'recoveryHint'])
const WORKSPACE_SCOPED_VIRTUAL_ROOT = 'vault'

export const isWorkspaceScopedFilesServer = (
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

export const resolveWorkspaceScopedMountRoot = (config: McpStdioServerConfig): string | null => {
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
    const workspace = createWorkspaceRepository(db).getById(context.tenantScope, context.run.workspaceId)

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

export const toScopedPrefix = (mountRoot: string, scopedRoot: string): Result<string, DomainError> => {
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

export const normalizeWorkspaceScopedInputPath = (value: string): string => {
  const trimmed = value.trim()

  if (trimmed === '' || trimmed === '.' || trimmed === '/') {
    return '.'
  }

  const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')

  if (normalized === WORKSPACE_SCOPED_VIRTUAL_ROOT || normalized === `${WORKSPACE_SCOPED_VIRTUAL_ROOT}/`) {
    return '.'
  }

  return normalized.startsWith(`${WORKSPACE_SCOPED_VIRTUAL_ROOT}/`)
    ? normalized.slice(`${WORKSPACE_SCOPED_VIRTUAL_ROOT}/`.length)
    : normalized
}

export const prefixScopedPath = (scopedPrefix: string, value: string): string => {
  const normalized = normalizeWorkspaceScopedInputPath(value)

  if (normalized === '.') {
    return scopedPrefix
  }

  return scopedPrefix === '.' ? normalized : `${scopedPrefix}/${normalized}`
}

export const rewriteWorkspaceScopedArgs = (
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

export const rewriteWorkspaceScopedOutput = (
  value: {
    content: Array<{ text?: string; type: string }>
    structuredContent: Record<string, unknown> | null
  },
  scopedPrefix: string,
) => ({
  ...value,
  content: value.content.map((block) => {
    if (block.type !== 'text' || typeof block.text !== 'string') {
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

export const resolveWorkspaceScopedPrefix = (
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

  const resolveRootResult = resolveScopedFilesystemRoot(db, context, state.registration.config)

  if (!resolveRootResult.ok) {
    return resolveRootResult
  }

  return toScopedPrefix(mountRoot, resolveRootResult.value)
}
