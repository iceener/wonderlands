import '../setup.js';

import { describe, expect, test } from 'bun:test';
import { fsSearchTool } from '../../src/tools/fs-search.tool.js';

const KNOWLEDGE_FILE = 'vault/knowledge/programming-notes.md';

async function runFsSearch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsSearchTool.handler(args, {} as never);
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe('representative Obsidian searches', () => {
  test('finds wikilinks including aliases and heading links', async () => {
    const all = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '\\[\\[([^\\]|]+)(\\|[^\\]]+)?\\]\\]',
      patternMode: 'regex',
      target: 'content',
    });
    const structured = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '\\[\\[[^\\]]+(\\|[^\\]]+|#[^\\]]+)\\]\\]',
      patternMode: 'regex',
      target: 'content',
    });

    expect((all.stats as { contentMatches: number }).contentMatches).toBeGreaterThanOrEqual(5);
    expect((structured.stats as { contentMatches: number }).contentMatches).toBeGreaterThan(0);
  });

  test('finds inline and nested tags across a vault', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: '#[a-zA-Z][\\w/-]*',
      patternMode: 'regex',
      target: 'content',
      depth: 10,
    });

    expect(result.success).toBe(true);
    expect((result.stats as { contentMatches: number }).contentMatches).toBeGreaterThan(3);
  });

  test('finds a field inside multiline frontmatter', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '^---.*?tags:[\\s\\S]*?programming.*?---',
      patternMode: 'regex',
      multiline: true,
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect((result.stats as { contentMatches: number }).contentMatches).toBeGreaterThan(0);
  });

  test('finds incomplete Markdown tasks', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '- \\[ \\] .+',
      patternMode: 'regex',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect((result.stats as { contentMatches: number }).contentMatches).toBeGreaterThan(2);
  });
});
