import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FIXTURES_PATH } from '../setup.js';
import {
  getMounts,
  isSingleMount,
  resolvePath,
  toVirtualPath,
  validatePathChain,
  validateSymlinks,
} from '../../src/lib/paths.js';

const SECURITY_DIR = path.join(FIXTURES_PATH, 'path-security-tests');
const OUTSIDE_DIR = path.join(path.dirname(FIXTURES_PATH), 'files-mcp-outside-test');

beforeAll(async () => {
  await fs.mkdir(path.join(SECURITY_DIR, 'safe'), { recursive: true });
  await fs.mkdir(OUTSIDE_DIR, { recursive: true });
  await fs.writeFile(path.join(SECURITY_DIR, 'safe', 'inside.txt'), 'safe');
  await fs.writeFile(path.join(OUTSIDE_DIR, 'outside.txt'), 'outside');
  await fs.symlink(path.join(SECURITY_DIR, 'safe'), path.join(SECURITY_DIR, 'inside-link'));
  await fs.symlink(OUTSIDE_DIR, path.join(SECURITY_DIR, 'outside-link'));
});

afterAll(async () => {
  await fs.rm(SECURITY_DIR, { recursive: true, force: true });
  await fs.rm(OUTSIDE_DIR, { recursive: true, force: true });
});

describe('production path resolution', () => {
  test('resolves root, mount-prefixed, and single-mount-compatible paths', () => {
    const [mount] = getMounts();
    expect(mount).toBeDefined();
    expect(isSingleMount()).toBe(true);

    const root = resolvePath('.');
    const prefixed = resolvePath(`${mount?.name}/vault/notes/todo.md`);
    const compatible = resolvePath('vault/notes/todo.md');

    expect(root).toEqual({
      ok: true,
      resolved: expect.objectContaining({ absolutePath: FIXTURES_PATH, virtualPath: '.' }),
    });
    expect(prefixed).toEqual({
      ok: true,
      resolved: expect.objectContaining({
        absolutePath: path.join(FIXTURES_PATH, 'vault/notes/todo.md'),
        relativePath: 'vault/notes/todo.md',
      }),
    });
    expect(compatible).toEqual({
      ok: true,
      resolved: expect.objectContaining({
        absolutePath: path.join(FIXTURES_PATH, 'vault/notes/todo.md'),
        relativePath: 'vault/notes/todo.md',
        virtualPath: 'vault/notes/todo.md',
      }),
    });
  });

  test('rejects absolute paths and traversal through either separator', () => {
    for (const unsafePath of ['/etc/passwd', '../outside', 'vault/../outside', 'vault\\..\\outside']) {
      const result = resolvePath(unsafePath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Absolute paths|traversal|\.\./);
      }
    }
  });

  test('converts only absolute paths inside the configured mount to virtual paths', () => {
    const [mount] = getMounts();
    expect(toVirtualPath(FIXTURES_PATH)).toBe(mount?.name);
    expect(toVirtualPath(path.join(FIXTURES_PATH, 'vault/notes/todo.md'))).toBe(
      `${mount?.name}/vault/notes/todo.md`,
    );
    expect(toVirtualPath(path.join(OUTSIDE_DIR, 'outside.txt'))).toBeNull();
  });

  test('allows missing and internal paths but rejects a symlink outside the mount', async () => {
    const [mount] = getMounts();
    if (!mount) throw new Error('Expected a configured test mount');

    expect(await validateSymlinks(path.join(SECURITY_DIR, 'missing.txt'), mount)).toEqual({
      ok: true,
      realPath: path.join(SECURITY_DIR, 'missing.txt'),
    });
    expect(await validateSymlinks(path.join(SECURITY_DIR, 'inside-link'), mount)).toEqual({
      ok: true,
      realPath: path.join(SECURITY_DIR, 'safe'),
    });

    const escaped = await validateSymlinks(path.join(SECURITY_DIR, 'outside-link'), mount);
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) expect(escaped.error).toContain('points outside mount');
  });

  test('checks every existing component for nested symlink escapes', async () => {
    const [mount] = getMounts();
    if (!mount) throw new Error('Expected a configured test mount');

    expect(await validatePathChain(path.join(SECURITY_DIR, 'safe', 'inside.txt'), mount)).toEqual({
      ok: true,
    });
    const escaped = await validatePathChain(
      path.join(SECURITY_DIR, 'outside-link', 'outside.txt'),
      mount,
    );
    expect(escaped.ok).toBe(false);
  });
});
