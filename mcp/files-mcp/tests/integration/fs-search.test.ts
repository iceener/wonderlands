import '../setup.js';

import { describe, expect, test } from 'bun:test';
import { fsSearchTool } from '../../src/tools/fs-search.tool.js';

async function runFsSearch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsSearchTool.handler(args, {} as never);
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe('fs_search workflows', () => {
  test('finds filenames and applies glob filtering', async () => {
    const exact = await runFsSearch({
      path: 'vault',
      query: 'todo.md',
      target: 'filename',
      depth: 10,
    });
    const markdown = await runFsSearch({
      path: 'vault',
      query: 'md',
      target: 'filename',
      glob: '**/*.md',
      depth: 10,
    });

    expect(exact).toEqual(
      expect.objectContaining({
        success: true,
        query: 'todo.md',
        target: 'filename',
        results: expect.objectContaining({ byFilename: expect.any(Array), byContent: [] }),
        stats: expect.objectContaining({ filenameMatches: expect.any(Number) }),
        truncated: expect.any(Boolean),
        hint: expect.any(String),
      }),
    );
    expect(
      (exact.results as { byFilename: Array<{ path: string }> }).byFilename.some(({ path }) =>
        path.endsWith('todo.md'),
      ),
    ).toBe(true);
    expect(
      (markdown.results as { byFilename: Array<{ path: string }> }).byFilename.every(({ path }) =>
        path.endsWith('.md'),
      ),
    ).toBe(true);
  });

  test('returns exact literal matches with surrounding context', async () => {
    const result = await runFsSearch({
      path: 'vault/notes/todo.md',
      query: 'keyword',
      target: 'content',
      context: 2,
    });
    const contentResults = (result.results as {
      byContent: Array<{
        path: string;
        matches: Array<{
          line: number;
          text: string;
          context: { before: string[]; match: string[]; after: string[] };
        }>;
      }>;
    }).byContent;

    expect(result.success).toBe(true);
    expect(result.stats).toEqual(expect.objectContaining({ contentMatches: 2, filesSearched: 1 }));
    expect(contentResults[0]).toEqual(
      expect.objectContaining({ path: 'vault/notes/todo.md', matches: expect.any(Array) }),
    );
    expect(contentResults[0]?.matches[0]).toEqual(
      expect.objectContaining({ line: 13, text: expect.stringContaining('keyword') }),
    );
    expect(contentResults[0]?.matches[0]?.context.before.length).toBeGreaterThan(0);
    expect(contentResults[0]?.matches[0]?.context.after.length).toBeGreaterThan(0);
  });

  test('supports regex searches across fixture content', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'keyword\\s+(to|for)',
      target: 'content',
      patternMode: 'regex',
      depth: 10,
    });

    expect(result.success).toBe(true);
    expect((result.stats as { contentMatches: number }).contentMatches).toBeGreaterThan(0);
    expect((result.results as { byContent: unknown[] }).byContent.length).toBeGreaterThan(0);
  });

  test('returns successful empty result arrays when nothing matches', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'nonexistent-file.xyz',
      target: 'all',
      depth: 10,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        results: { byFilename: [], byContent: [] },
        stats: expect.objectContaining({ filenameMatches: 0, contentMatches: 0 }),
      }),
    );
  });
});
