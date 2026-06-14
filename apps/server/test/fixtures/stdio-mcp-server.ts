import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer(
  {
    name: 'stdio-mcp-fixture',
    version: '1.0.0',
  },
  {
    capabilities: {
      logging: {},
    },
  },
)

const registerFixtureAppResource = (resourceUri: string, title: string) => {
  registerAppResource(server, title, resourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [
      {
        mimeType: RESOURCE_MIME_TYPE,
        text: `<!doctype html><html lang="en"><body><main><h1>${title}</h1></main></body></html>`,
        uri: resourceUri,
      },
    ],
  }))
}

registerFixtureAppResource('ui://fixture/echo.html', 'Fixture Echo App')
registerFixtureAppResource('ui://fixture/app-only.html', 'Fixture App Only App')
registerFixtureAppResource('ui://fixture/dynamic.html', 'Fixture Dynamic App')
registerFixtureAppResource('ui://fixture/legacy.html', 'Fixture Legacy App')

registerAppTool(
  server,
  'echo',
  {
    description: 'Echo a value back over stdio',
    inputSchema: {
      value: z.string(),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://fixture/echo.html',
      },
    },
  },
  async ({ value }, extra) => {
    if (extra.sessionId) {
      await server.sendLoggingMessage(
        {
          data: {
            tool: 'echo',
            value,
          },
          level: 'info',
        },
        extra.sessionId,
      )
    }

    return {
      content: [
        {
          text: `echo:${value}`,
          type: 'text',
        },
      ],
      structuredContent: {
        echoed: value,
      },
    }
  },
)

registerAppTool(
  server,
  'app_only',
  {
    description: 'Only available to an MCP app host',
    inputSchema: {
      value: z.string().optional(),
    },
    _meta: {
      ui: {
        resourceUri: 'ui://fixture/app-only.html',
        visibility: ['app'],
      },
    },
  },
  async () => ({
    content: [
      {
        text: 'hidden',
        type: 'text',
      },
    ],
  }),
)

server.registerTool(
  'dynamic_ui',
  {
    description: 'Declares its MCP app UI resource only in the tool result metadata',
    inputSchema: {
      value: z.string().optional(),
    },
  },
  async ({ value }) => ({
    _meta: {
      ui: {
        resourceUri: 'ui://fixture/dynamic.html',
      },
    },
    content: [
      {
        text: value ? `dynamic:${value}` : 'dynamic',
        type: 'text',
      },
    ],
    structuredContent: {
      echoed: value ?? null,
    },
  }),
)

server.registerTool(
  'legacy_ui',
  {
    description: 'Uses legacy ui/resourceUri metadata',
    inputSchema: {
      value: z.string(),
    },
    _meta: {
      'ui/resourceUri': 'ui://fixture/legacy.html',
    },
  },
  async ({ value }) => ({
    content: [
      {
        text: `legacy:${value}`,
        type: 'text',
      },
    ],
    structuredContent: {
      legacy: value,
    },
  }),
)

await server.connect(new StdioServerTransport())
