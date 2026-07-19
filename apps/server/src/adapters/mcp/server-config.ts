import type {
  McpServerRecord,
  McpStoredServerTransportConfig,
} from '../../domain/mcp/mcp-server-repository'
import { revealStoredHttpAuthConfig } from './stored-auth'
import type { McpServerConfig } from './types'

/**
 * Converts a persisted, protocol-neutral {@link McpServerRecord} into the
 * fully resolved {@link McpServerConfig} used by the MCP gateway and runtime
 * adapters. This is the adapter-side counterpart to the domain-level storage
 * shape and is intentionally kept out of `domain/mcp` so the domain layer has
 * no dependency on adapters or the MCP SDK.
 */
export const toMcpServerConfig = (
  record: McpServerRecord,
  encryptionKey: string | null = null,
): McpServerConfig => {
  if (record.kind === 'stdio') {
    const config = record.config as Extract<McpStoredServerTransportConfig, { command: string }>

    return {
      args: config.args,
      command: config.command,
      cwd: config.cwd,
      enabled: record.enabled,
      env: config.env,
      id: record.id,
      kind: 'stdio',
      logLevel: record.logLevel ?? undefined,
      stderr: config.stderr,
      toolPrefix: record.label,
      workspaceScoped: config.workspaceScoped,
    }
  }

  const config = record.config as Extract<McpStoredServerTransportConfig, { url: string }>

  return {
    auth: revealStoredHttpAuthConfig(config.auth, encryptionKey),
    enabled: record.enabled,
    headers: config.headers,
    id: record.id,
    kind: 'streamable_http',
    logLevel: record.logLevel ?? undefined,
    toolPrefix: record.label,
    url: config.url,
  }
}
