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

describe('@wonderlands/mcp-shared', () => {
  test('declares the complete shared capability set', () => {
    expect(buildCapabilities()).toEqual({
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
      logging: {},
    });
  });

  test('builds an MCP server and invokes every supplied registrar in order', () => {
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

  test('supports omitted registrars and disconnected logger methods as no-ops', () => {
    expect(() => buildServer({ name: 'minimal-server', version: '0.0.0' })).not.toThrow();
    expect(() => {
      logger.debug('smoke', { message: 'debug message' });
      logger.info('smoke', { message: 'info message' });
      logger.warning('smoke', { message: 'warning message' });
      logger.error('smoke', { message: 'error message' });
    }).not.toThrow();
  });

  test('formats structured, validation, and cancellation errors', () => {
    const structured = toolError('boom', ToolErrorCodes.NOT_FOUND, { id: 1 });
    const validation = validationError([{ path: ['items', 0, 'name'], message: 'Required' }]);
    const cancelled = cancelledError('Stopped by caller');

    expect(structured.isError).toBe(true);
    expect((structured.content[0] as { text: string }).text).toContain(
      'Error [NOT_FOUND]: boom\n\nDetails: {\n  "id": 1\n}',
    );
    expect((validation.content[0] as { text: string }).text).toContain('items.0.name: Required');
    expect(cancelled).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Stopped by caller' }],
    });
  });

  test('wrapHandler preserves thrown ToolError code and details', async () => {
    const handler = wrapHandler(async () => {
      throw new ToolError('nope', ToolErrorCodes.FORBIDDEN, { resource: 'secret' });
    });
    const result = await handler(undefined);
    const text = (result.content[0] as { text: string }).text;

    expect(result.isError).toBe(true);
    expect(text).toContain('FORBIDDEN');
    expect(text).toContain('secret');
  });

  test('wrapHandler converts unexpected thrown values to internal errors', async () => {
    for (const thrown of [new Error('unexpected'), 'string failure']) {
      const handler = wrapHandler(async () => {
        throw thrown;
      });
      const result = await handler(undefined);
      const text = (result.content[0] as { text: string }).text;

      expect(result.isError).toBe(true);
      expect(text).toContain('INTERNAL_ERROR');
      expect(text).toContain(thrown instanceof Error ? thrown.message : thrown);
    }
  });

  test('assertTool narrows truthy values and throws structured failures', () => {
    expect(() => assertTool(true, 'must be true')).not.toThrow();
    expect(() =>
      assertTool(false, 'must be true', ToolErrorCodes.VALIDATION, { field: 'enabled' }),
    ).toThrow(ToolError);

    try {
      assertTool(false, 'must be true', ToolErrorCodes.VALIDATION, { field: 'enabled' });
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      expect(error).toEqual(
        expect.objectContaining({
          message: 'must be true',
          code: ToolErrorCodes.VALIDATION,
          details: { field: 'enabled' },
        }),
      );
    }
  });
});
