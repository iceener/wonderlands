import type { AttachmentRefDescriptor } from '../../files/attachment-ref-context'
import {
  isJustBashAvailableInSandbox,
  resolveAttachmentRefAccessModeForCapabilities,
  resolveInteractionCapabilities,
} from '../../interactions/attachment-ref-access'
import { formatAttachmentRefRulesDeveloperMessage } from '../../interactions/attachment-ref-prompt'
import { toTextContent } from '../../interactions/build-run-interaction-request'
import type { ToolSpec } from '../../tooling/tool-registry'
import type { ContextArtifactMetadata, ContextContributor, ReadonlyDeep } from '../contracts'

const copyTool = (tool: ReadonlyDeep<ToolSpec>): ToolSpec => ({
  ...tool,
  attachmentRefTargetKeys: tool.attachmentRefTargetKeys
    ? [...tool.attachmentRefTargetKeys]
    : undefined,
  inputSchema: { ...tool.inputSchema },
})

const describeAttachmentRules: NonNullable<ContextContributor['describe']> = ({ input }) => {
  const attachmentSourceIds = [
    ...new Set(
      input.context.attachmentRefs.flatMap((descriptor) => [
        String(descriptor.fileId),
        String(descriptor.messageId),
      ]),
    ),
  ].sort()
  const capturedAt =
    input.context.attachmentRefs
      .map((descriptor) => descriptor.messageCreatedAt)
      .sort()
      .at(-1) ?? input.context.run.createdAt

  return {
    authority: 'user_input',
    capturedAt,
    conflictKey: null,
    dedupeKey: 'attachment-ref-rules',
    dependencies: [],
    expiresAt: null,
    priority: 100,
    provenance: {
      createdByRunId: String(input.context.run.id),
      sourceIds: attachmentSourceIds,
      sourceType: 'user_message',
      sourceVersion: null,
    },
    requirement: 'mandatory',
    sensitivity: 'private',
    supersedes: [],
    transformation: { kind: 'none' },
    visibility: 'model',
  } satisfies ContextArtifactMetadata
}

export const attachmentRulesContributor: ContextContributor = {
  build: (input) => {
    const capabilities = resolveInteractionCapabilities(input.activeTools.map(copyTool))
    const accessMode = resolveAttachmentRefAccessModeForCapabilities(capabilities)
    // The formatter only reads descriptors. Its mutable parameter predates the
    // contributor contract's deep-readonly compatibility boundary.
    const text = formatAttachmentRefRulesDeveloperMessage(
      input.context.attachmentRefs as AttachmentRefDescriptor[],
      {
        accessMode,
        includeExecuteHint: capabilities.sandboxExecute,
        includeGenerateImageHint: capabilities.generateImage,
        includeJustBashHint: accessMode === 'sandbox' && isJustBashAvailableInSandbox(),
      },
    )

    return [
      {
        kind: 'attachment_ref_rules',
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
  describe: describeAttachmentRules,
  id: 'attachment-rules',
  order: 5,
}
