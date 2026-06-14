import { config } from '../config/env.js';
import { ToolError, ToolErrorCodes } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Firecrawl API response types
 */
export interface FirecrawlScrapeResult {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    screenshot?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      sourceURL?: string;
      statusCode?: number;
      [key: string]: unknown;
    };
  };
  error?: string;
}

export interface FirecrawlSearchResult {
  success: boolean;
  data?: {
    web?: Array<{
      url: string;
      title: string;
      description: string;
      position: number;
      markdown?: string;
      links?: string[];
      metadata?: Record<string, unknown>;
    }>;
    images?: Array<{
      title: string;
      imageUrl: string;
      url: string;
      position: number;
    }>;
    news?: Array<{
      title: string;
      url: string;
      snippet: string;
      date: string;
      position: number;
    }>;
  };
  error?: string;
}

export interface FirecrawlBatchScrapeResponse {
  success: boolean;
  id?: string;
  url?: string;
  error?: string;
}

export interface FirecrawlBatchScrapeStatus {
  status: 'scraping' | 'completed' | 'failed';
  total: number;
  completed: number;
  creditsUsed: number;
  expiresAt: string;
  next?: string;
  data?: FirecrawlScrapeResult['data'][];
  error?: string;
}

export interface ScrapeOptions {
  formats?: Array<'markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot'>;
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  waitFor?: number;
  timeout?: number;
  location?: {
    country?: string;
    languages?: string[];
  };
}

export interface SearchOptions {
  limit?: number;
  location?: string;
  tbs?: string; // time-based search filter
  scrapeOptions?: ScrapeOptions;
}

/**
 * Rate limiter using token bucket algorithm
 */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(requestsPerMinute: number) {
    this.maxTokens = requestsPerMinute;
    this.tokens = requestsPerMinute;
    this.refillRate = requestsPerMinute / 60000; // convert to per ms
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time for next token
    const waitTime = (1 - this.tokens) / this.refillRate;
    logger.debug('rate-limiter', { message: 'Waiting for rate limit', waitMs: waitTime });
    await this.sleep(waitTime);
    this.refill();
    this.tokens -= 1;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Firecrawl API client with rate limiting and retry logic
 */
export class FirecrawlClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly rateLimiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly retryAfterMs: number;

  constructor() {
    this.baseUrl = config.FIRECRAWL_API_URL;
    this.apiKey = config.FIRECRAWL_API_KEY;
    this.rateLimiter = new RateLimiter(config.RATE_LIMIT_REQUESTS_PER_MINUTE);
    this.maxRetries = config.RATE_LIMIT_MAX_RETRIES;
    this.retryAfterMs = config.RATE_LIMIT_RETRY_AFTER_MS;
  }

  /**
   * Scrape a single URL
   */
  async scrape(url: string, options: ScrapeOptions = {}): Promise<FirecrawlScrapeResult> {
    const body = {
      url,
      formats: options.formats ?? ['markdown'],
      onlyMainContent: options.onlyMainContent,
      includeTags: options.includeTags,
      excludeTags: options.excludeTags,
      waitFor: options.waitFor,
      timeout: options.timeout,
      location: options.location,
    };

    return this.request<FirecrawlScrapeResult>('/scrape', 'POST', body);
  }

  /**
   * Scrape multiple URLs in batch with polling
   */
  async batchScrape(
    urls: string[],
    options: ScrapeOptions = {},
    onProgress?: (completed: number, total: number) => void,
  ): Promise<FirecrawlScrapeResult['data'][]> {
    // Start batch job
    const body = {
      urls,
      formats: options.formats ?? ['markdown'],
      onlyMainContent: options.onlyMainContent,
      includeTags: options.includeTags,
      excludeTags: options.excludeTags,
      waitFor: options.waitFor,
      timeout: options.timeout,
      location: options.location,
    };

    const startResponse = await this.request<FirecrawlBatchScrapeResponse>(
      '/batch/scrape',
      'POST',
      body,
    );

    if (!startResponse.success || !startResponse.id) {
      throw new ToolError(
        startResponse.error ?? 'Failed to start batch scrape',
        ToolErrorCodes.EXTERNAL_API,
      );
    }

    const jobId = startResponse.id;
    logger.info('firecrawl', { message: 'Batch scrape started', jobId, urlCount: urls.length });

    // Poll for completion
    const results: FirecrawlScrapeResult['data'][] = [];
    let nextUrl: string | undefined = `/batch/scrape/${jobId}`;

    while (nextUrl) {
      await this.sleep(2000); // Poll every 2 seconds

      const currentUrl: string = nextUrl;
      const statusPath: string = currentUrl.startsWith('http')
        ? new URL(currentUrl).pathname + new URL(currentUrl).search
        : currentUrl;

      const status: FirecrawlBatchScrapeStatus = await this.request<FirecrawlBatchScrapeStatus>(
        statusPath,
        'GET',
      );

      if (onProgress) {
        onProgress(status.completed, status.total);
      }

      logger.debug('firecrawl', {
        message: 'Batch scrape status',
        status: status.status,
        completed: status.completed,
        total: status.total,
      });

      if (status.status === 'failed') {
        throw new ToolError(status.error ?? 'Batch scrape failed', ToolErrorCodes.EXTERNAL_API);
      }

      if (status.data) {
        results.push(...status.data);
      }

      if (status.status === 'completed' && !status.next) {
        break;
      }

      nextUrl = status.next;
    }

    logger.info('firecrawl', { message: 'Batch scrape completed', resultCount: results.length });
    return results;
  }

  /**
   * Search the web
   */
  async search(query: string, options: SearchOptions = {}): Promise<FirecrawlSearchResult> {
    const body: Record<string, unknown> = {
      query,
      limit: options.limit ?? 10,
    };

    if (options.location) {
      body['location'] = options.location;
    }

    if (options.tbs) {
      body['tbs'] = options.tbs;
    }

    if (options.scrapeOptions) {
      body['scrapeOptions'] = {
        formats: options.scrapeOptions.formats ?? ['markdown'],
        onlyMainContent: options.scrapeOptions.onlyMainContent,
        includeTags: options.scrapeOptions.includeTags,
        excludeTags: options.scrapeOptions.excludeTags,
      };
    }

    return this.request<FirecrawlSearchResult>('/search', 'POST', body);
  }

  /**
   * Make an API request with rate limiting and retry logic
   */
  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.rateLimiter.acquire();

      try {
        const url = `${this.baseUrl}${path}`;
        logger.debug('firecrawl', { message: 'Request', method, path, attempt });

        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter
            ? Number.parseInt(retryAfter, 10) * 1000
            : this.retryAfterMs * (attempt + 1);

          logger.warning('firecrawl', {
            message: 'Rate limited, retrying',
            attempt,
            waitMs: waitTime,
          });

          await this.sleep(waitTime);
          continue;
        }

        // Handle server errors with retry
        if (response.status >= 500) {
          const waitTime = this.retryAfterMs * (attempt + 1);
          logger.warning('firecrawl', {
            message: 'Server error, retrying',
            status: response.status,
            attempt,
            waitMs: waitTime,
          });

          await this.sleep(waitTime);
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          const text = await response.text();
          throw new ToolError(
            `Firecrawl returned non-JSON response (${response.status}). Is FIRECRAWL_API_KEY set and valid? Body preview: ${text.slice(0, 120)}`,
            response.status === 401 || response.status === 403
              ? ToolErrorCodes.UNAUTHORIZED
              : ToolErrorCodes.EXTERNAL_API,
            { status: response.status },
          );
        }

        const data = (await response.json()) as T;

        if (!response.ok) {
          const errorData = data as { error?: string };
          throw new ToolError(
            errorData.error ?? `HTTP ${response.status}`,
            response.status === 401 ? ToolErrorCodes.UNAUTHORIZED : ToolErrorCodes.EXTERNAL_API,
            { status: response.status },
          );
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof ToolError) {
          throw error;
        }

        // Network errors - retry
        if (attempt < this.maxRetries) {
          const waitTime = this.retryAfterMs * (attempt + 1);
          logger.warning('firecrawl', {
            message: 'Request failed, retrying',
            error: lastError.message,
            attempt,
            waitMs: waitTime,
          });
          await this.sleep(waitTime);
        }
      }
    }

    throw new ToolError(lastError?.message ?? 'Max retries exceeded', ToolErrorCodes.EXTERNAL_API, {
      maxRetries: this.maxRetries,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Singleton Firecrawl client instance */
export const firecrawlClient = new FirecrawlClient();
