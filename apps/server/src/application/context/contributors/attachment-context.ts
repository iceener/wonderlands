import type { AttachmentRefDescriptor } from '../../files/attachment-ref-context'
import {
  isJustBashAvailableInSandbox,
  resolveAttachmentRefAccessModeForCapabilities,
  resolveInteractionCapabilities,
} from '../../interactions/attachment-ref-access'
import { formatAttachmentRefContextDeveloperMessage } from '../../interactions/attachment-ref-prompt'
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

const describeAttachmentContext: NonNullable<ContextContributor['describe']> = ({ input }) => {
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
    authority: 'conversation',
    capturedAt,
    conflictKey: null,
    dedupeKey: 'attachment-ref-context',
    dependencies: [],
    expiresAt: null,
    priority: 90,
    provenance: {
      createdByRunId: String(input.context.run.id),
      sourceIds: attachmentSourceIds,
      sourceType: 'user_message',
      sourceVersion: null,
    },
    requirement: attachmentSourceIds.length > 0 ? 'preferred' : 'optional',
    sensitivity: 'restricted',
    supersedes: [],
    transformation: { kind: 'none' },
    visibility: 'model',
  } satisfies ContextArtifactMetadata
}

export const attachmentContextContributor: ContextContributor = {
  build: (input) => {
    const capabilities = resolveInteractionCapabilities(input.activeTools.map(copyTool))
    const accessMode = resolveAttachmentRefAccessModeForCapabilities(capabilities)
    // The formatter only reads descriptors. Its mutable parameter predates the
    // contributor contract's deep-readonly compatibility boundary.
    const text = formatAttachmentRefContextDeveloperMessage(
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
        kind: 'attachment_ref_context',
        messages: text
          ? [
              {
                content: [toTextContent(text)],
                role: 'developer',
              },
            ]
          : [],
        volatility: 'volatile',
      },
    ]
  },
  describe: describeAttachmentContext,
  id: 'attachment-context',
  order: 13,
}
