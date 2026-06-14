import { config } from '../config/env.js';
import { ToolError, ToolErrorCodes } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * HTTP Client Options
 */
export interface HttpClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * HTTP Response wrapper
 */
export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  duration: number;
}

/**
 * A simple HTTP client for making API calls from tools.
 *
 * Features:
 * - Configurable base URL and headers
 * - Automatic JSON parsing
 * - Timeout handling
 * - Error wrapping
 *
 * @example
 * const client = new HttpClient({ baseUrl: 'https://api.example.com' });
 * const response = await client.get<User>('/users/123');
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? config.FIRECRAWL_API_URL ?? '';
    this.timeout = options.timeout ?? 30000;

    this.headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    // Add API key header if configured
    if (config.FIRECRAWL_API_KEY) {
      this.headers['Authorization'] = `Bearer ${config.FIRECRAWL_API_KEY}`;
    }
  }

  /**
   * Make a GET request
   */
  async get<T = unknown>(
    path: string,
    options?: { headers?: Record<string, string> },
  ): Promise<HttpResponse<T>> {
    return this.request<T>('GET', path, undefined, options?.headers);
  }

  /**
   * Make a POST request
   */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<HttpResponse<T>> {
    return this.request<T>('POST', path, body, options?.headers);
  }

  /**
   * Make a PUT request
   */
  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', path, body, options?.headers);
  }

  /**
   * Make a DELETE request
   */
  async delete<T = unknown>(
    path: string,
    options?: { headers?: Record<string, string> },
  ): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', path, undefined, options?.headers);
  }

  /**
   * Make an HTTP request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    const url = this.baseUrl ? `${this.baseUrl}${path}` : path;
    const startTime = Date.now();

    logger.debug('http', { message: 'Request', method, url });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: { ...this.headers, ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      // Parse response headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Parse response body
      const contentType = response.headers.get('content-type') ?? '';
      let data: T;

      if (contentType.includes('application/json')) {
        data = (await response.json()) as T;
      } else {
        data = (await response.text()) as T;
      }

      logger.debug('http', { message: 'Response', status: response.status, duration });

      // Throw on error status
      if (!response.ok) {
        throw new ToolError(
          `HTTP ${response.status}: ${response.statusText}`,
          ToolErrorCodes.EXTERNAL_API,
          { status: response.status, data },
        );
      }

      return { status: response.status, statusText: response.statusText, headers, data, duration };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ToolError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ToolError(`Request timeout after ${this.timeout}ms`, ToolErrorCodes.TIMEOUT, {
          url,
          method,
        });
      }

      throw new ToolError(
        error instanceof Error ? error.message : 'Unknown error',
        ToolErrorCodes.EXTERNAL_API,
        { url, method },
      );
    }
  }
}

/**
 * Default HTTP client instance using config values
 */
export const httpClient = new HttpClient();
