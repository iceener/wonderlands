import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { configResource, envResource } from './config.resource.js';
import { filesHandler, filesResourceMetadata, filesTemplate } from './files.resource.js';

export { filesHandler, filesResourceMetadata, filesTemplate } from './files.resource.js';

/**
 * Register all resources with the MCP server.
 *
 * Resources expose data that clients can read. They can be:
 * - Static: Fixed URI like "config://server"
 * - Dynamic: URI templates like "files:///{path}" for parameterized access
 *
 * Resource handlers receive:
 * - uri: The resource URI being requested
 * - extra: SDK context (includes signal for cancellation)
 */
export function registerResources(server: McpServer): void {
  // ─────────────────────────────────────────────────────────────
  // Static Resources
  // ─────────────────────────────────────────────────────────────

  // Server configuration resource
  server.registerResource(
    configResource.name,
    configResource.uri,
    {
      title: configResource.name,
      description: configResource.description,
      mimeType: configResource.mimeType,
    },
    configResource.handler,
  );

  // Environment information resource
  server.registerResource(
    envResource.name,
    envResource.uri,
    {
      title: envResource.name,
      description: envResource.description,
      mimeType: envResource.mimeType,
    },
    envResource.handler,
  );

  // ─────────────────────────────────────────────────────────────
  // Dynamic Resource Templates
  // ─────────────────────────────────────────────────────────────

  // Files resource template - demonstrates ResourceTemplate with list/complete
  server.registerResource(
    filesResourceMetadata.name,
    filesTemplate,
    {
      title: 'Virtual Files',
      description: filesResourceMetadata.description,
      mimeType: filesResourceMetadata.mimeType,
    },
    filesHandler,
  );
}

/**
 * Export resources for testing or programmatic access
 */
export const resources = {
  config: configResource,
  env: envResource,
};
