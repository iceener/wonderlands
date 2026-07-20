import { FIXTURES_PATH } from '../setup.js';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fsManageTool } from '../../src/tools/fs-manage.tool.js';

const TEST_DIR = path.join(FIXTURES_PATH, 'manage-tests');

async function runFsManage(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsManageTool.handler(args, {} as never);
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

describe('fs_manage workflows', () => {
  test('creates nested directories and returns structured stats', async () => {
    const created = await runFsManage({
      operation: 'mkdir',
      path: 'manage-tests/nested/dir',
      recursive: true,
    });
    const stat = await runFsManage({ operation: 'stat', path: 'manage-tests/nested/dir' });

    expect(created).toEqual(
      expect.objectContaining({ success: true, operation: 'mkdir', path: 'manage-tests/nested/dir' }),
    );
    expect(stat).toEqual(
      expect.objectContaining({
        success: true,
        operation: 'stat',
        stat: expect.objectContaining({
          size: expect.any(Number),
          modified: expect.any(String),
          created: expect.any(String),
          isDirectory: true,
        }),
        hint: expect.any(String),
      }),
    );
  });

  test('renames and then moves a file without changing its content', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'source.txt'), 'content');
    await fs.mkdir(path.join(TEST_DIR, 'dest'));

    const renamed = await runFsManage({
      operation: 'rename',
      path: 'manage-tests/source.txt',
      target: 'manage-tests/renamed.txt',
    });
    const moved = await runFsManage({
      operation: 'move',
      path: 'manage-tests/renamed.txt',
      target: 'manage-tests/dest/moved.txt',
    });

    expect(renamed.success).toBe(true);
    expect(moved.success).toBe(true);
    expect(await fs.readFile(path.join(TEST_DIR, 'dest/moved.txt'), 'utf8')).toBe('content');
    await expect(fs.access(path.join(TEST_DIR, 'source.txt'))).rejects.toThrow();
  });

  test('copies a file and preserves both source and destination bytes', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'source.txt'), 'copy content');
    const result = await runFsManage({
      operation: 'copy',
      path: 'manage-tests/source.txt',
      target: 'manage-tests/copied.txt',
    });

    expect(result).toEqual(
      expect.objectContaining({ success: true, operation: 'copy', target: 'manage-tests/copied.txt' }),
    );
    expect(await Promise.all([
      fs.readFile(path.join(TEST_DIR, 'source.txt'), 'utf8'),
      fs.readFile(path.join(TEST_DIR, 'copied.txt'), 'utf8'),
    ])).toEqual(['copy content', 'copy content']);
  });

  test('deletes files and non-empty directories only when recursive is requested', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'file.txt'), 'content');
    await fs.mkdir(path.join(TEST_DIR, 'directory'));
    await fs.writeFile(path.join(TEST_DIR, 'directory/nested.txt'), 'nested');

    const fileResult = await runFsManage({ operation: 'delete', path: 'manage-tests/file.txt' });
    const directoryResult = await runFsManage({
      operation: 'delete',
      path: 'manage-tests/directory',
      recursive: true,
    });

    expect(fileResult.success).toBe(true);
    expect(directoryResult.success).toBe(true);
    await expect(fs.access(path.join(TEST_DIR, 'file.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(TEST_DIR, 'directory'))).rejects.toThrow();
  });
});
