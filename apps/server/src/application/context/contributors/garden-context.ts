import type { GardenAgentContext } from '../../garden/garden-agent-context'
import { formatGardenContextDeveloperMessage } from '../../garden/garden-agent-context'
import {
  isJustBashAvailableInSandbox,
  resolveAttachmentRefAccessModeForCapabilities,
  resolveInteractionCapabilities,
} from '../../interactions/attachment-ref-access'
import { toTextContent } from '../../interactions/build-run-interaction-request'
import type { ToolSpec } from '../../tooling/tool-registry'
import type { ContextContributor } from '../contracts'

export const gardenContextContributor: ContextContributor = {
  id: 'garden-context',
  order: 4,
  build: (input) => {
    // The legacy capability helpers and formatter are read-only in practice, but predate
    // ContextContributorInput's deep-readonly compatibility boundary.
    const capabilities = resolveInteractionCapabilities(input.activeTools as ToolSpec[])
    const accessMode = resolveAttachmentRefAccessModeForCapabilities(capabilities)
    const hasGardenContextTool = input.activeTools.some(
      (tool) => tool.name === 'get_garden_context',
    )
    const text = formatGardenContextDeveloperMessage(
      input.context.gardenContext as GardenAgentContext | null,
      {
        includeExecuteHint: capabilities.sandboxExecute,
        includeToolHint: hasGardenContextTool,
        includeSandboxHint: accessMode === 'sandbox',
        includeJustBashHint: accessMode === 'sandbox' && isJustBashAvailableInSandbox(),
      },
    )

    return [
      {
        kind: 'garden_context',
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
