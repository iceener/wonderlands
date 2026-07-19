/**
 * fs_search Tool
 *
 * Find files by name and search content within files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  createIgnoreMatcherForDir,
  findMatches,
  getContextLines,
  getMounts,
  isTextFile,
  matchesGlob,
  matchesType,
  type MatchResult,
  type PatternMode,
  resolvePath as resolveVirtualPath,
  searchFiles,
  shouldExclude,
  UnsafeRegexError,
  validatePathChain,
} from '../lib/index.js';
import type { HandlerExtra } from '../types/index.js';

// ─────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────

export const fsSearchInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe('Starting directory. Use "." for all mounts, or "vault/" for specific mount.'),

    query: z
      .string()
      .min(1)
      .describe(
        'Search term for both filename matching (fuzzy) and content search. ' +
          'Examples: "config", "TODO", "function.*export" (with patternMode="regex").',
      ),

    target: z
      .enum(['all', 'filename', 'content'])
      .optional()
      .default('all')
      .describe('What to search. Default "all" (filename + content).'),

    patternMode: z
      .enum(['literal', 'regex', 'fuzzy'])
      .optional()
      .default('literal')
      .describe(
        'How to interpret query: "literal" (exact text), "regex" (regular expression), ' +
          '"fuzzy" (flexible whitespace). Default "literal".',
      ),

    caseInsensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe('Ignore case in content search. Default false.'),

    wholeWord: z
      .boolean()
      .optional()
      .default(false)
      .describe('Match whole words only for content search. Default false.'),

    multiline: z
      .boolean()
      .optional()
      .default(false)
      .describe('Allow content matches to span multiple lines. Default false.'),

    context: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .default(2)
      .describe('Number of lines of context to include before/after each content match. Default 2.'),

    types: z
      .array(z.string())
      .optional()
      .describe('Filter by file type or extension. Examples: ["ts", "md"].'),

    glob: z.string().optional().describe('Glob pattern filter. Example: "**/*.ts".'),

    exclude: z
      .array(z.string())
      .optional()
      .describe('Patterns to exclude. Example: ["**/test/**", "**/*.spec.ts"].'),

    depth: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe('Max directory traversal depth. Default 5.'),

    maxResults: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .default(100)
      .describe('Max results to return. Default 100.'),

    respectIgnore: z
      .boolean()
      .optional()
      .default(true)
      .describe('Respect .gitignore and .ignore files. Default true.'),
  })
  .passthrough();

export type FsSearchInput = z.infer<typeof fsSearchInputSchema>;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface FilenameMatch {
  path: string;
  score: number;
  matchIndices: number[];
}

interface ContentMatchCluster {
  line: number;
  endLine: number;
  matchCount: number;
  text: string;
  context: {
    before: string[];
    match: string[];
    after: string[];
  };
}

interface ContentFileEntry {
  path: string;
  matches: ContentMatchCluster[];
}

interface FsSearchResult {
  success: boolean;
  query: string;
  target: 'all' | 'filename' | 'content';
  results: {
    byFilename: FilenameMatch[];
    byContent: ContentFileEntry[];
  };
  stats: {
    filenameMatches: number;
    contentMatches: number;
    filesSearched: number;
  };
  truncated: boolean;
  error?: {
    code: string;
    message: string;
    recoveryHint?: string;
  };
  hint: string;
}

function emptyResults(): FsSearchResult['results'] {
  return { byFilename: [], byContent: [] };
}

function emptyStats(): FsSearchResult['stats'] {
  return { filenameMatches: 0, contentMatches: 0, filesSearched: 0 };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isRootPath(pathStr: string): boolean {
  const trimmed = pathStr.trim();
  return trimmed === '.' || trimmed === '' || trimmed === '/';
}

function joinVirtualPath(base: string, relative: string): string {
  if (!base || base === '.') return relative;
  if (!relative || relative === '.') return base;
  return path.join(base, relative);
}

/**
 * Group raw regex matches by line and build display clusters with context.
 * The raw match count (before grouping) is preserved separately so callers
 * can report an accurate total number of matches found.
 */
function clusterMatches(
  content: string,
  rawMatches: MatchResult[],
  contextLines: number,
): ContentMatchCluster[] {
  const lines = content.split('\n');
  const byLine = new Map<number, MatchResult[]>();

  for (const match of rawMatches) {
    const group = byLine.get(match.line);
    if (group) {
      group.push(match);
    } else {
      byLine.set(match.line, [match]);
    }
  }

  const sortedLines = Array.from(byLine.keys()).sort((a, b) => a - b);
  const clusters: ContentMatchCluster[] = [];

  for (const line of sortedLines) {
    const group = byLine.get(line);
    if (!group) continue;

    // A single match may span multiple lines (e.g. multiline mode).
    let endLine = line;
    for (const match of group) {
      const newlineCount = (match.text.match(/\n/g) ?? []).length;
      endLine = Math.max(endLine, line + newlineCount);
    }

    const { before, after } = getContextLines(content, line, contextLines, contextLines);
    const matchLines = lines.slice(line - 1, endLine);

    clusters.push({
      line,
      endLine,
      matchCount: group.length,
      text: (lines[line - 1] ?? '').trim(),
      context: { before, match: matchLines, after },
    });
  }

  return clusters;
}

async function searchContentInFile(
  content: string,
  query: string,
  options: {
    patternMode: PatternMode;
    multiline: boolean;
    wholeWord: boolean;
    caseInsensitive: boolean;
    maxMatches: number;
    contextLines: number;
  },
): Promise<{ clusters: ContentMatchCluster[]; rawCount: number }> {
  try {
    const rawMatches = findMatches(content, query, options.patternMode, {
      multiline: options.multiline,
      wholeWord: options.wholeWord,
      caseInsensitive: options.caseInsensitive,
      maxMatches: options.maxMatches,
    });

    return {
      clusters: clusterMatches(content, rawMatches, options.contextLines),
      rawCount: rawMatches.length,
    };
  } catch (err) {
    if (err instanceof UnsafeRegexError) {
      return { clusters: [], rawCount: 0 };
    }
    throw err;
  }
}

const SEARCH_CONCURRENCY = 10;

interface FileToSearch {
  absPath: string;
  relPath: string;
}

interface DirectoryContentSearchResult {
  files: ContentFileEntry[];
  totalMatches: number;
  filesSearched: number;
}

async function searchContentInDirectory(
  absPath: string,
  virtualPath: string,
  options: {
    query: string;
    patternMode: PatternMode;
    multiline: boolean;
    wholeWord: boolean;
    caseInsensitive: boolean;
    depth: number;
    types?: string[];
    glob?: string;
    exclude?: string[];
    respectIgnore: boolean;
    maxResults: number;
    contextLines: number;
  },
): Promise<DirectoryContentSearchResult> {
  // Phase 1: Collect all files to search
  const filesToSearch: FileToSearch[] = [];
  const MAX_FILES_TO_COLLECT = 10_000;

  const ignoreMatcher = options.respectIgnore ? await createIgnoreMatcherForDir(absPath) : null;

  async function collectFiles(dir: string, relDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > options.depth || filesToSearch.length >= MAX_FILES_TO_COLLECT) {
      return;
    }

    let items: string[];
    try {
      items = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const item of items) {
      if (filesToSearch.length >= MAX_FILES_TO_COLLECT) break;

      const itemPath = path.join(dir, item);
      const itemRelPath = relDir ? path.join(relDir, item) : item;

      if (ignoreMatcher?.isIgnored(itemRelPath)) continue;
      if (options.exclude && shouldExclude(itemRelPath, options.exclude)) continue;

      try {
        const stat = await fs.stat(itemPath);

        if (stat.isDirectory()) {
          if (currentDepth < options.depth) {
            await collectFiles(itemPath, itemRelPath, currentDepth + 1);
          }
        } else if (stat.isFile() && isTextFile(itemPath)) {
          if (options.types && options.types.length > 0) {
            if (!matchesType(item, options.types)) continue;
          }
          if (options.glob && !matchesGlob(itemRelPath, options.glob)) continue;

          filesToSearch.push({ absPath: itemPath, relPath: itemRelPath });
        }
      } catch {
        // Skip errors
      }
    }
  }

  await collectFiles(absPath, '', 1);

  // Phase 2: Search files concurrently
  const resultFiles: ContentFileEntry[] = [];
  let totalMatches = 0;
  let filesSearched = 0;

  const processFile = async (
    file: FileToSearch,
  ): Promise<{ entry: ContentFileEntry | null; rawCount: number }> => {
    try {
      const content = await fs.readFile(file.absPath, 'utf8');
      const filePath = joinVirtualPath(virtualPath, file.relPath);
      const { clusters, rawCount } = await searchContentInFile(content, options.query, {
        patternMode: options.patternMode,
        multiline: options.multiline,
        wholeWord: options.wholeWord,
        caseInsensitive: options.caseInsensitive,
        maxMatches: options.maxResults,
        contextLines: options.contextLines,
      });

      if (clusters.length === 0) {
        return { entry: null, rawCount: 0 };
      }

      return { entry: { path: filePath, matches: clusters }, rawCount };
    } catch {
      return { entry: null, rawCount: 0 };
    }
  };

  // Process in concurrent batches
  for (
    let i = 0;
    i < filesToSearch.length && totalMatches < options.maxResults;
    i += SEARCH_CONCURRENCY
  ) {
    const batch = filesToSearch.slice(i, i + SEARCH_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processFile));

    for (const { entry, rawCount } of batchResults) {
      filesSearched++;
      if (entry) {
        resultFiles.push(entry);
        totalMatches += rawCount;
      }
      if (totalMatches >= options.maxResults) break;
    }
  }

  return { files: resultFiles, totalMatches, filesSearched };
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

export const fsSearchTool = {
  name: 'fs_search',
  description: `Find files by name and search file content.

SEARCH MODES:
- target="filename": Find files by name (fuzzy match)
- target="content": Search text inside files
- target="all" (default): Both filename and content search

PATTERN MODES (for content search):
- literal (default): Exact text match
- regex: Regular expression. Use "foo|bar" for OR search
- fuzzy: Flexible whitespace matching

EXAMPLES:
- Find files: { path: ".", query: "config" }
- Search content: { path: ".", query: "TODO", target: "content" }
- Regex OR: { path: ".", query: "error|warning", patternMode: "regex" }

WORKFLOW:
1. fs_search to locate files/content
2. fs_read to inspect matches and get checksum
3. fs_write to make edits`,

  inputSchema: fsSearchInputSchema,

  handler: async (args: unknown, _extra: HandlerExtra): Promise<CallToolResult> => {
    const parsed = fsSearchInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          },
        ],
      };
    }

    const input = parsed.data;
    const target = input.target ?? 'all';
    const depth = input.depth ?? 5;
    const maxResults = input.maxResults ?? 100;

    // Early validation: check regex safety for content search
    if ((target === 'all' || target === 'content') && input.patternMode === 'regex') {
      const { isUnsafeRegex } = await import('../lib/index.js');
      if (isUnsafeRegex(input.query)) {
        const result: FsSearchResult = {
          success: false,
          query: input.query,
          target,
          results: emptyResults(),
          stats: emptyStats(),
          truncated: false,
          error: {
            code: 'UNSAFE_REGEX',
            message: `Regex pattern may cause catastrophic backtracking: "${input.query.slice(0, 50)}${input.query.length > 50 ? '...' : ''}"`,
          },
          hint: 'Simplify your regex pattern. Avoid nested quantifiers like (a+)+.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }

    const files: FilenameMatch[] = [];
    const contentFiles: ContentFileEntry[] = [];
    let contentMatchCount = 0;
    let filesSearchedCount = 0;

    // Determine search paths
    let searchPaths: { absPath: string; virtualPath: string }[] = [];

    if (isRootPath(input.path)) {
      const mounts = getMounts();
      searchPaths = mounts.map((m) => ({ absPath: m.absolutePath, virtualPath: m.name }));
    } else {
      const resolved = resolveVirtualPath(input.path);
      if (!resolved.ok) {
        const mounts = getMounts();
        const mountExample = mounts[0]?.name ?? 'vault';
        const result: FsSearchResult = {
          success: false,
          query: input.query,
          target,
          results: emptyResults(),
          stats: emptyStats(),
          truncated: false,
          error: { code: 'OUT_OF_SCOPE', message: resolved.error },
          hint: `Path must be within a mount. Example: "${mountExample}/". Use fs_read(".") to see mounts.`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      const { absolutePath, virtualPath, mount } = resolved.resolved;

      // Security: Validate symlinks
      const symlinkCheck = await validatePathChain(absolutePath, mount);
      if (!symlinkCheck.ok) {
        const result: FsSearchResult = {
          success: false,
          query: input.query,
          target,
          results: emptyResults(),
          stats: emptyStats(),
          truncated: false,
          error: { code: 'SYMLINK_ESCAPE', message: symlinkCheck.error },
          hint: 'Symlinks pointing outside the mounted directory are not allowed.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      try {
        await fs.stat(absolutePath);
      } catch {
        const result: FsSearchResult = {
          success: false,
          query: input.query,
          target,
          results: emptyResults(),
          stats: emptyStats(),
          truncated: false,
          error: { code: 'NOT_FOUND', message: `Path does not exist: ${virtualPath}` },
          hint: 'Use fs_read on the parent directory to see what exists.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      searchPaths = [{ absPath: absolutePath, virtualPath }];
    }

    // Filename search
    if (target === 'all' || target === 'filename') {
      for (const { absPath, virtualPath } of searchPaths) {
        if (files.length >= maxResults) break;

        const found = await searchFiles(absPath, input.query, {
          maxResults: maxResults - files.length,
          includeDirectories: false,
          respectIgnore: input.respectIgnore,
          exclude: input.exclude,
          maxDepth: depth,
        });

        for (const item of found) {
          if (files.length >= maxResults) break;

          if (input.types?.length && !matchesType(item.relativePath, input.types)) continue;
          if (input.glob && !matchesGlob(item.relativePath, input.glob)) continue;

          const fullPath = joinVirtualPath(virtualPath, item.relativePath);
          files.push({
            path: fullPath,
            score: item.score,
            matchIndices: item.matchIndices,
          });
        }
      }
    }

    // Content search
    if (target === 'all' || target === 'content') {
      for (const { absPath, virtualPath } of searchPaths) {
        if (contentMatchCount >= maxResults) break;

        const dirResult = await searchContentInDirectory(absPath, virtualPath, {
          query: input.query,
          patternMode: input.patternMode as PatternMode,
          multiline: input.multiline,
          wholeWord: input.wholeWord,
          caseInsensitive: input.caseInsensitive,
          depth,
          types: input.types,
          glob: input.glob,
          exclude: input.exclude,
          respectIgnore: input.respectIgnore,
          maxResults: maxResults - contentMatchCount,
          contextLines: input.context,
        });

        contentFiles.push(...dirResult.files);
        contentMatchCount += dirResult.totalMatches;
        filesSearchedCount += dirResult.filesSearched;
      }
    }

    // Check if results were truncated
    const truncated = files.length >= maxResults || contentMatchCount >= maxResults;

    // Build result
    const result: FsSearchResult = {
      success: true,
      query: input.query,
      target,
      results: {
        byFilename: files,
        byContent: contentFiles,
      },
      stats: {
        filenameMatches: files.length,
        contentMatches: contentMatchCount,
        filesSearched: filesSearchedCount,
      },
      truncated,
      hint: buildHint(target, files.length, contentMatchCount, truncated, maxResults),
    };

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};

function buildHint(
  target: string,
  fileCount: number,
  contentCount: number,
  truncated: boolean,
  maxResults: number,
): string {
  const parts: string[] = [];

  // What we found
  if (target === 'filename') {
    parts.push(fileCount > 0 ? `Found ${fileCount} file(s).` : 'No files found.');
  } else if (target === 'content') {
    parts.push(
      contentCount > 0 ? `Found ${contentCount} content match(es).` : 'No content matches found.',
    );
  } else {
    const filePart = fileCount > 0 ? `${fileCount} file(s)` : 'no files';
    const contentPart =
      contentCount > 0 ? `${contentCount} content match(es)` : 'no content matches';
    parts.push(`Found ${filePart} and ${contentPart}.`);
  }

  // Truncation warning with explicit guidance
  if (truncated) {
    const suggestedMax = Math.min(maxResults * 2, 1000);
    parts.push(
      `Results limited to ${maxResults}. To see more: use maxResults=${suggestedMax}, or narrow search with types/glob/exclude filters.`,
    );
  }

  // Next step guidance
  if (fileCount > 0 || contentCount > 0) {
    parts.push('Use fs_read on a specific path to see full content and get checksum for editing.');
  }

  return parts.join(' ');
}
