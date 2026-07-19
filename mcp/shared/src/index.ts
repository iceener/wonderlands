/**
 * @wonderlands/mcp-shared
 *
 * Shared scaffolding for standalone stdio MCP servers in this repo:
 * server builder, capabilities, stdio lifecycle startup, and the common
 * handler/logger/error utilities that are actually used by the servers
 * under `mcp/*`.
 *
 * This package is intentionally NOT part of the root npm workspaces. It is
 * consumed via `file:../shared` dependencies from each MCP server package
 * (e.g. `mcp/web`, `mcp/files-mcp`), each of which manages its own
 * lockfile.
 */

// Core server building blocks
export { buildCapabilities } from './core/capabilities.js';
export type { ServerOptions, ServerRegistrar } from './core/server.js';
export { buildServer } from './core/server.js';

// Stdio lifecycle
export type { StdioServerMeta } from './lifecycle/stdio.js';
export { runStdioServer } from './lifecycle/stdio.js';

// Handler types
export type {
  HandlerExtra,
  PromptDefinition,
  PromptHandler,
  ResourceDefinition,
  ResourceHandler,
  ResourceTemplateDefinition,
  ToolDefinition,
  ToolHandler,
} from './types/handlers.js';
// Errors
export type { ToolErrorCode } from './utils/errors.js';
export {
  assertTool,
  cancelledError,
  McpError,
  McpErrorCode,
  ToolError,
  ToolErrorCodes,
  toolError,
  validationError,
  wrapHandler,
} from './utils/errors.js';
// Logger
export type { LogLevel } from './utils/logger.js';
export { logger } from './utils/logger.js';
