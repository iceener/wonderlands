import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildCapabilities } from './capabilities.js';

/**
 * A registration function that attaches handlers (tools, prompts, or
 * resources) to an `McpServer` instance. Each MCP server package supplies
 * its own registration functions; this module stays agnostic of what is
 * actually registered.
 */
export type ServerRegistrar = (server: McpServer) => void;

export interface ServerOptions {
  /** Server name (appears in client UI) */
  name: string;
  /** Server version (semver) */
  version: string;
  /** Instructions for the LLM on how to use this server */
  instructions?: string;
  /** Register tools on the server (optional, no-op if omitted) */
  registerTools?: ServerRegistrar;
  /** Register prompts on the server (optional, no-op if omitted) */
  registerPrompts?: ServerRegistrar;
  /** Register resources on the server (optional, no-op if omitted) */
  registerResources?: ServerRegistrar;
}

/**
 * Build and configure an MCP server.
 *
 * This is the shared factory function used by every stdio MCP server in
 * this repo. It:
 * 1. Creates the `McpServer` instance with standard capabilities
 * 2. Delegates registration of tools, prompts, and resources to the
 *    callbacks supplied by the consuming server
 *
 * Note: `logger.setServer()` must be called AFTER `server.connect()` to
 * avoid sending MCP notifications before the initialization handshake
 * completes. See `runStdioServer` in `../lifecycle/stdio.js`.
 */
export function buildServer(options: ServerOptions): McpServer {
  const { name, version, instructions, registerTools, registerPrompts, registerResources } =
    options;

  const server = new McpServer(
    { name, version },
    {
      capabilities: buildCapabilities(),
      instructions,
    },
  );

  registerTools?.(server);
  registerPrompts?.(server);
  registerResources?.(server);

  return server;
}
