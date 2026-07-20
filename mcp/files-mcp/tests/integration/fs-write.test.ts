import { FIXTURES_PATH } from '../setup.js';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fsReadTool } from '../../src/tools/fs-read.tool.js';
import { fsWriteTool } from '../../src/tools/fs-write.tool.js';

const TEST_DIR = path.join(FIXTURES_PATH, 'write-tests');
const ORIGINAL = 'line1\nline2\nline3\nline4\nline5';

async function runTool(
  tool: typeof fsReadTool | typeof fsWriteTool,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await tool.handler(args, {} as never);
  if (result.isError) {
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: (result.content[0] as { text: string }).text },
    };
  }
  return JSON.parse((result.content[0] as { text: string }).text);
}

beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

describe('fs_write workflows', () => {
  test('creates nested files with a checksum and readable output structure', async () => {
    const result = await runTool(fsWriteTool, {
      path: 'write-tests/deep/nested/file.md',
      operation: 'create',
      content: '# New File\n\nContent here.',
    });
    const read = await runTool(fsReadTool, { path: 'write-tests/deep/nested/file.md' });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        path: 'write-tests/deep/nested/file.md',
        operation: 'create',
        applied: true,
        result: expect.objectContaining({ newChecksum: expect.any(String) }),
        hint: expect.any(String),
      }),
    );
    expect(read).toEqual(expect.objectContaining({ success: true, type: 'file' }));
    expect(await fs.readFile(path.join(TEST_DIR, 'deep/nested/file.md'), 'utf8')).toBe(
      '# New File\n\nContent here.\n',
    );
  });

  test('rejects an existing destination and paths outside the sandbox', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'existing.md'), 'existing');
    const cases = [
      {
        args: { path: 'write-tests/existing.md', operation: 'create', content: 'replacement' },
        code: 'ALREADY_EXISTS',
      },
      {
        args: { path: '../../../etc/passwd', operation: 'create', content: 'malicious' },
        code: 'OUT_OF_SCOPE',
      },
    ];

    for (const { args, code } of cases) {
      const result = await runTool(fsWriteTool, args);
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe(code);
    }
    expect(await fs.readFile(path.join(TEST_DIR, 'existing.md'), 'utf8')).toBe('existing');
  });

  test('applies every line-based update action with exact resulting content', async () => {
    const cases = [
      {
        action: 'replace',
        lines: '3',
        content: 'REPLACED',
        expected: 'line1\nline2\nREPLACED\nline4\nline5\n',
      },
      {
        action: 'replace',
        lines: '2-4',
        content: 'first\nsecond',
        expected: 'line1\nfirst\nsecond\nline5\n',
      },
      {
        action: 'insert_before',
        lines: '3',
        content: 'INSERTED',
        expected: 'line1\nline2\nINSERTED\nline3\nline4\nline5\n',
      },
      {
        action: 'insert_after',
        lines: '3',
        content: 'INSERTED',
        expected: 'line1\nline2\nline3\nINSERTED\nline4\nline5\n',
      },
      {
        action: 'delete_lines',
        lines: '2-4',
        expected: 'line1\nline5\n',
      },
    ];

    for (const { expected, ...update } of cases) {
      const file = path.join(TEST_DIR, 'update.md');
      await fs.writeFile(file, ORIGINAL);
      const result = await runTool(fsWriteTool, {
        path: 'write-tests/update.md',
        operation: 'update',
        ...update,
      });
      expect(result.success).toBe(true);
      expect(await fs.readFile(file, 'utf8')).toBe(expected);
    }
  });

  test('accepts the current checksum and rejects stale writes', async () => {
    const file = path.join(TEST_DIR, 'checksum.md');
    await fs.writeFile(file, 'original');
    const read = await runTool(fsReadTool, { path: 'write-tests/checksum.md' });
    const checksum = (read.content as { checksum: string }).checksum;

    const stale = await runTool(fsWriteTool, {
      path: 'write-tests/checksum.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'stale update',
      checksum: 'wrong-checksum',
    });
    expect(stale.success).toBe(false);
    expect((stale.error as { code: string }).code).toBe('CHECKSUM_MISMATCH');
    expect(await fs.readFile(file, 'utf8')).toBe('original');

    const current = await runTool(fsWriteTool, {
      path: 'write-tests/checksum.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'current update',
      checksum,
    });
    expect(current.success).toBe(true);
  });

  test('returns a unified diff for applied updates', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'diff.md'), 'old content');
    const result = await runTool(fsWriteTool, {
      path: 'write-tests/diff.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'new content',
    });
    const diff = (result.result as { diff: string }).diff;

    expect(result).toEqual(expect.objectContaining({ success: true, applied: true }));
    expect(diff).toContain('-old content');
    expect(diff).toContain('+new content');
  });

  test('previews an update without mutating the file', async () => {
    const file = path.join(TEST_DIR, 'dry-run.md');
    await fs.writeFile(file, 'original bytes\n');
    const before = await fs.readFile(file);

    const result = await runTool(fsWriteTool, {
      path: 'write-tests/dry-run.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'modified',
      dryRun: true,
    });
    const after = await fs.readFile(file);
    const diff = (result.result as { diff: string }).diff;

    expect(result).toEqual(expect.objectContaining({ success: true, applied: false }));
    expect(diff).toContain('-original bytes');
    expect(diff).toContain('+modified');
    expect(after).toEqual(before);
  });

  test('converts missing files and invalid update shapes to errors', async () => {
    const cases = [
      {
        path: 'write-tests/missing.md',
        operation: 'update',
        action: 'replace',
        lines: '1',
        content: 'content',
      },
      {
        path: 'write-tests/missing.md',
        operation: 'update',
        action: 'replace',
        content: 'content',
      },
    ];

    for (const args of cases) {
      const result = await runTool(fsWriteTool, args);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }
  });
});
