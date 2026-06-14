import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { scrapeTool } from './scrape.tool.js';
import { searchTool } from './search.tool.js';

/**
 * Register all Firecrawl tools with the MCP server.
 *
 * Available tools:
 * - scrape: Scrape web pages and extract content (single or batch)
 * - search: Search the web and optionally scrape results
 *
 * Each tool supports:
 * - Rate limit handling with automatic retries
 * - Two output modes: direct (return content) or file (save to disk)
 * - Batch operations for efficiency
 */
export function registerTools(server: McpServer): void {
  // Scrape tool - extract content from URLs
  server.registerTool(
    scrapeTool.name,
    {
      description: scrapeTool.description,
      inputSchema: scrapeTool.inputSchema.shape,
      outputSchema: scrapeTool.outputSchema.shape,
    },
    scrapeTool.handler,
  );

  // Search tool - search the web
  server.registerTool(
    searchTool.name,
    {
      description: searchTool.description,
      inputSchema: searchTool.inputSchema.shape,
      outputSchema: searchTool.outputSchema.shape,
    },
    searchTool.handler,
  );
}

/**
 * Export tools for testing or programmatic access
 */
export const tools = {
  scrape: scrapeTool,
  search: searchTool,
};
