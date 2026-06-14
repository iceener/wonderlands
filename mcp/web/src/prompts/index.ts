import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { analyzePrompt } from './analyze.prompt.js';
import { greetingPrompt } from './greeting.prompt.js';

/**
 * Register all prompts with the MCP server.
 *
 * Prompts are templates that help users formulate requests.
 * They can include arguments that customize the generated messages.
 *
 * Prompt handlers receive:
 * - args: The prompt arguments
 * - extra: SDK context (includes signal for cancellation)
 */
export function registerPrompts(server: McpServer): void {
  // Greeting prompt - simple demonstration
  server.registerPrompt(
    greetingPrompt.name,
    {
      title: 'Greeting Prompt',
      description: greetingPrompt.description,
      argsSchema: greetingPrompt.argsSchema.shape,
    },
    greetingPrompt.handler,
  );

  // Analyze prompt - demonstrates completable() for autocompletion
  server.registerPrompt(
    analyzePrompt.name,
    {
      title: 'Analysis Prompt',
      description: analyzePrompt.description,
      // Note: argsSchema uses completable() wrapper for the 'topic' field
      argsSchema: analyzePrompt.argsSchema,
    },
    analyzePrompt.handler,
  );
}

/**
 * Export prompts for testing or programmatic access
 */
export const prompts = {
  greeting: greetingPrompt,
  analyze: analyzePrompt,
};
