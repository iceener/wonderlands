import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { fsManageTool } from './fs-manage.tool.js';
import { fsReadTool } from './fs-read.tool.js';
import { fsSearchTool } from './fs-search.tool.js';
import { fsWriteTool } from './fs-write.tool.js';

/**
 * Get the underlying object schema from a ZodEffects (after .refine() or .transform())
 * Walks down the _def chain to find the ZodObject.
 */
function getBaseSchema(schema: z.ZodType): z.ZodObject<z.ZodRawShape> {
  let current: unknown = schema;
  // Walk down the chain of ZodEffects to find the base ZodObject
  while (current && typeof current === 'object' && '_def' in current) {
    const def = (current as { _def: { schema?: unknown } })._def;
    if ('schema' in def && def.schema) {
      current = def.schema;
    } else {
      break;
    }
  }
  return current as z.ZodObject<z.ZodRawShape>;
}

/**
 * Register all tools with the MCP server.
 */
export function registerTools(server: McpServer): void {
  // fs_read - explore and read
  // Note: We use getBaseSchema() to get the base schema before refine() transforms
  const readBaseSchema = getBaseSchema(fsReadTool.inputSchema);
  server.registerTool(
    fsReadTool.name,
    {
      description: fsReadTool.description,
      inputSchema: readBaseSchema.shape,
    },
    fsReadTool.handler,
  );

  // fs_search - find files and search content
  const searchBaseSchema = getBaseSchema(fsSearchTool.inputSchema);
  server.registerTool(
    fsSearchTool.name,
    {
      description: fsSearchTool.description,
      inputSchema: searchBaseSchema.shape,
    },
    fsSearchTool.handler,
  );

  // fs_write - create, update
  const writeBaseSchema = getBaseSchema(fsWriteTool.inputSchema);
  server.registerTool(
    fsWriteTool.name,
    {
      description: fsWriteTool.description,
      inputSchema: writeBaseSchema.shape,
    },
    fsWriteTool.handler,
  );

  // fs_manage - structural operations
  const manageBaseSchema = getBaseSchema(fsManageTool.inputSchema);
  server.registerTool(
    fsManageTool.name,
    {
      description: fsManageTool.description,
      inputSchema: manageBaseSchema.shape,
    },
    fsManageTool.handler,
  );
}

/**
 * Export tools for testing
 */
export const tools = {
  fsRead: fsReadTool,
  fsSearch: fsSearchTool,
  fsWrite: fsWriteTool,
  fsManage: fsManageTool,
};
