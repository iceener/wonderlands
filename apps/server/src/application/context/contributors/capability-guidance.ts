import type { AiMessage } from '../../../domain/ai/types'
import { resolveInteractionCapabilities } from '../../interactions/attachment-ref-access'
import { toTextContent } from '../../interactions/build-run-interaction-request'
import { formatCapabilityGuidanceDeveloperMessage } from '../../interactions/capability-prompt'
import type { ToolSpec } from '../../tooling/tool-registry'
import type {
  ContextArtifactMetadata,
  ContextContributor,
  ContextContributorInput,
  ReadonlyDeep,
} from '../contracts'

const copyTool = (tool: ReadonlyDeep<ToolSpec>): ToolSpec => ({
  ...tool,
  attachmentRefTargetKeys: tool.attachmentRefTargetKeys
    ? [...tool.attachmentRefTargetKeys]
    : undefined,
  inputSchema: { ...tool.inputSchema },
})

const toCapabilityMessages = (input: ContextContributorInput): AiMessage[] => {
  const capabilities = resolveInteractionCapabilities(input.activeTools.map(copyTool))
  const text = formatCapabilityGuidanceDeveloperMessage(capabilities)

  return text
    ? [
        {
          content: [toTextContent(text)],
          role: 'developer',
        },
      ]
    : []
}

const describeCapabilityGuidance = (input: ContextContributorInput): ContextArtifactMetadata => ({
  authority: 'agent_configuration',
  capturedAt: input.context.run.createdAt,
  conflictKey: null,
  dedupeKey: 'capability-guidance',
  dependencies: [],
  expiresAt: null,
  priority: 50,
  provenance: {
    createdByRunId: String(input.context.run.id),
    sourceIds: [
      ...new Set(input.activeTools.map((tool) => `tool:${tool.domain}:${tool.name}`)),
    ].sort(),
    sourceType: 'runtime',
    sourceVersion: 'capability-guidance/v1',
  },
  requirement: 'preferred',
  sensitivity: 'private',
  supersedes: [],
  transformation: { kind: 'none' },
  visibility: 'model',
})

export const capabilityGuidanceContributor: ContextContributor = {
  build: (input) => [
    {
      kind: 'capability_guidance',
      messages: toCapabilityMessages(input),
      volatility: 'stable',
    },
  ],
  describe: ({ input }) => describeCapabilityGuidance(input),
  id: 'capability-guidance',
  order: 3,
}
