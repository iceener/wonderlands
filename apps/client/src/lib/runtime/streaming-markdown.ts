import type { MarkdownSegment, TextRenderState } from '@wonderlands/contracts/chat'
import { parseMarkdownIntoBlocks } from './parse-blocks'

export type IncrementalMarkdownView = TextRenderState & {
  compactionDeferred: boolean
}

export interface SyncIncrementalMarkdownViewOptions {
  blockId: string
  content: string
  streaming: boolean
  allowCompaction: boolean
}

const STREAMING_LIST_START = /^[ \t]*(?:[-*+]|\d+[.)])\s+/u

const splitBlocks = (
  blocks: string[],
  streaming: boolean,
  source: string,
): {
  finalizedSources: string[]
  liveTail: string
} => {
  if (blocks.length === 0) {
    return {
      finalizedSources: [],
      liveTail: '',
    }
  }

  if (!streaming) {
    return {
      finalizedSources: blocks,
      liveTail: '',
    }
  }

  // Lists need parent context to render correctly. If we compact them item by
  // item during streaming, nested and continued lists turn into separate top-level
  // <ul>/<ol> trees when each segment is rendered in its own MarkdownHtml wrapper.
  if (STREAMING_LIST_START.test(source)) {
    return {
      finalizedSources: [],
      liveTail: source,
    }
  }

  return {
    finalizedSources: blocks.slice(0, -1),
    liveTail: blocks[blocks.length - 1] ?? '',
  }
}

const toSegments = (blockId: string, startIndex: number, sources: string[]): MarkdownSegment[] =>
  sources.map((source, offset) => ({
    id: `${blockId}:segment:${startIndex + offset}`,
    source,
  }))

export const createIncrementalMarkdownView = (): IncrementalMarkdownView => ({
  committedSegments: [],
  liveTail: '',
  processedContent: '',
  nextSegmentIndex: 0,
  compactionDeferred: false,
})

export const rebuildIncrementalMarkdownView = ({
  blockId,
  content,
  streaming,
}: Omit<SyncIncrementalMarkdownViewOptions, 'allowCompaction'>): IncrementalMarkdownView => {
  if (!content) {
    return createIncrementalMarkdownView()
  }

  const blocks = parseMarkdownIntoBlocks(content)
  const { finalizedSources, liveTail } = splitBlocks(blocks, streaming, content)

  return {
    committedSegments: toSegments(blockId, 0, finalizedSources),
    liveTail,
    processedContent: content,
    nextSegmentIndex: finalizedSources.length,
    compactionDeferred: false,
  }
}

export const syncIncrementalMarkdownView = (
  current: TextRenderState | IncrementalMarkdownView,
  { blockId, content, streaming, allowCompaction }: SyncIncrementalMarkdownViewOptions,
): IncrementalMarkdownView => {
  const currentView: IncrementalMarkdownView =
    'compactionDeferred' in current
      ? current
      : {
          ...current,
          compactionDeferred: false,
        }

  if (!content) {
    return createIncrementalMarkdownView()
  }

  if (
    currentView.processedContent.length > content.length ||
    !content.startsWith(currentView.processedContent)
  ) {
    return rebuildIncrementalMarkdownView({ blockId, content, streaming })
  }

  const delta = content.slice(currentView.processedContent.length)
  const needsParsing =
    delta.length > 0 ||
    (!streaming && currentView.liveTail.length > 0) ||
    currentView.compactionDeferred

  if (!needsParsing) {
    return {
      ...currentView,
      processedContent: content,
      compactionDeferred: false,
    }
  }

  const candidateTail = currentView.liveTail + delta
  const blocks = parseMarkdownIntoBlocks(candidateTail)
  const { finalizedSources, liveTail } = splitBlocks(blocks, streaming, candidateTail)

  if (!allowCompaction && finalizedSources.length > 0) {
    return {
      ...currentView,
      liveTail: candidateTail,
      processedContent: content,
      compactionDeferred: true,
    }
  }

  return {
    committedSegments: currentView.committedSegments.concat(
      toSegments(blockId, currentView.nextSegmentIndex, finalizedSources),
    ),
    liveTail,
    processedContent: content,
    nextSegmentIndex: currentView.nextSegmentIndex + finalizedSources.length,
    compactionDeferred: false,
  }
}
