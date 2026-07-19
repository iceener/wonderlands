import type { McpCodeModeCatalog, McpCodeModeToolBinding } from './mcp-code-mode-catalog'

export const MCP_CODE_MODE_CONFIRMATION_TARGET_REF = 'mcp_code_execute_confirmation'

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
