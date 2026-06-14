import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from '../config/env.js';
import { fileStorage } from '../services/file-storage.js';
import { firecrawlClient, type ScrapeOptions } from '../services/firecrawl-client.js';
import type { HandlerExtra } from '../types/index.js';
import { cancelledError, ToolErrorCodes, toolError, validationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Scrape Tool
 *
 * Scrape one or more URLs and extract content in various formats.
 * Supports batch scraping with rate limit handling.
 * Results can be returned directly or saved to files based on configuration.
 */

const scrapeFormats = z.enum(['markdown', 'html', 'rawHtml', 'links', 'screenshot']);

export const scrapeInputSchema = z
  .object({
    urls: z
      .union([z.string().url(), z.array(z.string().url()).min(1).max(100)])
      .describe('Single URL or array of URLs to scrape (max 100)'),
    formats: z
      .array(scrapeFormats)
      .optional()
      .default(['markdown'])
      .describe('Output formats: markdown, html, rawHtml, links, screenshot'),
    onlyMainContent: z
      .boolean()
      .optional()
      .default(true)
      .describe('Extract only main content, excluding headers/footers'),
    includeTags: z
      .array(z.string())
      .optional()
      .describe('HTML tags to include (e.g., ["article", "main"])'),
    excludeTags: z
      .array(z.string())
      .optional()
      .describe('HTML tags to exclude (e.g., ["nav", "footer"])'),
    waitFor: z
      .number()
      .min(0)
      .max(30000)
      .optional()
      .describe('Wait time in ms for dynamic content'),
    timeout: z.number().min(1000).max(120000).optional().describe('Request timeout in ms'),
    location: z
      .object({
        country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code'),
        languages: z.array(z.string()).optional().describe('Preferred languages'),
      })
      .optional()
      .describe('Location settings for geo-targeted content'),
    outputMode: z
      .enum(['direct', 'file'])
      .optional()
      .describe('Override default output mode: direct (return content) or file (save to disk)'),
    outputDir: z.string().optional().describe('Override default output directory for file mode'),
  })
  .strict();

export const scrapeOutputSchema = z.object({
  success: z.boolean(),
  mode: z.enum(['direct', 'file']),
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      markdown: z.string().optional(),
      html: z.string().optional(),
      links: z.array(z.string()).optional(),
      filePath: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
  totalUrls: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
});

export type ScrapeInput = z.infer<typeof scrapeInputSchema>;
export type ScrapeOutput = z.infer<typeof scrapeOutputSchema>;

export const scrapeTool = {
  name: 'scrape',
  description: `Scrape web pages and extract content. Supports single URL or batch scraping (up to 100 URLs).

Features:
- Multiple output formats: markdown (default), html, rawHtml, links, screenshot
- Smart content extraction (main content only by default)
- Geographic targeting with location settings
- Automatic rate limit handling with retries

Output modes:
- direct: Returns content in response (default based on FIRECRAWL_OUTPUT_MODE)
- file: Saves as markdown files in ${config.OUTPUT_DIR}/scrape/YYYY-MM-DD/domain/

For batch operations, uses Firecrawl's batch API for efficiency.`,
  inputSchema: scrapeInputSchema,
  outputSchema: scrapeOutputSchema,

  handler: async (args: unknown, extra: HandlerExtra): Promise<CallToolResult> => {
    // Check for cancellation
    if (extra.signal?.aborted) {
      return cancelledError();
    }

    // Validate input
    const parsed = scrapeInputSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues);
    }

    const input = parsed.data;
    const urls = Array.isArray(input.urls) ? input.urls : [input.urls];
    const outputMode = input.outputMode ?? config.OUTPUT_MODE;
    const saveToFile = outputMode === 'file';

    logger.info('scrape', {
      message: 'Starting scrape',
      urls,
      urlCount: urls.length,
      formats: input.formats,
      outputMode,
    });

    const scrapeOptions: ScrapeOptions = {
      formats: input.formats as ScrapeOptions['formats'],
      onlyMainContent: input.onlyMainContent,
      includeTags: input.includeTags,
      excludeTags: input.excludeTags,
      waitFor: input.waitFor,
      timeout: input.timeout,
      location: input.location,
    };

    const results: ScrapeOutput['results'] = [];
    let successCount = 0;
    let failureCount = 0;

    try {
      if (urls.length === 1) {
        // Single URL scrape
        const firstUrl = urls[0] as string;
        const result = await firecrawlClient.scrape(firstUrl, scrapeOptions);

        if (result.success && result.data) {
          const data = result.data;
          const pageTitle = data.metadata?.title as string | undefined;

          if (saveToFile) {
            const saved = await fileStorage.saveScrapeResult(
              firstUrl,
              {
                markdown: data.markdown,
                html: data.html,
                title: pageTitle,
                description: data.metadata?.description as string | undefined,
                metadata: data.metadata,
              },
              {
                operationType: 'scrape',
                outputDir: input.outputDir,
                outputMode,
              },
            );

            results.push({
              url: firstUrl,
              title: pageTitle,
              filePath: saved.filePath,
            });
          } else {
            results.push({
              url: firstUrl,
              title: pageTitle,
              markdown: data.markdown,
              html: data.html,
              links: data.links,
            });
          }
          successCount++;
        } else {
          results.push({
            url: firstUrl,
            error: result.error ?? 'Unknown error',
          });
          failureCount++;
        }
      } else {
        // Batch scrape for multiple URLs
        const batchResults = await firecrawlClient.batchScrape(
          urls,
          scrapeOptions,
          (completed, total) => {
            logger.debug('scrape', {
              message: 'Batch progress',
              completed,
              total,
            });
          },
        );

        // Process batch results
        const resultsToSave: Array<{
          url: string;
          markdown?: string;
          html?: string;
          title?: string;
          description?: string;
          metadata?: Record<string, unknown>;
        }> = [];

        for (let i = 0; i < batchResults.length; i++) {
          const data = batchResults[i];
          const url = (data?.metadata?.sourceURL as string) ?? urls[i] ?? `url-${i}`;

          if (data) {
            if (saveToFile) {
              resultsToSave.push({
                url,
                markdown: data.markdown,
                html: data.html,
                title: data.metadata?.title as string | undefined,
                description: data.metadata?.description as string | undefined,
                metadata: data.metadata,
              });
            } else {
              results.push({
                url,
                title: data.metadata?.title as string | undefined,
                markdown: data.markdown,
                html: data.html,
                links: data.links,
              });
            }
            successCount++;
          } else {
            results.push({
              url,
              error: 'No data returned',
            });
            failureCount++;
          }
        }

        // Save all results to files if in file mode
        if (saveToFile && resultsToSave.length > 0) {
          const savedResults = await fileStorage.saveBatchScrapeResults(resultsToSave, {
            operationType: 'scrape',
            outputDir: input.outputDir,
            outputMode,
          });

          for (const saved of savedResults) {
            const original = resultsToSave.find((r) => r.url === saved.url);
            results.push({
              url: saved.url,
              title: saved.title ?? original?.title,
              filePath: saved.filePath,
            });
          }
        }
      }
    } catch (error) {
      logger.error('scrape', {
        message: 'Scrape failed',
        error: error instanceof Error ? error.message : String(error),
      });

      return toolError(
        error instanceof Error ? error.message : 'Scrape failed',
        ToolErrorCodes.EXTERNAL_API,
        { urlCount: urls.length },
      );
    }

    const output: ScrapeOutput = {
      success: failureCount === 0,
      mode: outputMode,
      results,
      totalUrls: urls.length,
      successCount,
      failureCount,
    };

    logger.info('scrape', {
      message: 'Scrape completed',
      successCount,
      failureCount,
      mode: outputMode,
    });

    // Build response text
    let responseText: string;
    if (saveToFile) {
      responseText = `Scraped ${successCount}/${urls.length} URLs. Files saved to:\n${results
        .filter((r) => r.filePath)
        .map((r) => `- ${r.filePath}`)
        .join('\n')}`;
    } else {
      responseText = results
        .map((r) => {
          if (r.error) {
            return `## Error: ${r.url}\n${r.error}`;
          }
          const title = r.title ? `# ${r.title}\n\n` : '';
          const content = r.markdown ?? r.html ?? 'No content';
          return `## ${r.url}\n\n${title}${content}`;
        })
        .join('\n\n---\n\n');
    }

    return {
      content: [{ type: 'text', text: responseText }],
      structuredContent: output,
    };
  },
};
