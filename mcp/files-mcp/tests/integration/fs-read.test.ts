import { FIXTURES_PATH } from '../setup.js';

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fsReadTool } from '../../src/tools/fs-read.tool.js';

async function runFsRead(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsReadTool.handler(args, {} as never);
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe('fs_read workflows', () => {
  test('lists root and nested directories with depth and pagination structure', async () => {
    const root = await runFsRead({ path: '.', depth: 1 });
    const shallow = await runFsRead({ path: 'vault', depth: 1 });
    const deep = await runFsRead({ path: 'vault', depth: 5 });

    expect(root).toEqual(
      expect.objectContaining({
        success: true,
        path: '.',
        type: 'directory',
        entries: expect.any(Array),
        stats: expect.objectContaining({ returned: expect.any(Number), hasMore: expect.any(Boolean) }),
        hint: expect.any(String),
      }),
    );
    expect((deep.entries as unknown[]).length).toBeGreaterThanOrEqual(
      (shallow.entries as unknown[]).length,
    );
  });

  test('reads exact content ranges with line numbers and stable checksums', async () => {
    const full = await runFsRead({ path: 'vault/notes/todo.md' });
    const ranged = await runFsRead({ path: 'vault/notes/todo.md', lines: '3-5' });
    const repeated = await runFsRead({ path: 'vault/notes/todo.md' });
    const content = full.content as {
      text: string;
      checksum: string;
      totalLines: number;
      truncated: boolean;
    };

    expect(full).toEqual(
      expect.objectContaining({ success: true, type: 'file', hint: expect.any(String) }),
    );
    expect(content.text).toContain('1|# TODO List');
    expect(content.totalLines).toBeGreaterThan(10);
    expect(content.truncated).toBe(false);
    expect((repeated.content as { checksum: string }).checksum).toBe(content.checksum);
    expect(ranged.content).toEqual(
      expect.objectContaining({
        text: expect.stringContaining('3|## Today'),
        checksum: content.checksum,
        range: { start: 3, end: 5 },
      }),
    );
  });

  test('reports missing and traversal paths as structured errors', async () => {
    for (const unsafePath of ['nonexistent', '../../../etc/passwd']) {
      const result = await runFsRead({ path: unsafePath });
      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
          hint: expect.any(String),
        }),
      );
    }
  });

  test('returns an empty entry list for an empty directory', async () => {
    const emptyDir = path.join(FIXTURES_PATH, 'read-empty-test');
    await fs.mkdir(emptyDir, { recursive: true });
    try {
      const result = await runFsRead({ path: 'read-empty-test' });
      expect(result).toEqual(
        expect.objectContaining({ success: true, type: 'directory', entries: [] }),
      );
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  test('rejects binary content without leaking it as text', async () => {
    const binaryFile = path.join(FIXTURES_PATH, 'read-binary-test.bin');
    await fs.writeFile(binaryFile, Buffer.from([0x00, 0x01, 0x02]));
    try {
      const result = await runFsRead({ path: 'read-binary-test.bin' });
      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'NOT_TEXT' }),
        }),
      );
    } finally {
      await fs.rm(binaryFile, { force: true });
    }
  });

  test('filters directory results by type and glob', async () => {
    const result = await runFsRead({ path: 'vault', depth: 10, types: ['md'], glob: '**/*.md' });
    const entries = result.entries as Array<{ path: string; kind: string }>;

    expect(result.success).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.kind === 'directory' || entry.path.endsWith('.md'))).toBe(
      true,
    );
  });
});
