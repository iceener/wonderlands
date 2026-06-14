/**
 * Type exports for MCP server template.
 *
 * Import types from here for consistent usage across the codebase:
 *
 * @example
 * import type { HandlerExtra, ProgressToken } from '../types/index.js';
 */

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
} from './handlers.js';
