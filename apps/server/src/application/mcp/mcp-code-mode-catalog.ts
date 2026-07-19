import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../adapters/mcp/normalize-tool'
import {
  createMcpServerRepository,
  createMcpToolAssignmentRepository,
} from '../persistence/repositories'
import type { ToolContext, ToolSpec } from '../tooling/tool-registry'

const MCP_RUNTIME_SEPARATOR = '__'
const regexQueryPattern = /^\/(.+)\/([a-z]*)$/
const jsIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export interface McpCodeModeToolBinding {
  binding: string
  description: string | null
  executable: boolean
  member: string
  namespace: string
  remoteName: string
  runtimeName: string
  serverId: string
  serverLabel: string
  title: string | null
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown> | null
}

export interface McpCodeModeServerBinding {
  executableToolCount: number
  namespace: string
  serverId: string
  serverLabel: string
  toolCount: number
  tools: McpCodeModeToolBinding[]
}

export interface McpCodeModeCatalog {
  servers: McpCodeModeServerBinding[]
  tools: McpCodeModeToolBinding[]
}

const splitRuntimeName = (
  runtimeName: string,
): {
  member: string
  namespace: string
} => {
  const separatorIndex = runtimeName.indexOf(MCP_RUNTIME_SEPARATOR)

  if (separatorIndex <= 0) {
    return {
      member: runtimeName,
      namespace: 'mcp',
    }
  }

  return {
    member: runtimeName.slice(separatorIndex + MCP_RUNTIME_SEPARATOR.length),
    namespace: runtimeName.slice(0, separatorIndex),
  }
}

const sanitizeJsIdentifier = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const safe = normalized.length > 0 ? normalized : 'mcp'

  return jsIdentifierPattern.test(safe) ? safe : `_${safe}`
}

const summarizeDescription = (value: string | null | undefined, maxLength = 180): string | null => {
  const trimmed = value?.trim() ?? ''

  if (!trimmed) {
    return null
  }

  const firstParagraph =
    trimmed
      .split(/\n\s*\n/, 1)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? ''

  if (!firstParagraph) {
    return null
  }

  return firstParagraph.length <= maxLength
    ? firstParagraph
    : `${firstParagraph.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

const normalizeQueryMatcher = (query: string | undefined): ((value: string) => boolean) | null => {
  const trimmed = query?.trim() ?? ''

  if (!trimmed) {
    return null
  }

  const regexMatch = trimmed.match(regexQueryPattern)

  if (regexMatch) {
    const [, pattern, flags] = regexMatch

    try {
      const regex = new RegExp(pattern, flags)
      return (value: string) => regex.test(value)
    } catch {
      // Fall back to substring matching when the provided regex is invalid.
    }
  }

  const needle = trimmed.toLowerCase()
  return (value: string) => value.toLowerCase().includes(needle)
}

const toSearchFields = (value: Array<string | null | undefined>): string[] =>
  value.map((entry) => entry?.trim() ?? '').filter((entry) => entry.length > 0)

const isDbMcpServerForScope = (context: ToolContext, serverId: string): boolean =>
  createMcpServerRepository(context.db).getById(context.tenantScope, serverId).ok

const getServerLabel = (context: ToolContext, serverId: string, namespace: string): string => {
  const server = createMcpServerRepository(context.db).getById(context.tenantScope, serverId)
  return server.ok ? server.value.label : namespace
}

const isToolExecutable = (
  context: ToolContext,
  tool: Pick<McpCodeModeToolBinding, 'runtimeName' | 'serverId'> & { fingerprint?: string | null },
): boolean => {
  const temporaryApprovals = new Set(context.mcpCodeModeApprovedRuntimeNames ?? [])

  if (
    getMcpRuntimeNameAliasesFromRuntimeName(tool.runtimeName).some((runtimeName) =>
      temporaryApprovals.has(runtimeName),
    )
  ) {
    return true
  }

  if (!context.run.toolProfileId || !isDbMcpServerForScope(context, tool.serverId)) {
    return true
  }

  const assignment = createMcpToolAssignmentRepository(context.db).getByAnyRuntimeName(
    context.tenantScope,
    context.run.toolProfileId,
    getMcpRuntimeNameAliasesFromRuntimeName(tool.runtimeName),
  )

  if (!assignment.ok) {
    return false
  }

  return (
    !assignment.value.requiresConfirmation ||
    !tool.fingerprint ||
    assignment.value.approvedFingerprint === tool.fingerprint
  )
}

export const buildMcpCodeModeCatalog = (
  context: ToolContext,
  tools: ToolSpec[],
): McpCodeModeCatalog => {
  const resolvedTools: McpCodeModeToolBinding[] = tools
    .filter((tool) => tool.domain === 'mcp')
    .flatMap((tool) => {
      const descriptor = context.services.mcp.getTool(tool.name)

      if (!descriptor) {
        return []
      }

      const { member, namespace } = splitRuntimeName(descriptor.runtimeName)
      const safeNamespace = sanitizeJsIdentifier(namespace)
      const safeMember = sanitizeJsIdentifier(member)
      const serverLabel = getServerLabel(context, descriptor.serverId, safeNamespace)

      return [
        {
          binding: `${safeNamespace}.${safeMember}`,
          description: descriptor.description ?? null,
          executable: isToolExecutable(context, {
            fingerprint: descriptor.fingerprint,
            runtimeName: descriptor.runtimeName,
            serverId: descriptor.serverId,
          }),
          inputSchema: descriptor.inputSchema,
          member: safeMember,
          namespace: safeNamespace,
          outputSchema: descriptor.outputSchema,
          remoteName: descriptor.remoteName,
          runtimeName: descriptor.runtimeName,
          serverId: descriptor.serverId,
          serverLabel,
          title: descriptor.title ?? null,
        },
      ]
    })
    .sort((left, right) => {
      const serverOrder = left.serverLabel.localeCompare(right.serverLabel)
      if (serverOrder !== 0) {
        return serverOrder
      }

      return left.runtimeName.localeCompare(right.runtimeName)
    })

  const serversById = new Map<string, McpCodeModeServerBinding>()

  for (const tool of resolvedTools) {
    const existing = serversById.get(tool.serverId)

    if (existing) {
      existing.tools.push(tool)
      existing.toolCount += 1
      if (tool.executable) {
        existing.executableToolCount += 1
      }
      continue
    }

    serversById.set(tool.serverId, {
      executableToolCount: tool.executable ? 1 : 0,
      namespace: tool.namespace,
      serverId: tool.serverId,
      serverLabel: tool.serverLabel,
      toolCount: 1,
      tools: [tool],
    })
  }

  return {
    servers: [...serversById.values()].sort((left, right) =>
      left.serverLabel.localeCompare(right.serverLabel),
    ),
    tools: resolvedTools,
  }
}

export const formatMcpCodeModeInventoryMessage = (catalog: McpCodeModeCatalog): string => {
  if (catalog.servers.length === 0) {
    return [
      'MCP code mode is enabled.',
      'No assigned MCP tools are currently available for this run.',
      'Use search_tools to confirm the active catalog before attempting execute with `mode: "script"`.',
    ].join('\n')
  }

  return [
    'MCP code mode is enabled.',
    'Direct MCP function schemas are hidden from the model in this mode.',
    'Workflow: use search_tools for discovery, get_tools for exact schemas, then execute with `mode: "script"` to act.',
    'When a task obviously needs multiple bindings, load them together in one get_tools call before writing code.',
    'In execute script mode, MCP bindings are only exposed after you load them with get_tools. In code, call only those bindings exactly as returned by get_tools.',
    'Do not use execute script mode to inspect globalThis or enumerate bindings.',
    'Prefer one execute script run per task. Batch reads, filtering, actions, and at most one verification step in one script when possible.',
    'Inside code, MCP bindings resolve to structuredContent when available and otherwise return the raw result. Write code against the TypeScript returned by get_tools.',
    'In MCP code mode, write a script body, not a full module. The runtime wraps your code in an awaited async function.',
    'You may either `return` one final object/value or log one compact final JSON result with console.log. Do not use top-level import/export in MCP code mode.',
    'Avoid process.exit() on normal success paths. Let the script finish naturally after returning or logging the final result.',
    'Avoid Node-only built-ins like `node:fs` unless the task truly requires Node compat; prefer stdout for compact results and bash mode for simple file operations.',
    'MCP bindings do not require sandbox network access. Keep network off unless the script itself needs external HTTP or npm package installation.',
    '',
    'Active MCP inventory:',
    ...catalog.servers.map(
      (server) =>
        `- ${server.serverLabel}: ${server.tools.map((tool) => tool.member).join(', ') || 'no tools'}`,
    ),
  ].join('\n')
}

export const searchMcpCodeModeCatalog = (
  catalog: McpCodeModeCatalog,
  input: {
    executableOnly?: boolean
    query?: string
    scope?: 'both' | 'servers' | 'tools'
    serverId?: string
  },
): {
  hint: {
    message: string
    nextToolArgs: {
      names: string[]
    }
    nextToolName: 'get_tools'
    suggestedBindings: string[]
  }
  queryMode: 'all' | 'regex' | 'substring'
  servers: Array<{
    executableToolCount: number
    namespace: string
    serverId: string
    serverLabel: string
    toolCount: number
  }>
  tools: Array<{
    binding: string
    description: string | null
    executable: boolean
    serverId: string
    serverLabel: string
    title: string | null
  }>
} => {
  const matcher = normalizeQueryMatcher(input.query)
  const queryMode = input.query?.trim()?.match(regexQueryPattern)
    ? 'regex'
    : matcher
      ? 'substring'
      : 'all'
  const scope = input.scope ?? 'both'
  const serverId = input.serverId?.trim() ?? ''
  const executableOnly = input.executableOnly === true
  const serverMatches = catalog.servers.filter((server) => {
    if (serverId && server.serverId !== serverId) {
      return false
    }

    if (executableOnly && server.executableToolCount === 0) {
      return false
    }

    if (!matcher || scope === 'tools') {
      return true
    }

    return toSearchFields([server.serverId, server.serverLabel, server.namespace]).some((value) =>
      matcher(value),
    )
  })
  const toolMatches = catalog.tools.filter((tool) => {
    if (serverId && tool.serverId !== serverId) {
      return false
    }

    if (executableOnly && !tool.executable) {
      return false
    }

    if (!matcher || scope === 'servers') {
      return true
    }

    return toSearchFields([
      tool.binding,
      tool.description,
      tool.remoteName,
      tool.runtimeName,
      tool.serverId,
      tool.serverLabel,
      tool.title,
    ]).some((value) => matcher(value))
  })
  const visibleTools =
    scope === 'servers'
      ? []
      : toolMatches.map((tool) => ({
          binding: tool.binding,
          description: summarizeDescription(tool.description),
          executable: tool.executable,
          serverId: tool.serverId,
          serverLabel: tool.serverLabel,
          title: tool.title,
        }))
  const suggestedBindings = visibleTools.slice(0, 3).map((tool) => tool.binding)

  return {
    hint: {
      message:
        'search_tools only discovers tools. Before execute with `mode: "script"`, call get_tools with the exact bindings you plan to use, ideally in one batched call.',
      nextToolArgs: {
        names: suggestedBindings,
      },
      nextToolName: 'get_tools',
      suggestedBindings,
    },
    queryMode,
    servers:
      scope === 'tools'
        ? []
        : serverMatches.map((server) => ({
            executableToolCount: server.executableToolCount,
            namespace: server.namespace,
            serverId: server.serverId,
            serverLabel: server.serverLabel,
            toolCount: server.toolCount,
          })),
    tools: visibleTools,
  }
}
