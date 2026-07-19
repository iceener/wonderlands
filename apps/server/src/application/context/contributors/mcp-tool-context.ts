import { toTextContent } from '../../interactions/build-run-interaction-request'
import { formatMcpCodeModeInventoryMessage, type McpCodeModeCatalog } from '../../mcp/code-mode'
import type { ContextContributor } from '../contracts'

const emptyMcpCatalog: McpCodeModeCatalog = {
  servers: [],
  tools: [],
}

export const mcpToolContextContributor: ContextContributor = {
  id: 'mcp-tool-context',
  order: 6,
  build: (input) => {
    if (input.mcpMode !== 'code') {
      return [
        {
          kind: 'tool_context',
          messages: [],
          volatility: 'stable',
        },
      ]
    }

    // The current formatter only reads the catalog. Its mutable input type predates the
    // contributor contract's deep-readonly compatibility boundary.
    const text = formatMcpCodeModeInventoryMessage(
      (input.mcpCatalog as McpCodeModeCatalog | null) ?? emptyMcpCatalog,
    )

    return [
      {
        kind: 'tool_context',
        messages: text
          ? [
              {
                content: [toTextContent(text)],
                role: 'developer',
              },
            ]
          : [],
        volatility: 'stable',
      },
    ]
  },
}
