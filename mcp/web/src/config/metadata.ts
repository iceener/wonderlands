/**
 * Centralized metadata for Firecrawl MCP tools, prompts, and resources.
 *
 * Keeping descriptions and metadata in one place:
 * - Makes it easy to update documentation
 * - Ensures consistency across the codebase
 * - Enables programmatic access for introspection
 */

// ─────────────────────────────────────────────────────────────
// Tools Metadata
// ─────────────────────────────────────────────────────────────

export const toolsMetadata = {
  scrape: {
    name: 'scrape',
    title: 'Web Scraper',
    description: `Scrapes web pages and extracts content in various formats.

Features:
- Single URL or batch scraping (up to 100 URLs)
- Multiple output formats (markdown, html, links, screenshot)
- Smart content extraction (main content only)
- Geographic targeting
- Rate limit handling with automatic retries

Output modes:
- direct: Returns content in response
- file: Saves as markdown files organized by domain`,
  },

  search: {
    name: 'search',
    title: 'Web Search',
    description: `Searches the web and optionally scrapes results.

Features:
- Single or batch search queries (up to 10)
- Web, image, and news results
- Location-based targeting
- Time filtering (hour/day/week/month/year)
- Optional content scraping from results
- Rate limit handling with automatic retries

Output modes:
- direct: Returns results in response
- file: Saves as markdown files with timestamps`,
  },
} as const;

// ─────────────────────────────────────────────────────────────
// Prompts Metadata
// ─────────────────────────────────────────────────────────────

export const promptsMetadata = {
  greeting: {
    name: 'greeting',
    title: 'Greeting Prompt',
    description: `Generates a personalized greeting message.

Parameters:
- name: The name to greet
- style: Greeting style (formal, casual, enthusiastic)

Returns: A greeting message in the specified style.`,
  },

  analyze: {
    name: 'analyze',
    title: 'Analysis Prompt',
    description: `Generates a structured analysis prompt with topic autocompletion.

Parameters:
- topic: Analysis topic (with autocompletion support)
- depth: Analysis depth (quick, standard, deep)
- includeRecommendations: Whether to include action items

Features: Demonstrates completable() for argument autocompletion.`,
  },
} as const;

// ─────────────────────────────────────────────────────────────
// Resources Metadata
// ─────────────────────────────────────────────────────────────

export const resourcesMetadata = {
  serverConfig: {
    name: 'server-config',
    title: 'Server Configuration',
    uri: 'config://server',
    mimeType: 'application/json',
    description: 'Current server configuration including name, version, and capabilities.',
  },

  environment: {
    name: 'environment',
    title: 'Environment Info',
    uri: 'config://environment',
    mimeType: 'application/json',
    description: 'Runtime environment information including Node version and platform.',
  },

  files: {
    name: 'files',
    title: 'Virtual Files',
    uriTemplate: 'files:///{path}',
    mimeType: 'text/plain',
    description:
      'Access files from virtual file system. Demonstrates ResourceTemplate with list and complete.',
  },
} as const;

// ─────────────────────────────────────────────────────────────
// Type Exports
// ─────────────────────────────────────────────────────────────

export type ToolName = keyof typeof toolsMetadata;
export type PromptName = keyof typeof promptsMetadata;
export type ResourceName = keyof typeof resourcesMetadata;
