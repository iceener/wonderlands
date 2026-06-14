/**
 * Environment configuration for Firecrawl MCP server.
 * All configuration is read from environment variables.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * Output mode determines how results are returned:
 * - 'direct': Results are returned directly to the agent (default)
 * - 'file': Results are saved as markdown files in OUTPUT_DIR
 */
export type OutputMode = 'direct' | 'file';

export interface Config {
  // Server identity
  readonly NAME: string;
  readonly VERSION: string;
  readonly INSTRUCTIONS: string;

  // Logging
  readonly LOG_LEVEL: LogLevel;

  // Firecrawl API configuration
  readonly FIRECRAWL_API_KEY: string;
  readonly FIRECRAWL_API_URL: string;

  // Output configuration
  readonly OUTPUT_MODE: OutputMode;
  readonly OUTPUT_DIR: string;

  // Rate limiting
  readonly RATE_LIMIT_REQUESTS_PER_MINUTE: number;
  readonly RATE_LIMIT_RETRY_AFTER_MS: number;
  readonly RATE_LIMIT_MAX_RETRIES: number;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.toLowerCase();
  if (level === 'debug' || level === 'info' || level === 'warning' || level === 'error') {
    return level;
  }
  return 'info';
}

function parseOutputMode(value: string | undefined): OutputMode {
  const mode = value?.toLowerCase();
  if (mode === 'file') {
    return 'file';
  }
  return 'direct';
}

function loadConfig(): Config {
  const apiKey = process.env['FIRECRAWL_API_KEY'];
  if (!apiKey) {
    console.error('Warning: FIRECRAWL_API_KEY is not set. API calls will fail.');
  }

  return {
    NAME: process.env['MCP_NAME'] ?? 'firecrawl-mcp',
    VERSION: process.env['MCP_VERSION'] ?? '1.0.0',
    INSTRUCTIONS:
      process.env['MCP_INSTRUCTIONS'] ??
      'Firecrawl MCP server for web scraping and search. Use scrape tool to extract content from URLs, and search tool to search the web.',

    LOG_LEVEL: parseLogLevel(process.env['LOG_LEVEL']),

    FIRECRAWL_API_KEY: apiKey ?? '',
    FIRECRAWL_API_URL: process.env['FIRECRAWL_API_URL'] ?? 'https://api.firecrawl.dev/v2',

    OUTPUT_MODE: parseOutputMode(process.env['FIRECRAWL_OUTPUT_MODE']),
    OUTPUT_DIR: process.env['FIRECRAWL_OUTPUT_DIR'] ?? './firecrawl-output',

    // Rate limiting defaults based on Firecrawl's standard plan limits
    RATE_LIMIT_REQUESTS_PER_MINUTE: Number.parseInt(
      process.env['FIRECRAWL_RATE_LIMIT_RPM'] ?? '100',
      10,
    ),
    RATE_LIMIT_RETRY_AFTER_MS: Number.parseInt(
      process.env['FIRECRAWL_RATE_LIMIT_RETRY_MS'] ?? '1000',
      10,
    ),
    RATE_LIMIT_MAX_RETRIES: Number.parseInt(
      process.env['FIRECRAWL_RATE_LIMIT_MAX_RETRIES'] ?? '3',
      10,
    ),
  };
}

/** Global configuration instance */
export const config: Config = loadConfig();
