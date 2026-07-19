/**
 * Type exports for MCP server template.
 *
 * Import types from here for consistent usage across the codebase:
 *
 * @example
 * import type { HandlerExtra, ProgressToken } from '../types/index.js';
 */

// Handler types (shared across mcp/* servers)
export type {
  HandlerExtra,
  PromptDefinition,
  PromptHandler,
  ResourceDefinition,
  ResourceHandler,
  ResourceTemplateDefinition,
  ToolDefinition,
  ToolHandler,
} from '@wonderlands/mcp-shared';
// Context types
export type {
  CancellationToken,
  HandlerExtraInfo,
  ProgressParams,
  ProgressToken,
  RequestContext,
  RequestHandlerExtra,
} from './context.js';
export { contextRegistry, createCancellationToken } from './context.js';
