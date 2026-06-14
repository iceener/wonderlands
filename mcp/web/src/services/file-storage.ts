import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config, type OutputMode } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Result of saving content to file
 */
export interface SaveResult {
  filePath: string;
  url: string;
  title?: string;
}

/**
 * Options for saving content
 */
export interface SaveOptions {
  /** Override the default output directory */
  outputDir?: string;
  /** Override the default output mode */
  outputMode?: OutputMode;
  /** Operation type for directory naming */
  operationType: 'scrape' | 'search';
  /** Optional batch ID for grouping related files */
  batchId?: string;
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Sanitize a string for use as filename
 */
function sanitizeFilename(str: string): string {
  return str
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '-')
    .replace(/_+/g, '_')
    .substring(0, 100)
    .replace(/^[-_]+|[-_]+$/g, '');
}

/**
 * Generate a slug from URL path
 */
function pathToSlug(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (!path || path === '/') {
      return 'index';
    }

    // Remove leading/trailing slashes and convert to slug
    return sanitizeFilename(
      path
        .replace(/^\/|\/$/g, '')
        .replace(/\//g, '_')
        .replace(/\.[^.]+$/, ''), // Remove file extension
    );
  } catch {
    return 'page';
  }
}

/**
 * Generate a timestamp-based directory name
 * Format: YYYY-MM-DD/HH-mm-ss or just YYYY-MM-DD for batch operations
 */
function generateTimestampDir(includeTime: boolean = true): string {
  const now = new Date();
  const datePart = now.toISOString().split('T')[0]; // YYYY-MM-DD

  if (!includeTime) {
    return datePart ?? '';
  }

  const timePart =
    now.toISOString().split('T')[1]?.substring(0, 8).replace(/:/g, '-') ?? '00-00-00'; // HH-mm-ss
  return `${datePart}/${timePart}`;
}

/**
 * File storage service for saving scrape/search results as markdown files
 *
 * Directory structure:
 * - scrape: {outputDir}/scrape/{YYYY-MM-DD}/{domain}/{slug}.md
 * - search: {outputDir}/search/{YYYY-MM-DD}/{query-slug}/results.md
 */
export class FileStorage {
  private readonly defaultOutputDir: string;
  private readonly defaultOutputMode: OutputMode;

  constructor() {
    this.defaultOutputDir = config.OUTPUT_DIR;
    this.defaultOutputMode = config.OUTPUT_MODE;
  }

  /**
   * Check if we should save to file based on mode
   */
  shouldSaveToFile(options: SaveOptions): boolean {
    const mode = options.outputMode ?? this.defaultOutputMode;
    return mode === 'file';
  }

  /**
   * Get the output directory path
   */
  getOutputDir(options: SaveOptions): string {
    return options.outputDir ?? this.defaultOutputDir;
  }

  /**
   * Save scraped content to file
   */
  async saveScrapeResult(
    url: string,
    content: {
      markdown?: string;
      html?: string;
      title?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
    options: SaveOptions,
  ): Promise<SaveResult> {
    const outputDir = this.getOutputDir(options);
    const domain = extractDomain(url);
    const slug = pathToSlug(url);
    const dateDir = generateTimestampDir(false); // Just date for scrape

    // Build directory path: outputDir/scrape/YYYY-MM-DD/domain/
    const dirPath = join(outputDir, 'scrape', dateDir, domain);

    // Build filename
    const filename = `${slug}.md`;
    const filePath = join(dirPath, filename);

    // Build markdown content with frontmatter
    const markdownContent = this.buildMarkdownWithFrontmatter(url, content);

    // Ensure directory exists and write file
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, markdownContent, 'utf-8');

    logger.info('file-storage', {
      message: 'Saved scrape result',
      filePath,
      url,
    });

    return {
      filePath,
      url,
      title: content.title,
    };
  }

  /**
   * Save multiple scrape results (batch)
   */
  async saveBatchScrapeResults(
    results: Array<{
      url: string;
      markdown?: string;
      html?: string;
      title?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }>,
    options: SaveOptions,
  ): Promise<SaveResult[]> {
    const savedResults: SaveResult[] = [];

    for (const result of results) {
      try {
        const saved = await this.saveScrapeResult(
          result.url,
          {
            markdown: result.markdown,
            html: result.html,
            title: result.title,
            description: result.description,
            metadata: result.metadata,
          },
          options,
        );
        savedResults.push(saved);
      } catch (error) {
        logger.error('file-storage', {
          message: 'Failed to save scrape result',
          url: result.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return savedResults;
  }

  /**
   * Save search results to file
   */
  async saveSearchResults(
    query: string,
    results: Array<{
      url: string;
      title: string;
      description: string;
      markdown?: string;
      position?: number;
    }>,
    options: SaveOptions,
  ): Promise<SaveResult> {
    const outputDir = this.getOutputDir(options);
    const querySlug = sanitizeFilename(query.substring(0, 50));
    const timestamp = generateTimestampDir(true); // Include time for search

    // Build directory path: outputDir/search/YYYY-MM-DD/HH-mm-ss/
    const dirPath = join(outputDir, 'search', timestamp);

    // Build filename from query
    const filename = `${querySlug}.md`;
    const filePath = join(dirPath, filename);

    // Build markdown content
    const markdownContent = this.buildSearchResultsMarkdown(query, results);

    // Ensure directory exists and write file
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, markdownContent, 'utf-8');

    logger.info('file-storage', {
      message: 'Saved search results',
      filePath,
      query,
      resultCount: results.length,
    });

    return {
      filePath,
      url: `search:${query}`,
      title: `Search: ${query}`,
    };
  }

  /**
   * Build markdown content with YAML frontmatter
   */
  private buildMarkdownWithFrontmatter(
    url: string,
    content: {
      markdown?: string;
      html?: string;
      title?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): string {
    const frontmatter: Record<string, unknown> = {
      url,
      title: content.title ?? 'Untitled',
      scraped_at: new Date().toISOString(),
    };

    if (content.description) {
      frontmatter['description'] = content.description;
    }

    if (content.metadata) {
      // Add selected metadata fields
      if (content.metadata['language']) frontmatter['language'] = content.metadata['language'];
      if (content.metadata['statusCode'])
        frontmatter['status_code'] = content.metadata['statusCode'];
    }

    const frontmatterYaml = Object.entries(frontmatter)
      .map(([key, value]) => {
        if (typeof value === 'string' && (value.includes(':') || value.includes('"'))) {
          return `${key}: "${value.replace(/"/g, '\\"')}"`;
        }
        return `${key}: ${value}`;
      })
      .join('\n');

    const bodyContent = content.markdown ?? content.html ?? 'No content available';

    return `---
${frontmatterYaml}
---

${bodyContent}
`;
  }

  /**
   * Build markdown for search results
   */
  private buildSearchResultsMarkdown(
    query: string,
    results: Array<{
      url: string;
      title: string;
      description: string;
      markdown?: string;
      position?: number;
    }>,
  ): string {
    const frontmatter = `---
query: "${query.replace(/"/g, '\\"')}"
searched_at: ${new Date().toISOString()}
result_count: ${results.length}
---`;

    const resultsMarkdown = results
      .map((result, index) => {
        const position = result.position ?? index + 1;
        let entry = `## ${position}. ${result.title}\n\n`;
        entry += `**URL:** ${result.url}\n\n`;
        entry += `${result.description}\n`;

        if (result.markdown) {
          entry += `\n### Content\n\n${result.markdown}\n`;
        }

        return entry;
      })
      .join('\n---\n\n');

    return `${frontmatter}

# Search Results: ${query}

${resultsMarkdown}
`;
  }
}

/** Singleton file storage instance */
export const fileStorage = new FileStorage();
