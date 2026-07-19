import type { AiMessage } from '../../../domain/ai/types'
import { resolveInteractionCapabilities } from '../../interactions/attachment-ref-access'
import { toTextContent } from '../../interactions/build-run-interaction-request'
import { formatCapabilityGuidanceDeveloperMessage } from '../../interactions/capability-prompt'
import type { ToolSpec } from '../../tooling/tool-registry'
import type { ContextContributor, ContextContributorInput, ReadonlyDeep } from '../contracts'

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

export const capabilityGuidanceContributor: ContextContributor = {
  build: (input) => [
    {
      kind: 'capability_guidance',
      messages: toCapabilityMessages(input),
      volatility: 'stable',
    },
  ],
  id: 'capability-guidance',
  order: 3,
}
