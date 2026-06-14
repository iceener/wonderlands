# Firecrawl MCP Server

An MCP server for [Firecrawl](https://firecrawl.dev) - web scraping and search with batch support, rate limiting, and flexible output modes.

## Features

- **Scrape Tool**: Extract content from web pages
  - Single URL or batch scraping (up to 100 URLs)
  - Multiple output formats: markdown, HTML, links, screenshot
  - Smart content extraction (main content only)
  - Geographic targeting

- **Search Tool**: Search the web
  - Single or batch queries (up to 10)
  - Web, image, and news results
  - Location-based search
  - Time filtering (hour/day/week/month/year)
  - Optional content scraping from results

- **Rate Limit Handling**: Automatic retry with exponential backoff
- **Two Output Modes**:
  - `direct`: Return results to the agent
  - `file`: Save as markdown files with date-based structure

## Quick Start

```bash
# Install dependencies
bun install

# Set your Firecrawl API key
export FIRECRAWL_API_KEY=fc-your-api-key

# Run in development mode
bun run dev

# Test with MCP Inspector
bun run inspector
```

## Configuration

All configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FIRECRAWL_API_KEY` | (required) | Your Firecrawl API key |
| `FIRECRAWL_API_URL` | `https://api.firecrawl.dev/v2` | Firecrawl API base URL |
| `FIRECRAWL_OUTPUT_MODE` | `direct` | Output mode: `direct` or `file` |
| `FIRECRAWL_OUTPUT_DIR` | `./firecrawl-output` | Directory for file output |
| `FIRECRAWL_RATE_LIMIT_RPM` | `100` | Requests per minute |
| `FIRECRAWL_RATE_LIMIT_RETRY_MS` | `1000` | Base retry delay in ms |
| `FIRECRAWL_RATE_LIMIT_MAX_RETRIES` | `3` | Maximum retry attempts |
| `LOG_LEVEL` | `info` | Log level: debug, info, warning, error |

## Tools

### scrape

Scrape web pages and extract content.

```json
{
  "urls": "https://example.com",
  "formats": ["markdown"],
  "onlyMainContent": true,
  "outputMode": "direct"
}
```

**Parameters:**
- `urls`: Single URL or array of URLs (max 100)
- `formats`: Output formats - `markdown`, `html`, `rawHtml`, `links`, `screenshot`
- `onlyMainContent`: Extract only main content (default: true)
- `includeTags`: HTML tags to include
- `excludeTags`: HTML tags to exclude
- `waitFor`: Wait time in ms for dynamic content
- `timeout`: Request timeout in ms
- `location`: Geographic targeting `{ country: "US", languages: ["en"] }`
- `outputMode`: Override mode - `direct` or `file`
- `outputDir`: Override output directory

### search

Search the web and optionally scrape results.

```json
{
  "queries": "firecrawl web scraping",
  "limit": 10,
  "scrapeResults": true,
  "outputMode": "direct"
}
```

**Parameters:**
- `queries`: Single query or array of queries (max 10)
- `limit`: Results per query (max 20, default: 10)
- `location`: Search location (e.g., "Germany", "United States")
- `tbs`: Time filter - `qdr:h` (hour), `qdr:d` (day), `qdr:w` (week), `qdr:m` (month), `qdr:y` (year)
- `scrapeResults`: Also scrape content from results
- `scrapeFormats`: Formats for scraped content
- `outputMode`: Override mode - `direct` or `file`
- `outputDir`: Override output directory

## Output Modes

### Direct Mode (default)

Results are returned directly to the agent in the response.

### File Mode

Results are saved as markdown files:

```
firecrawl-output/
├── scrape/
│   └── 2026-01-25/
│       └── example.com/
│           ├── index.md
│           └── about.md
└── search/
    └── 2026-01-25/
        └── 14-30-00/
            └── firecrawl-web-scraping.md
```

Each file includes YAML frontmatter with metadata:

```yaml
---
url: https://example.com
title: Example Domain
scraped_at: 2026-01-25T14:30:00.000Z
---

# Example Domain

This domain is for use in illustrative examples...
```

## Client Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "bun",
      "args": ["run", "/path/to/firecrawl-mcp/src/index.ts"],
      "env": {
        "FIRECRAWL_API_KEY": "fc-your-api-key",
        "FIRECRAWL_OUTPUT_MODE": "direct"
      }
    }
  }
}
```

### Cursor

Add to MCP settings:

```json
{
  "firecrawl": {
    "command": "bun",
    "args": ["run", "/path/to/firecrawl-mcp/src/index.ts"],
    "env": {
      "FIRECRAWL_API_KEY": "fc-your-api-key"
    }
  }
}
```

## Rate Limiting

The server includes built-in rate limiting to handle Firecrawl's API limits:

- Token bucket algorithm for request throttling
- Automatic retry on 429 (rate limit) and 5xx errors
- Exponential backoff between retries
- Configurable limits via environment variables

## Development

```bash
# Lint
bun run lint

# Type check
bun run typecheck

# Format code
bun run format

# Build for distribution
bun run build
```

## License

MIT
