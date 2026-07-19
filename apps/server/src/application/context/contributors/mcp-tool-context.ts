import { toTextContent } from '../../interactions/build-run-interaction-request'
import { formatMcpCodeModeInventoryMessage, type McpCodeModeCatalog } from '../../mcp/code-mode'
import type {
  ContextArtifactDescriptionInput,
  ContextArtifactMetadata,
  ContextContributor,
} from '../contracts'

const emptyMcpCatalog: McpCodeModeCatalog = {
  servers: [],
  tools: [],
}

const describeMcpToolContext = ({
  contribution,
  input,
}: ContextArtifactDescriptionInput): ContextArtifactMetadata => {
  const catalog = input.mcpMode === 'code' ? input.mcpCatalog : null
  const sourceIds = Array.from(
    new Set([
      String(input.context.run.id),
      ...(catalog?.servers.map((server) => server.serverId) ?? []),
      ...(catalog?.servers.flatMap((server) => server.tools.map((tool) => tool.runtimeName)) ?? []),
      ...(catalog?.tools.map((tool) => tool.runtimeName) ?? []),
    ]),
  ).sort()

  return {
    authority: input.mcpMode === 'code' ? 'authoritative_integration' : 'agent_configuration',
    capturedAt: input.context.run.createdAt,
    conflictKey: null,
    dedupeKey: `mcp-tool-context:${input.mcpMode}`,
    dependencies: [],
    expiresAt: null,
    priority: 60,
    provenance: {
      createdByRunId: String(input.context.run.id),
      sourceIds,
      sourceType: input.mcpMode === 'code' ? 'integration' : 'runtime',
      sourceVersion: null,
    },
    requirement: contribution.messages.length > 0 ? 'preferred' : 'optional',
    sensitivity: 'private',
    supersedes: [],
    transformation: { kind: 'none' },
    visibility: 'model',
  }
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
  describe: describeMcpToolContext,
}
