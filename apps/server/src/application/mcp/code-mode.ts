import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../adapters/mcp/normalize-tool'
import { createMcpServerRepository } from '../../adapters/persistence/sqlite/mcp/mcp-server-repository'
import { createMcpToolAssignmentRepository } from '../../adapters/persistence/sqlite/mcp/mcp-tool-assignment-repository'
import type { ToolContext, ToolSpec } from '../../domain/tooling/tool-registry'

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

export const MCP_CODE_MODE_CONFIRMATION_TARGET_REF = 'mcp_code_execute_confirmation'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const escapeBlockComment = (value: string): string => value.replace(/\*\//g, '*\\/')

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

const toJsDoc = (description: string | null | undefined, indent = ''): string[] => {
  const text = description?.trim() ?? ''

  if (!text) {
    return []
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return [
    `${indent}/**`,
    ...lines.map((line) => `${indent} * ${escapeBlockComment(line)}`),
    `${indent} */`,
  ]
}

const toPascalCase = (value: string): string => {
  const parts = value.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0)
  const joined = parts.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('')

  return joined.length > 0 ? joined : 'Generated'
}

const singularize = (value: string): string => {
  if (value.endsWith('ies') && value.length > 3) {
    return `${value.slice(0, -3)}y`
  }

  if (
    ['ches', 'shes', 'sses', 'xes', 'zes'].some((suffix) => value.endsWith(suffix)) &&
    value.length > 4
  ) {
    return value.slice(0, -2)
  }

  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 1) {
    return value.slice(0, -1)
  }

  return `${value}Item`
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

const normalizeLookupName = (value: string): string => value.trim().toLowerCase()

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
  const queryMode =
    input.query?.trim() && input.query.trim().match(regexQueryPattern)
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

export const findMcpRuntimeNameCallMisuse = (
  catalog: McpCodeModeCatalog,
  code: string,
): null | {
  binding: string
  runtimeName: string
} => {
  for (const tool of catalog.tools) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegex(tool.runtimeName)}\\s*\\(`)

    if (pattern.test(code)) {
      return {
        binding: tool.binding,
        runtimeName: tool.runtimeName,
      }
    }
  }

  return null
}

export const findReferencedMcpCodeModeBindings = (
  catalog: McpCodeModeCatalog,
  code: string,
): string[] => {
  const matches: string[] = []

  for (const tool of catalog.tools) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegex(tool.binding)}\\s*\\(`)

    if (pattern.test(code)) {
      matches.push(tool.binding)
    }
  }

  return matches
}

export const findReferencedNonExecutableMcpCodeModeTools = (
  catalog: McpCodeModeCatalog,
  code: string,
): McpCodeModeToolBinding[] => {
  const referencedBindings = new Set(findReferencedMcpCodeModeBindings(catalog, code))

  return catalog.tools.filter(
    (tool) => referencedBindings.has(tool.binding) && tool.executable === false,
  )
}

export const formatMcpCodeModeConfirmationDescription = (
  tools: McpCodeModeToolBinding[],
): string | null => {
  const bindings = Array.from(new Set(tools.map((tool) => tool.binding))).filter(
    (binding) => binding.length > 0,
  )

  if (bindings.length === 0) {
    return null
  }

  return bindings.length === 1
    ? `Confirmation required before execute script mode can call ${bindings[0]}.`
    : `Confirmation required before execute script mode can call ${bindings.join(', ')}.`
}

export const isMcpCodeModeConfirmationTargetRef = (value: string | null | undefined): boolean =>
  value === MCP_CODE_MODE_CONFIRMATION_TARGET_REF

export const findMcpCodeModeModuleSyntaxMisuse = (
  code: string,
): null | {
  kind: 'export' | 'import'
  line: number
  snippet: string
} => {
  const lines = code.split('\n')

  for (const [index, rawLine] of lines.entries()) {
    const snippet = rawLine.trim()

    if (
      snippet.length === 0 ||
      snippet.startsWith('//') ||
      snippet.startsWith('/*') ||
      snippet.startsWith('*')
    ) {
      continue
    }

    if (/^import(?:\s+[\w*{]|["'])/.test(snippet)) {
      return {
        kind: 'import',
        line: index + 1,
        snippet,
      }
    }

    if (/^export(?:\s+|[{*])/.test(snippet)) {
      return {
        kind: 'export',
        line: index + 1,
        snippet,
      }
    }
  }

  return null
}

interface TypeRenderContext {
  declarations: string[]
  seenNames: Set<string>
}

const renderLiteralType = (value: unknown): string => {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return 'unknown'
}

const renderSchemaType = (
  schemaValue: unknown,
  nameHint: string,
  context: TypeRenderContext,
): string => {
  if (!isRecord(schemaValue)) {
    return 'unknown'
  }

  if (Array.isArray(schemaValue.enum) && schemaValue.enum.length > 0) {
    return schemaValue.enum.map((entry) => renderLiteralType(entry)).join(' | ')
  }

  if ('const' in schemaValue) {
    return renderLiteralType(schemaValue.const)
  }

  if (Array.isArray(schemaValue.oneOf) && schemaValue.oneOf.length > 0) {
    return schemaValue.oneOf
      .map((entry, index) => renderSchemaType(entry, `${nameHint}${index + 1}`, context))
      .join(' | ')
  }

  if (Array.isArray(schemaValue.anyOf) && schemaValue.anyOf.length > 0) {
    return schemaValue.anyOf
      .map((entry, index) => renderSchemaType(entry, `${nameHint}${index + 1}`, context))
      .join(' | ')
  }

  const typeValue = schemaValue.type

  if (Array.isArray(typeValue) && typeValue.length > 0) {
    return typeValue
      .map((entry, index) =>
        renderSchemaType({ ...schemaValue, type: entry }, `${nameHint}${index + 1}`, context),
      )
      .join(' | ')
  }

  switch (typeValue) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array': {
      const itemType = renderSchemaType(schemaValue.items, singularize(nameHint), context)
      return `Array<${itemType}>`
    }
    case 'object': {
      const interfaceName = toPascalCase(nameHint)

      if (context.seenNames.has(interfaceName)) {
        return interfaceName
      }

      context.seenNames.add(interfaceName)
      const properties = isRecord(schemaValue.properties) ? schemaValue.properties : {}
      const required = Array.isArray(schemaValue.required)
        ? new Set(
            schemaValue.required.filter((entry): entry is string => typeof entry === 'string'),
          )
        : new Set<string>()
      const propertyLines = Object.entries(properties).flatMap(([key, propertySchema]) => {
        const propertyDescription = isRecord(propertySchema)
          ? toJsDoc(
              typeof propertySchema.description === 'string' ? propertySchema.description : null,
              '  ',
            )
          : []
        const propertyType = renderSchemaType(
          propertySchema,
          `${interfaceName}${toPascalCase(key)}`,
          context,
        )

        return [
          ...propertyDescription,
          `  ${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${propertyType};`,
        ]
      })
      const additionalProperties = schemaValue.additionalProperties
      const additionalPropertyLine =
        additionalProperties && typeof additionalProperties === 'object'
          ? `  [key: string]: ${renderSchemaType(
              additionalProperties,
              `${interfaceName}Value`,
              context,
            )};`
          : additionalProperties === true
            ? '  [key: string]: unknown;'
            : null

      context.declarations.push(
        [
          `interface ${interfaceName} {`,
          ...(propertyLines.length > 0 ? propertyLines : []),
          ...(additionalPropertyLine ? [additionalPropertyLine] : []),
          ...(propertyLines.length === 0 && !additionalPropertyLine
            ? ['  [key: string]: unknown;']
            : []),
          `}`,
        ].join('\n'),
      )

      return interfaceName
    }
    default:
      return 'unknown'
  }
}

export const renderMcpCodeModeTypeScript = (tool: McpCodeModeToolBinding): string => {
  return renderMcpCodeModeTypeScriptBundle([tool])
}

export const renderMcpCodeModeTypeScriptBundle = (tools: McpCodeModeToolBinding[]): string => {
  const context: TypeRenderContext = {
    declarations: [],
    seenNames: new Set<string>(),
  }
  const membersByNamespace = new Map<string, string[]>()

  for (const tool of tools) {
    const inputTypeName = `${toPascalCase(tool.namespace)}${toPascalCase(tool.member)}Input`
    const outputTypeName = `${toPascalCase(tool.namespace)}${toPascalCase(tool.member)}Output`
    const inputType = renderSchemaType(tool.inputSchema, inputTypeName, context)
    const outputType = tool.outputSchema
      ? renderSchemaType(tool.outputSchema, outputTypeName, context)
      : 'unknown'
    const currentMembers = membersByNamespace.get(tool.namespace) ?? []

    currentMembers.push(
      ...toJsDoc(tool.description, '  '),
      `  ${tool.member}(input: ${inputType}): Promise<${outputType}>;`,
    )

    membersByNamespace.set(tool.namespace, currentMembers)
  }

  const namespaceDeclarations = [...membersByNamespace.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([namespace, members]) => [`declare const ${namespace}: {`, ...members, `};`])

  return [...context.declarations, '', ...namespaceDeclarations].join('\n').trim()
}

export const renderMcpCodeModeWrapperScript = (input: {
  catalog: McpCodeModeCatalog
  code: string
}): string => {
  const wrappedCode = input.code
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
  const helperLines = [
    'const __wonderlandsCreateBridgeError = (error) => {',
    '  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {',
    '    return new Error(error.message);',
    '  }',
    '  return new Error("Unknown MCP bridge error");',
    '};',
    'const __wonderlandsNormalizeMcpResult = (result) => {',
    '  if (!result || typeof result !== "object") {',
    '    return result ?? null;',
    '  }',
    '  if ("structuredContent" in result) {',
    '    const structured = result.structuredContent;',
    '    if (structured !== undefined && structured !== null) {',
    '      return structured;',
    '    }',
    '  }',
    '  return result ?? null;',
    '};',
    'const __wonderlandsPrintResult = (value) => {',
    '  if (value === undefined) {',
    '    return;',
    '  }',
    '  if (typeof value === "string") {',
    '    console.log(value);',
    '    return;',
    '  }',
    '  try {',
    '    const json = JSON.stringify(value);',
    '    console.log(json === undefined ? String(value) : json);',
    '    return;',
    '  } catch {',
    '    console.log(String(value));',
    '  }',
    '};',
    'const __wonderlandsCallMcp = typeof globalThis.__wonderlandsCallMcp === "function"',
    '  ? async (runtimeName, args) => __wonderlandsNormalizeMcpResult(await globalThis.__wonderlandsCallMcp(runtimeName, args))',
    '  : (() => {',
    '      const pendingCalls = new Map();',
    '      let sequence = 0;',
    '      const setChannelReferenced = (referenced) => {',
    '        if (!process.channel) {',
    '          return;',
    '        }',
    '        if (referenced) {',
    '          process.channel.ref?.();',
    '          return;',
    '        }',
    '        process.channel.unref?.();',
    '      };',
    '      setChannelReferenced(false);',
    '      process.on("message", (message) => {',
    '        if (!message || typeof message !== "object" || message.type !== "wonderlands_mcp_response") {',
    '          return;',
    '        }',
    '        const pending = pendingCalls.get(message.id);',
    '        if (!pending) {',
    '          return;',
    '        }',
    '        pendingCalls.delete(message.id);',
    '        if (pendingCalls.size === 0) {',
    '          setChannelReferenced(false);',
    '        }',
    '        if (message.ok) {',
    '          pending.resolve(__wonderlandsNormalizeMcpResult(message.result));',
    '          return;',
    '        }',
    '        pending.reject(__wonderlandsCreateBridgeError(message.error));',
    '      });',
    '      return (runtimeName, args) => new Promise((resolve, reject) => {',
    '        if (typeof process.send !== "function") {',
    '          reject(new Error("MCP bridge is not available in this sandbox runtime"));',
    '          return;',
    '        }',
    '        const id = `mcp_${++sequence}`;',
    '        pendingCalls.set(id, { reject, resolve });',
    '        setChannelReferenced(true);',
    '        process.send({ args: args ?? {}, id, runtimeName, type: "wonderlands_mcp_call" });',
    '      });',
    '    })();',
  ]

  const bindingLines = input.catalog.servers.flatMap((server) => {
    const executableTools = server.tools.filter((tool) => tool.executable)

    if (executableTools.length === 0) {
      return []
    }

    return [
      `globalThis.${server.namespace} = Object.freeze({`,
      ...executableTools.map(
        (tool) =>
          `  ${tool.member}: async (input) => await __wonderlandsCallMcp(${JSON.stringify(tool.runtimeName)}, input),`,
      ),
      '});',
    ]
  })

  return [
    ...helperLines,
    ...bindingLines,
    '',
    'const __wonderlandsResult = await (async () => {',
    wrappedCode,
    '})();',
    'if (typeof globalThis.__wonderlandsWaitForMcpIdle === "function") {',
    '  await globalThis.__wonderlandsWaitForMcpIdle();',
    '}',
    '__wonderlandsPrintResult(__wonderlandsResult);',
  ].join('\n')
}
