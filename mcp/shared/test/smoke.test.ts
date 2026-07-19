/**
 * Smoke tests for @wonderlands/mcp-shared.
 *
 * These cover the pieces genuinely shared between the standalone stdio MCP
 * servers (mcp/web, mcp/files-mcp): capabilities, the server builder, and
 * the logger/error utilities. Per-server behavior (tools, prompts,
 * resources, config) is exercised by each server's own test suite - it is
 * intentionally not duplicated here.
 */

import { describe, expect, test } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildCapabilities } from '../src/core/capabilities.js';
import { buildServer } from '../src/core/server.js';
import {
  assertTool,
  cancelledError,
  ToolError,
  ToolErrorCodes,
  toolError,
  validationError,
  wrapHandler,
} from '../src/utils/errors.js';
import { logger } from '../src/utils/logger.js';

describe('buildCapabilities', () => {
  test('declares tools, prompts, resources, and logging support', () => {
    const capabilities = buildCapabilities();

    expect(capabilities).toEqual({
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
      logging: {},
    });
  });
});

describe('buildServer', () => {
  test('creates an McpServer and invokes the supplied registrars', () => {
    const calls: string[] = [];

    const server = buildServer({
      name: 'smoke-test-server',
      version: '0.0.0',
      instructions: 'test instructions',
      registerTools: () => calls.push('tools'),
      registerPrompts: () => calls.push('prompts'),
      registerResources: () => calls.push('resources'),
    });

    expect(server).toBeInstanceOf(McpServer);
    expect(calls).toEqual(['tools', 'prompts', 'resources']);
  });

  test('does not throw when registrars are omitted', () => {
    expect(() => buildServer({ name: 'smoke-test-server-2', version: '0.0.0' })).not.toThrow();
  });
});

describe('logger', () => {
  test('exposes debug/info/warning/error without a connected server', () => {
    expect(() => logger.debug('smoke', { message: 'debug message' })).not.toThrow();
    expect(() => logger.info('smoke', { message: 'info message' })).not.toThrow();
    expect(() => logger.warning('smoke', { message: 'warning message' })).not.toThrow();
    expect(() => logger.error('smoke', { message: 'error message' })).not.toThrow();
  });
});

describe('error utilities', () => {
  test('toolError produces a structured error CallToolResult', () => {
    const result = toolError('boom', ToolErrorCodes.NOT_FOUND, { id: 1 });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('NOT_FOUND');
    expect(text).toContain('boom');
  });

  test('validationError formats zod-style issues', () => {
    const result = validationError([{ path: ['name'], message: 'Required' }]);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('name');
    expect(text).toContain('Required');
  });

  test('cancelledError returns a plain cancellation result', () => {
    const result = cancelledError();
    expect(result.isError).toBe(true);
  });

  test('wrapHandler converts thrown ToolError into an error result', async () => {
    const handler = wrapHandler(async () => {
      throw new ToolError('nope', ToolErrorCodes.FORBIDDEN);
    });

    const result = await handler(undefined);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('FORBIDDEN');
  });

  test('wrapHandler converts unexpected errors into internal errors', async () => {
    const handler = wrapHandler(async () => {
      throw new Error('unexpected');
    });

    const result = await handler(undefined);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('INTERNAL_ERROR');
  });

  test('assertTool throws a ToolError when the condition is false', () => {
    expect(() => assertTool(false, 'must be true', ToolErrorCodes.VALIDATION)).toThrow(ToolError);
    expect(() => assertTool(true, 'must be true')).not.toThrow();
  });
});
