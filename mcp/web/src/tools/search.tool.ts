import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from '../config/env.js';
import { fileStorage } from '../services/file-storage.js';
import {
  firecrawlClient,
  type ScrapeOptions,
  type SearchOptions,
} from '../services/firecrawl-client.js';
import type { HandlerExtra } from '../types/index.js';
import { cancelledError, validationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Search Tool
 *
 * Search the web using Firecrawl's search API.
 * Supports batch queries with rate limit handling.
 * Results can be returned directly or saved to files based on configuration.
 */

export const searchInputSchema = z
  .object({
    queries: z
      .union([z.string().min(1).max(500), z.array(z.string().min(1).max(500)).min(1).max(10)])
      .describe('Single search query or array of queries (max 10)'),
    limit: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(10)
      .describe('Number of results per query (max 20)'),
    location: z
      .string()
      .optional()
      .describe('Location for search (e.g., "Germany", "United States")'),
    tbs: z
      .enum(['qdr:h', 'qdr:d', 'qdr:w', 'qdr:m', 'qdr:y'])
      .optional()
      .describe('Time filter: h=hour, d=day, w=week, m=month, y=year'),
    scrapeResults: z
      .boolean()
      .optional()
      .default(false)
      .describe('Also scrape content from search results'),
    scrapeFormats: z
      .array(z.enum(['markdown', 'html', 'links']))
      .optional()
      .default(['markdown'])
      .describe('Formats for scraped content (if scrapeResults is true)'),
    outputMode: z
      .enum(['direct', 'file'])
      .optional()
      .describe('Override default output mode: direct (return content) or file (save to disk)'),
    outputDir: z.string().optional().describe('Override default output directory for file mode'),
  })
  .strict();

export const searchOutputSchema = z.object({
  success: z.boolean(),
  mode: z.enum(['direct', 'file']),
  results: z.array(
    z.object({
      query: z.string(),
      web: z
        .array(
          z.object({
            url: z.string(),
            title: z.string(),
            description: z.string(),
            position: z.number(),
            markdown: z.string().optional(),
          }),
        )
        .optional(),
      images: z
        .array(
          z.object({
            title: z.string(),
            imageUrl: z.string(),
            url: z.string(),
            position: z.number(),
          }),
        )
        .optional(),
      news: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
            snippet: z.string(),
            date: z.string(),
            position: z.number(),
          }),
        )
        .optional(),
      filePath: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
  totalQueries: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
});

export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;

export const searchTool = {
  name: 'search',
  description: `Search the web using Firecrawl. Supports single query or batch searching (up to 10 queries).

Features:
- Web, image, and news results
- Location-based search targeting
- Time filtering (past hour/day/week/month/year)
- Optional content scraping from search results
- Automatic rate limit handling with retries

Output modes:
- direct: Returns results in response (default based on FIRECRAWL_OUTPUT_MODE)
- file: Saves as markdown files in ${config.OUTPUT_DIR}/search/YYYY-MM-DD/HH-mm-ss/

Time filters (tbs parameter):
- qdr:h - Past hour
- qdr:d - Past 24 hours  
- qdr:w - Past week
- qdr:m - Past month
- qdr:y - Past year`,
  inputSchema: searchInputSchema,
  outputSchema: searchOutputSchema,

  handler: async (args: unknown, extra: HandlerExtra): Promise<CallToolResult> => {
    // Check for cancellation
    if (extra.signal?.aborted) {
      return cancelledError();
    }

    // Validate input
    const parsed = searchInputSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues);
    }

    const input = parsed.data;
    const queries = Array.isArray(input.queries) ? input.queries : [input.queries];
    const outputMode = input.outputMode ?? config.OUTPUT_MODE;
    const saveToFile = outputMode === 'file';

    logger.info('search', {
      message: 'Starting search',
      queryCount: queries.length,
      limit: input.limit,
      scrapeResults: input.scrapeResults,
      outputMode,
    });

    const searchOptions: SearchOptions = {
      limit: input.limit,
      location: input.location,
      tbs: input.tbs,
    };

    if (input.scrapeResults) {
      searchOptions.scrapeOptions = {
        formats: input.scrapeFormats as ScrapeOptions['formats'],
      };
    }

    const results: SearchOutput['results'] = [];
    let successCount = 0;
    let failureCount = 0;

    // Process each query
    for (const query of queries) {
      // Check for cancellation between queries
      if (extra.signal?.aborted) {
        logger.info('search', { message: 'Search cancelled', completedQueries: successCount });
        break;
      }

      try {
        logger.debug('search', { message: 'Executing query', query });

        const searchResult = await firecrawlClient.search(query, searchOptions);

        if (searchResult.success && searchResult.data) {
          const data = searchResult.data;

          // Transform web results
          const webResults = data.web?.map((item) => ({
            url: item.url,
            title: item.title,
            description: item.description,
            position: item.position,
            markdown: item.markdown,
          }));

          if (saveToFile) {
            // Save to file
            const saved = await fileStorage.saveSearchResults(query, webResults ?? [], {
              operationType: 'search',
              outputDir: input.outputDir,
              outputMode,
            });

            results.push({
              query,
              filePath: saved.filePath,
            });
          } else {
            // Return directly
            results.push({
              query,
              web: webResults,
              images: data.images,
              news: data.news,
            });
          }

          successCount++;
        } else {
          results.push({
            query,
            error: searchResult.error ?? 'Search returned no results',
          });
          failureCount++;
        }
      } catch (error) {
        logger.error('search', {
          message: 'Query failed',
          query,
          error: error instanceof Error ? error.message : String(error),
        });

        results.push({
          query,
          error: error instanceof Error ? error.message : 'Search failed',
        });
        failureCount++;
      }
    }

    const output: SearchOutput = {
      success: failureCount === 0,
      mode: outputMode,
      results,
      totalQueries: queries.length,
      successCount,
      failureCount,
    };

    logger.info('search', {
      message: 'Search completed',
      successCount,
      failureCount,
      mode: outputMode,
    });

    // Build response text
    let responseText: string;
    if (saveToFile) {
      responseText = `Searched ${successCount}/${queries.length} queries. Files saved to:\n${results
        .filter((r) => r.filePath)
        .map((r) => `- ${r.query}: ${r.filePath}`)
        .join('\n')}`;
    } else {
      responseText = results
        .map((r) => {
          if (r.error) {
            return `## Search: ${r.query}\n\nError: ${r.error}`;
          }

          let text = `## Search: ${r.query}\n\n`;

          if (r.web && r.web.length > 0) {
            text += '### Web Results\n\n';
            text += r.web
              .map((item) => {
                let entry = `**${item.position}. [${item.title}](${item.url})**\n${item.description}`;
                if (item.markdown) {
                  entry += `\n\n<details>\n<summary>Content</summary>\n\n${item.markdown.substring(0, 2000)}${item.markdown.length > 2000 ? '...' : ''}\n\n</details>`;
                }
                return entry;
              })
              .join('\n\n');
          }

          if (r.news && r.news.length > 0) {
            text += '\n\n### News\n\n';
            text += r.news
              .map(
                (item) =>
                  `**${item.position}. [${item.title}](${item.url})** (${item.date})\n${item.snippet}`,
              )
              .join('\n\n');
          }

          if (r.images && r.images.length > 0) {
            text += '\n\n### Images\n\n';
            text += r.images
              .map((item) => `${item.position}. [${item.title}](${item.url}) - ${item.imageUrl}`)
              .join('\n');
          }

          return text;
        })
        .join('\n\n---\n\n');
    }

    return {
      content: [{ type: 'text', text: responseText }],
      structuredContent: output,
    };
  },
};
