import { describe, expect, test } from 'bun:test';
import {
  addLineNumbers,
  deleteLines,
  extractLines,
  getContextLines,
  insertAfterLine,
  insertBeforeLine,
  parseLineRange,
  replaceLines,
} from '../../src/lib/lines.js';

const FIVE_LINES = 'line1\nline2\nline3\nline4\nline5';

describe('line utilities', () => {
  test('parses valid ranges and rejects malformed or reversed ranges', () => {
    const cases: Array<[string, { start: number; end: number } | null]> = [
      ['10', { start: 10, end: 10 }],
      [' 10-15 ', { start: 10, end: 15 }],
      ['abc', null],
      ['10-', null],
      ['-15', null],
      ['15-10', null],
    ];

    for (const [input, expected] of cases) {
      expect(parseLineRange(input)).toEqual(expected);
    }
  });

  test('extracts requested lines and reports clamped bounds', () => {
    const cases = [
      { start: 2, end: 2, text: 'line2', actualStart: 2, actualEnd: 2 },
      { start: 2, end: 4, text: 'line2\nline3\nline4', actualStart: 2, actualEnd: 4 },
      { start: 1, end: 100, text: FIVE_LINES, actualStart: 1, actualEnd: 5 },
      { start: 100, end: 105, text: '', actualStart: 100, actualEnd: 5 },
    ];

    for (const { start, end, ...expected } of cases) {
      expect(extractLines(FIVE_LINES, start, end)).toEqual(expected);
    }
    expect(extractLines('line1\r\nline2', 2, 2).text).toContain('line2');
  });

  test('numbers lines from the requested offset with aligned widths', () => {
    expect(addLineNumbers('a\nb\nc')).toBe('1|a\n2|b\n3|c');
    expect(addLineNumbers('a\nb', 10)).toBe('10|a\n11|b');
    expect(addLineNumbers(Array(100).fill('x').join('\n'))).toMatch(/^  1\|x[\s\S]*100\|x$/);
  });

  test('replaces single, ranged, and boundary lines', () => {
    const cases: Array<[number, number, string, string]> = [
      [3, 3, 'NEW', 'line1\nline2\nNEW\nline4\nline5'],
      [2, 4, 'REPLACED', 'line1\nREPLACED\nline5'],
      [2, 2, 'new1\nnew2', 'line1\nnew1\nnew2\nline3\nline4\nline5'],
      [1, 1, 'FIRST', 'FIRST\nline2\nline3\nline4\nline5'],
      [5, 5, 'LAST', 'line1\nline2\nline3\nline4\nLAST'],
    ];

    for (const [start, end, replacement, expected] of cases) {
      expect(replaceLines(FIVE_LINES, start, end, replacement)).toBe(expected);
    }
    expect(replaceLines('line1\nline2\n', 2, 2, 'new')).toBe('line1\nnew\n');
  });

  test('inserts single and multiline content before or after boundaries', () => {
    const content = 'line1\nline2\nline3';
    expect(insertBeforeLine(content, 2, 'INSERTED')).toBe('line1\nINSERTED\nline2\nline3');
    expect(insertBeforeLine(content, 1, 'a\nb')).toBe('a\nb\nline1\nline2\nline3');
    expect(insertAfterLine(content, 2, 'INSERTED')).toBe('line1\nline2\nINSERTED\nline3');
    expect(insertAfterLine(content, 3, 'LAST')).toBe('line1\nline2\nline3\nLAST');
  });

  test('deletes ranges and returns bounded context around target lines', () => {
    const deletions: Array<[number, number, string]> = [
      [3, 3, 'line1\nline2\nline4\nline5'],
      [2, 4, 'line1\nline5'],
      [1, 5, ''],
    ];
    for (const [start, end, expected] of deletions) {
      expect(deleteLines(FIVE_LINES, start, end)).toBe(expected);
    }

    const content = `${FIVE_LINES}\nline6\nline7`;
    expect(getContextLines(content, 4, 2, 2)).toEqual({
      before: ['line2', 'line3'],
      after: ['line5', 'line6'],
    });
    expect(getContextLines(content, 1, 2, 2)).toEqual({ before: [], after: ['line2', 'line3'] });
    expect(getContextLines(content, 7, 2, 2)).toEqual({ before: ['line5', 'line6'], after: [] });
  });
});
