import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from '../utils/logger.js';

export interface StdioServerMeta {
  /** Server name, used for the startup log line */
  name: string;
  /** Server version, used for the startup log line */
  version: string;
}

/**
 * Connect an already-built `McpServer` to stdio and wire up the standard
 * lifecycle handlers shared by every stdio MCP server in this repo:
 *
 * - Connects the server to a `StdioServerTransport`
 * - Attaches `logger` to the server once the client/server handshake
 *   completes (MCP notifications can only be sent after `initialized`)
 * - Installs graceful shutdown handlers for SIGINT/SIGTERM
 * - Installs process-level handlers for uncaught exceptions and unhandled
 *   rejections
 *
 * @example
 * const server = buildServer({ name, version, instructions, registerTools });
 * await runStdioServer(server, { name, version });
 */
export async function runStdioServer(server: McpServer, meta: StdioServerMeta): Promise<void> {
  const transport = new StdioServerTransport();

  // Set up initialization callback - MCP notifications can only be sent AFTER
  // the client sends the 'initialized' notification (handshake complete)
  server.server.oninitialized = () => {
    logger.setServer(server);
    logger.info('server', {
      message: 'MCP stdio server started',
      name: meta.name,
      version: meta.version,
    });
  };

  installProcessLifecycleHandlers();

  // Connect server to transport (starts listening, handshake happens async)
  await server.connect(transport);
}

let lifecycleHandlersInstalled = false;

/**
 * Install shutdown and error handlers on the current process.
 *
 * Safe to call multiple times - handlers are only attached once per process.
 */
function installProcessLifecycleHandlers(): void {
  if (lifecycleHandlersInstalled) return;
  lifecycleHandlersInstalled = true;

  const shutdown = (signal: string): void => {
    logger.info('server', { message: `Received ${signal}, shutting down` });
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (error) => {
    logger.error('server', { message: 'Uncaught exception', error: error.message });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('server', {
      message: 'Unhandled rejection',
      error: reason instanceof Error ? reason.message : String(reason),
    });
    process.exit(1);
  });
}
