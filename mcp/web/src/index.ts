#!/usr/bin/env node
/**
 * MCP Stdio Server Entry Point
 *
 * This server communicates via stdin/stdout using the MCP protocol.
 * It's designed to be spawned by MCP clients like Claude Desktop, Cursor, etc.
 *
 * Usage:
 *   bun run src/index.ts
 *   node dist/index.js
 *
 * Environment variables:
 *   MCP_NAME        - Server name (default: mcp-stdio-server)
 *   MCP_VERSION     - Server version (default: 1.0.0)
 *   MCP_INSTRUCTIONS - Instructions for LLM
 *   LOG_LEVEL       - debug | info | warning | error (default: info)
 *   API_KEY         - Optional API key for external services
 *   API_URL         - Optional API base URL
 */

import { buildServer, runStdioServer } from '@wonderlands/mcp-shared';
import { config } from './config/env.js';
import { registerPrompts } from './prompts/index.js';
import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';

// Build the MCP server
const server = buildServer({
  name: config.NAME,
  version: config.VERSION,
  instructions: config.INSTRUCTIONS,
  registerTools,
  registerPrompts,
  registerResources,
});

// Connect to stdio and wire up the standard lifecycle (logging, graceful
// shutdown, uncaught error handling).
runStdioServer(server, { name: config.NAME, version: config.VERSION }).catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
