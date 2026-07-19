import type { AiProviderName } from '../../../domain/ai/types'
import type { SessionMessageRecord } from '../../../domain/sessions/session-message-repository'
import { toFileContextMessages, type VisibleFileContextEntry } from '../../files/file-context'
import {
  resolveAttachmentRefAccessModeForCapabilities,
  resolveInteractionCapabilities,
} from '../../interactions/attachment-ref-access'
import { collectInlineReferencedUploadedFileIds } from '../../interactions/model-visible-user-content'
import type { ToolSpec } from '../../tooling/tool-registry'
import type { ContextContributor, ContextContributorInput, ReadonlyDeep } from '../contracts'

const copyTool = (tool: ReadonlyDeep<ToolSpec>): ToolSpec => ({
  ...tool,
  attachmentRefTargetKeys: tool.attachmentRefTargetKeys
    ? [...tool.attachmentRefTargetKeys]
    : undefined,
  inputSchema: { ...tool.inputSchema },
})

const resolveRequestedProvider = (input: ContextContributorInput): AiProviderName | null => {
  if (input.overrides.provider) {
    return input.overrides.provider
  }

  const provider = input.context.run.configSnapshot.provider

  return provider === 'openai' || provider === 'google' || provider === 'openrouter'
    ? provider
    : null
}

export const fileContextContributor: ContextContributor = {
  build: (input) => {
    const capabilities = resolveInteractionCapabilities(input.activeTools.map(copyTool))
    const accessMode = resolveAttachmentRefAccessModeForCapabilities(capabilities)
    const provider = resolveRequestedProvider(input)
    // Both helpers only read these values. Their mutable parameter types predate the
    // contributor contract's deep-readonly compatibility boundary.
    const visibleMessages = input.context.visibleMessages as SessionMessageRecord[]
    const visibleFiles = input.context.visibleFiles as VisibleFileContextEntry[]
    const inlineReferencedFileIds = collectInlineReferencedUploadedFileIds(visibleMessages)
    const messages = toFileContextMessages(
      visibleFiles,
      provider,
      inlineReferencedFileIds,
      accessMode,
    )

    return [
      {
        kind: 'file_context',
        messages,
        volatility: 'volatile',
      },
    ]
  },
  id: 'file-context',
  order: 14,
}
