import type { ArtifactId, ToolCallId } from './ids'
import type { ProviderName, ToolAppsMeta, WebSearchReference, WebSearchStatus } from './shared'

export type MessageAttachmentKind = 'image' | 'file'

export interface MessageAttachment {
  id: string
  kind: MessageAttachmentKind
  mime: string
  name: string
  size: number
  thumbnailUrl?: string
  url: string
}

interface BaseBlock<TType extends string> {
  createdAt: string
  id: string
  sourceRunId?: string
  type: TType
}

export interface MarkdownSegment {
  id: string
  source: string
}

export interface TextRenderState {
  committedSegments: MarkdownSegment[]
  liveTail: string
  nextSegmentIndex: number
  processedContent: string
}

export interface TextBlock extends BaseBlock<'text'> {
  content: string
  renderState: TextRenderState
  streaming: boolean
}

export interface ThinkingBlock extends BaseBlock<'thinking'> {
  content: string
  status: 'thinking' | 'done'
  title: string
}

export interface ToolApprovalState {
  description: string | null
  remembered: boolean | null
  status: 'approved' | 'rejected'
  targetRef: string | null
  waitId: string
}

export interface ToolInteractionBlock extends BaseBlock<'tool_interaction'> {
  approval?: ToolApprovalState
  appsMeta?: ToolAppsMeta | null
  args: Record<string, unknown> | null
  childRunId?: string
  confirmation?: {
    description: string | null
    ownerRunId?: string
    targetRef: string | null
    waitId: string
  }
  finishedAt?: string
  name: string
  output?: unknown
  sourceRunId?: string
  status: 'running' | 'awaiting_confirmation' | 'complete' | 'error'
  toolCallId: ToolCallId
}

export interface WebSearchBlock extends BaseBlock<'web_search'> {
  finishedAt?: string
  patterns: string[]
  provider: ProviderName
  queries: string[]
  references: WebSearchReference[]
  responseId: string | null
  searchId: string
  status: WebSearchStatus
  targetUrls: string[]
}

export interface PersistedAssistantToolBlock {
  approval?: ToolApprovalState
  appsMeta?: ToolAppsMeta | null
  args: Record<string, unknown> | null
  childRunId?: string
  confirmation?: {
    description: string | null
    ownerRunId?: string
    targetRef: string | null
    waitId: string
  }
  createdAt: string
  finishedAt?: string
  id: string
  name: string
  output?: unknown
  sourceRunId?: string
  status: ToolInteractionBlock['status']
  toolCallId: ToolCallId | string
  type: 'tool_interaction'
}

export interface PersistedAssistantThinkingBlock {
  content: string
  createdAt: string
  id: string
  sourceRunId?: string
  status: ThinkingBlock['status']
  title: string
  type: 'thinking'
}

export interface PersistedAssistantTextBlock {
  content: string
  createdAt: string
  id: string
  sourceRunId?: string
  type: 'text'
}

export interface PersistedAssistantWebSearchBlock {
  createdAt: string
  finishedAt?: string
  id: string
  patterns: string[]
  provider: ProviderName
  queries: string[]
  references: WebSearchReference[]
  responseId: string | null
  searchId: string
  sourceRunId?: string
  status: WebSearchStatus
  targetUrls: string[]
  type: 'web_search'
}

export type PersistedAssistantTranscriptBlock =
  | PersistedAssistantThinkingBlock
  | PersistedAssistantTextBlock
  | PersistedAssistantToolBlock
  | PersistedAssistantWebSearchBlock

export interface PersistedAssistantTranscriptV1 {
  toolBlocks: PersistedAssistantToolBlock[]
  version: 1
  webSearchBlocks?: PersistedAssistantWebSearchBlock[]
}

export interface PersistedAssistantTranscriptV2 {
  blocks: PersistedAssistantTranscriptBlock[]
  toolBlocks: PersistedAssistantToolBlock[]
  version: 2
  webSearchBlocks: PersistedAssistantWebSearchBlock[]
}

export type PersistedAssistantTranscript =
  | PersistedAssistantTranscriptV1
  | PersistedAssistantTranscriptV2

export type ArtifactKind = 'markdown' | 'json' | 'text' | 'file'

export interface ArtifactBlock extends BaseBlock<'artifact'> {
  artifactId: ArtifactId
  description?: string
  kind: ArtifactKind
  path?: string
  preview: string
  title: string
}

export interface ErrorBlock extends BaseBlock<'error'> {
  message: string
}

export type Block =
  | TextBlock
  | ThinkingBlock
  | ToolInteractionBlock
  | WebSearchBlock
  | ArtifactBlock
  | ErrorBlock
