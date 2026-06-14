import type { BackendMcpServerTool } from '../services/api'

export interface ConnectTextRow {
  value: string
}

export interface ConnectKeyValueRow {
  key: string
  value: string
}

export const isDuplicateMcpLabelConflict = (message: string): boolean =>
  /unique constraint failed:\s*mcp_servers\.tenant_id,\s*mcp_servers\.created_by_account_id,\s*mcp_servers\.label/iu.test(
    message,
  )

export const getAutoRenamedLabel = (label: string, attempt: number): string => {
  const trimmed = label.trim()
  return attempt <= 0 ? trimmed : `${trimmed} ${attempt + 1}`
}

export const serializeArgumentRows = (rows: readonly ConnectTextRow[]): string[] =>
  rows.map((row) => row.value.trim()).filter((value) => value.length > 0)

export const serializeKeyValueRows = (
  rows: readonly ConnectKeyValueRow[],
  label: string,
): Record<string, string> => {
  const result: Record<string, string> = {}

  for (const row of rows) {
    const key = row.key.trim()
    const value = row.value.trim()

    if (!key && !value) {
      continue
    }

    if (!key) {
      throw new Error(`Each ${label} row needs a key.`)
    }

    result[key] = value
  }

  return result
}

export const defaultAssignableToolNames = (tools: readonly BackendMcpServerTool[]): string[] =>
  tools
    .filter((tool) => tool.modelVisible && tool.assignment === null)
    .map((tool) => tool.runtimeName)

export const assignedToolNames = (tools: readonly BackendMcpServerTool[]): string[] =>
  tools
    .filter((tool) => tool.modelVisible && tool.assignment !== null)
    .map((tool) => tool.runtimeName)

export const defaultRequiresConfirmation = (tools: readonly BackendMcpServerTool[]): boolean => {
  const assigned = tools.filter(
    (
      tool,
    ): tool is BackendMcpServerTool & {
      assignment: NonNullable<BackendMcpServerTool['assignment']>
    } => tool.modelVisible && tool.assignment !== null,
  )

  if (assigned.length === 0) {
    return true
  }

  return assigned.every((tool) => tool.assignment.requiresConfirmation)
}

export const trustedToolNames = (tools: readonly BackendMcpServerTool[]): Set<string> => {
  const trusted = new Set<string>()

  for (const tool of tools) {
    if (tool.modelVisible && tool.assignment && !tool.assignment.requiresConfirmation) {
      trusted.add(tool.runtimeName)
    }
  }

  return trusted
}

export const hasToolSelectionChanges = (
  tools: readonly BackendMcpServerTool[],
  selectedRuntimeNames: readonly string[],
  trustedNames: ReadonlySet<string>,
): boolean => {
  const visibleToolNames = new Set(
    tools.filter((tool) => tool.modelVisible).map((tool) => tool.runtimeName),
  )
  const selected = new Set(
    selectedRuntimeNames.filter((runtimeName) => visibleToolNames.has(runtimeName)),
  )

  for (const tool of tools) {
    if (!tool.modelVisible) {
      continue
    }

    const isSelected = selected.has(tool.runtimeName)

    if (!tool.assignment && isSelected) {
      return true
    }

    if (tool.assignment && !isSelected) {
      return true
    }

    if (tool.assignment && isSelected) {
      const wasTrusted = !tool.assignment.requiresConfirmation
      const isTrusted = trustedNames.has(tool.runtimeName)
      if (wasTrusted !== isTrusted) {
        return true
      }
    }
  }

  return false
}
