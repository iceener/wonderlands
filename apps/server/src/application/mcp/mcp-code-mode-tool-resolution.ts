import type { McpCodeModeCatalog, McpCodeModeToolBinding } from './mcp-code-mode-catalog'

export interface McpCodeModeResolvedToolMatch {
  matchedBy: 'binding' | 'member' | 'remoteName' | 'runtimeName'
  requestedName: string
  tool: McpCodeModeToolBinding
}

export interface McpCodeModeAmbiguousToolMatch {
  matchedBy: 'binding' | 'member' | 'remoteName' | 'runtimeName'
  matches: McpCodeModeToolBinding[]
  requestedName: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeLookupName = (value: string): string => value.trim().toLowerCase()

const toolLookupResolvers: Array<{
  matchedBy: McpCodeModeResolvedToolMatch['matchedBy']
  pick: (tool: McpCodeModeToolBinding) => string
}> = [
  {
    matchedBy: 'runtimeName',
    pick: (tool) => tool.runtimeName,
  },
  {
    matchedBy: 'binding',
    pick: (tool) => tool.binding,
  },
  {
    matchedBy: 'remoteName',
    pick: (tool) => tool.remoteName,
  },
  {
    matchedBy: 'member',
    pick: (tool) => tool.member,
  },
]

export const resolveMcpCodeModeTools = (
  catalog: McpCodeModeCatalog,
  requestedNames: string[],
): {
  ambiguous: McpCodeModeAmbiguousToolMatch[]
  missing: string[]
  resolved: McpCodeModeResolvedToolMatch[]
} => {
  const ambiguous: McpCodeModeAmbiguousToolMatch[] = []
  const missing: string[] = []
  const resolved: McpCodeModeResolvedToolMatch[] = []

  for (const requestedName of requestedNames) {
    const normalizedRequestedName = normalizeLookupName(requestedName)

    let matched = false

    for (const resolver of toolLookupResolvers) {
      const matches = catalog.tools.filter(
        (tool) => normalizeLookupName(resolver.pick(tool)) === normalizedRequestedName,
      )

      if (matches.length === 0) {
        continue
      }

      matched = true

      if (matches.length === 1) {
        resolved.push({
          matchedBy: resolver.matchedBy,
          requestedName,
          tool: matches[0],
        })
      } else {
        ambiguous.push({
          matchedBy: resolver.matchedBy,
          matches,
          requestedName,
        })
      }

      break
    }

    if (!matched) {
      missing.push(requestedName)
    }
  }

  return {
    ambiguous,
    missing,
    resolved,
  }
}

export const collectLoadedMcpCodeModeLookups = (
  executions: Array<{
    errorText: string | null
    outcomeJson: unknown | null
    tool: string
  }>,
): {
  bindings: Set<string>
  runtimeNames: Set<string>
} => {
  const bindings = new Set<string>()
  const runtimeNames = new Set<string>()

  for (const execution of executions) {
    if (execution.tool !== 'get_tools' || execution.errorText || !isRecord(execution.outcomeJson)) {
      continue
    }

    const resolved = Array.isArray(execution.outcomeJson.resolved)
      ? execution.outcomeJson.resolved
      : []

    for (const entry of resolved) {
      if (!isRecord(entry)) {
        continue
      }

      if (typeof entry.binding === 'string' && entry.binding.trim().length > 0) {
        bindings.add(entry.binding.trim())
      }

      if (typeof entry.runtimeName === 'string' && entry.runtimeName.trim().length > 0) {
        runtimeNames.add(entry.runtimeName.trim())
      }
    }
  }

  return {
    bindings,
    runtimeNames,
  }
}

export const filterMcpCodeModeCatalogToLoadedTools = (
  catalog: McpCodeModeCatalog,
  loaded: {
    bindings: Set<string>
    runtimeNames: Set<string>
  },
): McpCodeModeCatalog => {
  const tools = catalog.tools.filter(
    (tool) => loaded.bindings.has(tool.binding) || loaded.runtimeNames.has(tool.runtimeName),
  )
  const serverIds = new Set(tools.map((tool) => tool.serverId))

  return {
    servers: catalog.servers
      .filter((server) => serverIds.has(server.serverId))
      .map((server) => {
        const serverTools = server.tools.filter(
          (tool) => loaded.bindings.has(tool.binding) || loaded.runtimeNames.has(tool.runtimeName),
        )

        return {
          ...server,
          executableToolCount: serverTools.filter((tool) => tool.executable).length,
          toolCount: serverTools.length,
          tools: serverTools,
        }
      }),
    tools,
  }
}
