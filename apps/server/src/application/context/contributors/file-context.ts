import type { AiProviderName } from '../../../domain/ai/types'
import type { SessionMessageRecord } from '../../../domain/sessions/session-message-repository'
import { toFileContextMessages, type VisibleFileContextEntry } from '../../files/file-context'
import {
  resolveAttachmentRefAccessModeForCapabilities,
  resolveInteractionCapabilities,
} from '../../interactions/attachment-ref-access'
import { collectInlineReferencedUploadedFileIds } from '../../interactions/model-visible-user-content'
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

const resolveRequestedProvider = (input: ContextContributorInput): AiProviderName | null => {
  if (input.overrides.provider) {
    return input.overrides.provider
  }

  const provider = input.context.run.configSnapshot.provider

  return provider === 'openai' || provider === 'google' || provider === 'openrouter'
    ? provider
    : null
}

const describeFileContext: NonNullable<ContextContributor['describe']> = ({ input }) => {
  // These helpers and branded IDs are read-only in practice; their mutable parameter types predate
  // the contributor contract's deep-readonly compatibility boundary.
  const visibleMessages = input.context.visibleMessages as SessionMessageRecord[]
  const visibleFiles = input.context.visibleFiles as VisibleFileContextEntry[]
  const inlineReferencedFileIds = collectInlineReferencedUploadedFileIds(visibleMessages)
  const sourceIds = [
    ...new Set(
      visibleFiles.flatMap((entry) => [
        String(entry.fileId),
        ...(entry.messageId ? [String(entry.messageId)] : []),
      ]),
    ),
  ].sort()
  const messagesById = new Map(visibleMessages.map((message) => [String(message.id), message]))
  const capturedAt =
    visibleFiles
      .map((entry) =>
        entry.messageId
          ? (messagesById.get(String(entry.messageId))?.createdAt ?? input.context.run.createdAt)
          : input.context.run.createdAt,
      )
      .sort()
      .at(-1) ?? input.context.run.createdAt
  const hasUserInput = visibleFiles.some((entry) => {
    if (!entry.messageId) {
      return false
    }

    return messagesById.get(String(entry.messageId))?.authorKind === 'user'
  })
  const hasExplicitReference = visibleFiles.some(
    (entry) => entry.messageId !== null || inlineReferencedFileIds.has(entry.fileId),
  )

  return {
    authority: hasUserInput ? 'user_input' : 'conversation',
    capturedAt,
    conflictKey: null,
    dedupeKey: 'file-context',
    dependencies: [],
    expiresAt: null,
    priority: 80,
    provenance: {
      createdByRunId: String(input.context.run.id),
      sourceIds,
      sourceType: 'file',
      sourceVersion: null,
    },
    requirement: hasExplicitReference ? 'preferred' : 'optional',
    sensitivity: 'restricted',
    supersedes: [],
    // VisibleFileContextEntry does not retain original/included byte counts. Even when its text
    // carries the legacy "[truncated]" marker, exact truncation metadata is not reliably known.
    transformation: { kind: 'none' },
    visibility: 'model',
  } satisfies ContextArtifactMetadata
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
  describe: describeFileContext,
  id: 'file-context',
  order: 14,
}
