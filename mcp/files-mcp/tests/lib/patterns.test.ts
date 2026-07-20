import { describe, expect, test } from 'bun:test';
import {
  buildPattern,
  buildPresetPattern,
  findMatches,
  findPresetMatches,
  isUnsafeRegex,
  UnsafeRegexError,
} from '../../src/lib/patterns.js';

const CONTENT = `# Title
This is line 2.
This is line 3 with keyword here.
Another line.
And keyword again on line 5.`;

describe('pattern behavior', () => {
  test('builds literal, regex, and fuzzy patterns', () => {
    const cases = [
      {
        regex: buildPattern('array.map((x) => x * 2)', 'literal'),
        matches: 'array.map((x) => x * 2)',
        misses: 'arrayXmap((x) => x * 2)',
      },
      {
        regex: buildPattern('\\d{4}-\\d{2}-\\d{2}', 'regex'),
        matches: '2024-12-03',
        misses: 'not-a-date',
      },
      {
        regex: buildPattern('function   doSomething', 'fuzzy'),
        matches: 'function \t doSomething',
        misses: 'function-doSomething',
      },
    ];

    for (const { regex, matches, misses } of cases) {
      expect(regex.test(matches)).toBe(true);
      regex.lastIndex = 0;
      expect(regex.test(misses)).toBe(false);
    }
  });

  test('applies case, whole-word, and multiline options', () => {
    const cases = [
      [buildPattern('react', 'literal', { caseInsensitive: true }), 'React', true],
      [buildPattern('React', 'literal'), 'react', false],
      [buildPattern('Java', 'literal', { wholeWord: true }), 'JavaScript', false],
      [buildPattern('Java', 'literal', { wholeWord: true }), 'Java is cool', true],
      [buildPattern('start.*end', 'regex', { multiline: true }), 'start\nmiddle\nend', true],
    ] as const;

    for (const [regex, content, expected] of cases) {
      expect(regex.test(content)).toBe(expected);
    }
  });

  test('rejects regexes with dangerous backtracking shapes', () => {
    for (const pattern of ['(a+)+', 'a**', 'x'.repeat(1001)]) {
      expect(isUnsafeRegex(pattern)).toBe(true);
      expect(() => buildPattern(pattern, 'regex')).toThrow(UnsafeRegexError);
    }
    expect(isUnsafeRegex('line\\s+\\d+')).toBe(false);
  });

  test('finds literal and regex matches with correct positions', () => {
    const literal = findMatches(CONTENT, 'keyword', 'literal');
    expect(literal).toEqual([
      expect.objectContaining({ text: 'keyword', line: 3, column: 21 }),
      expect.objectContaining({ text: 'keyword', line: 5, column: 5 }),
    ]);

    const regex = findMatches(CONTENT, 'line \\d', 'regex');
    expect(regex.map(({ line }) => line)).toEqual([2, 3, 5]);
    expect(findMatches(CONTENT, 'missing', 'literal')).toEqual([]);
  });

  test('honors match limits and captures multiline text', () => {
    expect(findMatches(CONTENT, 'line', 'literal', { maxMatches: 2 })).toHaveLength(2);

    const matches = findMatches('```js\nconst x = 1;\n```', '```.*```', 'regex', {
      multiline: true,
    });
    expect(matches).toEqual([
      expect.objectContaining({ text: '```js\nconst x = 1;\n```', line: 1, column: 1 }),
    ]);
  });

  test('treats regex punctuation literally and supports unicode content', () => {
    const cases: Array<[string, string, number]> = [
      ['Price: $100.00 (USD)', '$100.00', 8],
      ['Hello 世界! 🚀 Emoji test', '世界', 7],
      [`${'x'.repeat(10000)}FIND`, 'FIND', 10001],
    ];

    for (const [content, query, column] of cases) {
      expect(findMatches(content, query, 'literal')).toEqual([
        expect.objectContaining({ text: query, line: 1, column }),
      ]);
    }
  });

  test('uses representative Markdown presets for structured content', () => {
    const content = `---
title: Notes
---
# Heading
See [[Other Note|details]] and #learning/typescript.
- [ ] Review tests`;
    expect(buildPresetPattern('frontmatter').test(content)).toBe(true);

    const cases = [
      ['headings', 1],
      ['wikilinks', 1],
      ['tags', 1],
      ['tasks_open', 1],
    ] as const;

    for (const [preset, count] of cases) {
      expect(findPresetMatches(content, preset)).toHaveLength(count);
    }
  });
});
