import {
  type PreparedTextWithSegments,
  prepareWithSegments,
  layout as pretextLayout,
  walkLineRanges,
} from '@chenglou/pretext'
import type {
  Block,
  MarkdownSegment,
  MessageAttachment,
  MessageFinishReason,
  MessageRole,
  MessageStatus,
  TextBlock,
} from '@wonderlands/contracts/chat'
import { filterInlineRenderedImageAttachments } from '../attachments/model-visible'
import {
  ATTACHMENT_SECTION_GAP,
  estimateAttachmentFileStackHeight,
  estimateAttachmentImageGridHeight,
  partitionAttachments,
  USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
  USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO,
} from '../attachments/presentation'
import { parseMarkdownIntoBlocks } from './parse-blocks'

const MIN_CONTENT_WIDTH = 120
const USER_BUBBLE_VERTICAL_PADDING = 24
const USER_MESSAGE_CHROME_HEIGHT = 58
const ASSISTANT_MESSAGE_CHROME_HEIGHT = 48
const CANCELLED_APPENDIX_HEIGHT = 30
const WAITING_BLOCK_HEIGHT = 20
const COLLAPSED_REASONING_HEIGHT = 30
const COLLAPSED_TOOL_HEIGHT = 30
const BASE_ERROR_BLOCK_HEIGHT = 18
const RICH_BLOCK_FALLBACK_HEIGHT = 148
const MIN_TEXT_BLOCK_HEIGHT = 26

export interface PreparedText {
  fontSize: number
  prepared: PreparedTextWithSegments
  text: string
}

interface PreparedTextCacheEntry {
  prepared: PreparedText
  text: string
}

interface FinalizedSegmentHeightCacheEntry {
  height: number
  source: string
}

export interface MessageHeightEstimateInput {
  attachments?: MessageAttachment[]
  blocks: Block[]
  finishReason: MessageFinishReason | null
  role: MessageRole
  status: MessageStatus
  text: string
}

export interface MessageHeightEstimator {
  estimateBlockHeight: (block: Block, width: number) => number
  estimateMessageHeight: (message: MessageHeightEstimateInput, width: number) => number
}

export type HeightEstimateFallbackSurface =
  | 'artifact_block'
  | 'code_fence'
  | 'html_block'
  | 'image_block'
  | 'math_block'
  | 'table_block'
  | 'thinking_block'
  | 'tool_block'

export interface MessageHeightEstimateProfile {
  fallbackSurfaces: HeightEstimateFallbackSurface[]
  usesFallback: boolean
}

export interface MessageHeightEstimatorOptions {
  onFinalizedSegmentHeightComputed?: (segment: {
    id: string
    height: number
    width: number
  }) => void
}

const HEADING_REGEX = /^(#{1,6})\s+(.*)$/s
const CODE_FENCE_REGEX = /^```/
const LIST_ITEM_TEST_REGEX = /^\s*(?:[-*+]|\d+\.)\s+/m
const LIST_ITEM_REPLACE_REGEX = /^\s*(?:[-*+]|\d+\.)\s+/gm
const BLOCKQUOTE_REGEX = /^>\s?/gm
const TABLE_REGEX = /^\s*\|.+\|\s*$/m
const HTML_BLOCK_REGEX = /^\s*</
const MATH_BLOCK_REGEX = /^\s*\$\$/
const IMAGE_BLOCK_REGEX = /!\[[^\]]*\]\([^)]+\)/u
const INLINE_LINK_REGEX = /\[[^\]]+\]\([^)]+\)/u
const INLINE_CODE_REGEX = /(^|[^`])`[^`\n]+`/u
const INLINE_EMPHASIS_REGEX = /(^|[^\w\\])(?:\*\*|__|\*|_)[^*_]+(?:\*\*|__|\*|_)/u
const USER_RICH_MARKDOWN_REGEX =
  /(^|\n)(#{1,6}\s|>\s|\s*[-*+]\s|\s*\d+\.\s|```|~~~|\|.+\||<\w+|\$\$)/m

const normalizeWidth = (width: number, minimumWidth: number): number =>
  Math.max(minimumWidth, Math.floor(width))

const clampWidth = (width: number): number => normalizeWidth(width, MIN_CONTENT_WIDTH)

const buildFontShorthand = (fontSize: number): string => `${fontSize}px "Lexend Deca", Inter`

const uniqueFallbackSurfaces = (
  surfaces: readonly HeightEstimateFallbackSurface[],
): HeightEstimateFallbackSurface[] => Array.from(new Set(surfaces))

const getMarkdownFallbackSurface = (source: string): HeightEstimateFallbackSurface | null => {
  const trimmed = source.trim()
  if (!trimmed) {
    return null
  }

  if (CODE_FENCE_REGEX.test(trimmed)) {
    return 'code_fence'
  }

  if (TABLE_REGEX.test(trimmed) || trimmed.includes('<table')) {
    return 'table_block'
  }

  if (HTML_BLOCK_REGEX.test(trimmed)) {
    return 'html_block'
  }

  if (MATH_BLOCK_REGEX.test(trimmed)) {
    return 'math_block'
  }

  if (IMAGE_BLOCK_REGEX.test(trimmed)) {
    return 'image_block'
  }

  return null
}

export const supportsTightUserBubble = (markdown: string): boolean => {
  const trimmed = markdown.trim()
  if (!trimmed) {
    return true
  }

  if (trimmed.includes('\n\n')) {
    return false
  }

  return !(
    USER_RICH_MARKDOWN_REGEX.test(trimmed) ||
    IMAGE_BLOCK_REGEX.test(trimmed) ||
    INLINE_LINK_REGEX.test(trimmed) ||
    INLINE_CODE_REGEX.test(trimmed) ||
    INLINE_EMPHASIS_REGEX.test(trimmed)
  )
}

export const prepareTextLayout = (text: string, fontSize: number): PreparedText => ({
  fontSize,
  prepared: prepareWithSegments(text, buildFontShorthand(fontSize)),
  text,
})

export const countPreparedTextLines = (
  prepared: PreparedText,
  availableWidth: number,
  minimumWidth = 1,
): number => {
  const clampedWidth = normalizeWidth(availableWidth, minimumWidth)
  const { lineCount } = pretextLayout(prepared.prepared, clampedWidth, prepared.fontSize * 1.6)
  return Math.max(1, lineCount)
}

const layoutPreparedText = (
  prepared: PreparedText,
  availableWidth: number,
  lineHeight: number,
): number => {
  const clampedWidth = normalizeWidth(availableWidth, MIN_CONTENT_WIDTH)
  const { lineCount } = pretextLayout(prepared.prepared, clampedWidth, lineHeight)
  return Math.max(lineHeight, lineCount * lineHeight)
}

export const findTightBubbleWidth = (prepared: PreparedText, maxWidth: number): number => {
  const clampedMaxWidth = normalizeWidth(maxWidth, 1)
  let maxLineWidth = 0
  walkLineRanges(prepared.prepared, clampedMaxWidth, (line) => {
    if (line.width > maxLineWidth) maxLineWidth = line.width
  })
  return Math.min(clampedMaxWidth, Math.max(1, Math.ceil(maxLineWidth)))
}

const estimateTextHeight = (
  getPreparedText: (cacheKey: string, text: string, fontSize: number) => PreparedText,
  cacheKey: string,
  text: string,
  width: number,
  fontSize: number,
  lineHeight: number,
): number => layoutPreparedText(getPreparedText(cacheKey, text, fontSize), width, lineHeight)

const estimateMarkdownSourceHeight = (
  source: string,
  width: number,
  cacheKey: string,
  getPreparedText: (cacheKey: string, text: string, fontSize: number) => PreparedText,
): number => {
  const trimmed = source.trim()
  if (!trimmed) {
    return 0
  }

  const fallbackSurface = getMarkdownFallbackSurface(trimmed)
  if (fallbackSurface) {
    return RICH_BLOCK_FALLBACK_HEIGHT
  }

  const headingMatch = trimmed.match(HEADING_REGEX)
  if (headingMatch) {
    const level = headingMatch[1].length
    const text = headingMatch[2]
    const fontSize = Math.max(15, 25 - level * 2)
    const lineHeight = Math.max(22, 31 - level * 2)

    return (
      estimateTextHeight(
        getPreparedText,
        `${cacheKey}:heading:${level}`,
        text,
        width,
        fontSize,
        lineHeight,
      ) + 10
    )
  }

  if (trimmed.startsWith('>')) {
    const text = trimmed.replace(BLOCKQUOTE_REGEX, '')
    return (
      estimateTextHeight(getPreparedText, `${cacheKey}:blockquote`, text, width - 16, 15, 24) + 16
    )
  }

  if (LIST_ITEM_TEST_REGEX.test(trimmed)) {
    const listText = trimmed.replace(LIST_ITEM_REPLACE_REGEX, '')
    return (
      estimateTextHeight(getPreparedText, `${cacheKey}:list`, listText, width - 20, 15, 24) + 12
    )
  }

  return estimateTextHeight(getPreparedText, `${cacheKey}:paragraph`, trimmed, width, 15, 24) + 8
}

const getTextBlockLiveTailSources = (block: TextBlock): string[] => {
  if (block.renderState.liveTail) {
    return parseMarkdownIntoBlocks(block.renderState.liveTail)
  }

  if (block.renderState.committedSegments.length > 0 || !block.content) {
    return []
  }

  return parseMarkdownIntoBlocks(block.content)
}

const getTextBlockSources = (block: TextBlock): string[] => [
  ...block.renderState.committedSegments.map((segment) => segment.source),
  ...getTextBlockLiveTailSources(block),
]

const getBlockFallbackSurfaces = (block: Block): HeightEstimateFallbackSurface[] => {
  switch (block.type) {
    case 'thinking':
      return ['thinking_block']

    case 'tool_interaction':
      return ['tool_block']

    case 'artifact':
      return ['artifact_block']

    case 'error':
      return []

    case 'text':
      return uniqueFallbackSurfaces(
        getTextBlockSources(block).flatMap((source) => {
          const fallbackSurface = getMarkdownFallbackSurface(source)
          return fallbackSurface ? [fallbackSurface] : []
        }),
      )
  }

  return []
}

export const describeMessageHeightEstimate = (
  message: MessageHeightEstimateInput,
): MessageHeightEstimateProfile => {
  if (message.role === 'user') {
    const fallbackSurfaces = uniqueFallbackSurfaces(
      parseMarkdownIntoBlocks(message.text).flatMap((source) => {
        const fallbackSurface = getMarkdownFallbackSurface(source)
        return fallbackSurface ? [fallbackSurface] : []
      }),
    )

    return {
      fallbackSurfaces,
      usesFallback: fallbackSurfaces.length > 0,
    }
  }

  const fallbackSurfaces = uniqueFallbackSurfaces(
    message.blocks.flatMap((block) => getBlockFallbackSurfaces(block)),
  )

  return {
    fallbackSurfaces,
    usesFallback: fallbackSurfaces.length > 0,
  }
}

const MAX_CACHE_SIZE = 2000

const evictOldest = <K, V>(map: Map<K, V>, keepCount: number) => {
  if (map.size <= keepCount) return
  let toDelete = map.size - keepCount
  for (const key of map.keys()) {
    if (toDelete <= 0) break
    map.delete(key)
    toDelete--
  }
}

export const createMessageHeightEstimator = (
  options: MessageHeightEstimatorOptions = {},
): MessageHeightEstimator => {
  const preparedTextCache = new Map<string, PreparedTextCacheEntry>()
  const finalizedSegmentHeightCache = new Map<string, FinalizedSegmentHeightCacheEntry>()

  const getPreparedText = (cacheKey: string, text: string, fontSize: number): PreparedText => {
    const normalizedKey = `${cacheKey}:${fontSize}`
    const cached = preparedTextCache.get(normalizedKey)

    if (cached && cached.text === text) {
      return cached.prepared
    }

    const prepared = prepareTextLayout(text, fontSize)
    preparedTextCache.set(normalizedKey, {
      prepared,
      text,
    })
    evictOldest(preparedTextCache, MAX_CACHE_SIZE)
    return prepared
  }

  // Committed segments are immutable and keep stable ids across stream updates.
  const getFinalizedSegmentHeight = (segment: MarkdownSegment, width: number): number => {
    const clampedWidth = clampWidth(width)
    const cacheKey = `${segment.id}:${clampedWidth}`
    const cached = finalizedSegmentHeightCache.get(cacheKey)

    if (cached && cached.source === segment.source) {
      return cached.height
    }

    const height = estimateMarkdownSourceHeight(
      segment.source,
      clampedWidth,
      cacheKey,
      getPreparedText,
    )
    finalizedSegmentHeightCache.set(cacheKey, {
      height,
      source: segment.source,
    })
    evictOldest(finalizedSegmentHeightCache, MAX_CACHE_SIZE)
    options.onFinalizedSegmentHeightComputed?.({
      id: segment.id,
      height,
      width: clampedWidth,
    })
    return height
  }

  const estimateTextBlockHeight = (block: TextBlock, width: number): number => {
    const contentWidth = clampWidth(width - 8)
    let totalHeight = 0

    for (const segment of block.renderState.committedSegments) {
      totalHeight += getFinalizedSegmentHeight(segment, contentWidth)
    }

    const liveTailSources = getTextBlockLiveTailSources(block)

    for (let index = 0; index < liveTailSources.length; index += 1) {
      totalHeight += estimateMarkdownSourceHeight(
        liveTailSources[index],
        contentWidth,
        `${block.id}:live:${index}`,
        getPreparedText,
      )
    }

    return Math.max(MIN_TEXT_BLOCK_HEIGHT, totalHeight + 12)
  }

  const estimateUserTextHeight = (source: string, width: number): number => {
    if (supportsTightUserBubble(source)) {
      return estimateTextHeight(getPreparedText, `user:${source}`, source, width, 15, 24)
    }

    const blocks = parseMarkdownIntoBlocks(source)
    if (blocks.length === 0) {
      return estimateTextHeight(getPreparedText, 'user:empty', ' ', width, 15, 24)
    }

    return Math.max(
      MIN_TEXT_BLOCK_HEIGHT,
      blocks.reduce((totalHeight, blockSource, index) => {
        return (
          totalHeight +
          estimateMarkdownSourceHeight(
            blockSource,
            width,
            `user:markdown:${index}:${blockSource}`,
            getPreparedText,
          )
        )
      }, 0),
    )
  }

  const estimateBlockHeight = (block: Block, width: number): number => {
    const availableWidth = clampWidth(width)

    switch (block.type) {
      case 'text':
        return estimateTextBlockHeight(block, availableWidth)

      case 'thinking':
        return COLLAPSED_REASONING_HEIGHT

      case 'tool_interaction':
        return COLLAPSED_TOOL_HEIGHT

      case 'artifact':
        return RICH_BLOCK_FALLBACK_HEIGHT

      case 'error':
        return (
          BASE_ERROR_BLOCK_HEIGHT +
          estimateTextHeight(
            getPreparedText,
            `${block.id}:error`,
            block.message,
            availableWidth - 20,
            13,
            20,
          )
        )
    }

    return RICH_BLOCK_FALLBACK_HEIGHT
  }

  const estimateMessageHeight = (message: MessageHeightEstimateInput, width: number): number => {
    const availableWidth = clampWidth(width)

    if (message.role === 'user') {
      const bubbleWidth = clampWidth(
        availableWidth * USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO -
          USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
      )
      const rawAttachments = message.attachments ?? []
      const attachments = filterInlineRenderedImageAttachments(rawAttachments, message.text)
      const { images, files } = partitionAttachments(attachments)
      const hasText = message.text.trim().length > 0
      const textHeight = hasText ? estimateUserTextHeight(message.text, bubbleWidth) : 0

      let contentHeight = 0

      if (images.length > 0) {
        contentHeight += estimateAttachmentImageGridHeight(images.length, bubbleWidth)
      }

      if (textHeight > 0) {
        if (contentHeight > 0) {
          contentHeight += ATTACHMENT_SECTION_GAP
        }

        contentHeight += textHeight
      }

      if (files.length > 0) {
        if (contentHeight > 0) {
          contentHeight += ATTACHMENT_SECTION_GAP
        }

        contentHeight += estimateAttachmentFileStackHeight(files.length)
      }

      if (contentHeight === 0) {
        contentHeight = estimateTextHeight(getPreparedText, 'user:empty', ' ', bubbleWidth, 15, 24)
      }

      return USER_MESSAGE_CHROME_HEIGHT + USER_BUBBLE_VERTICAL_PADDING + contentHeight
    }

    const blocksHeight =
      message.blocks.length > 0
        ? message.blocks.reduce((sum, block) => sum + estimateBlockHeight(block, availableWidth), 0)
        : message.status === 'streaming'
          ? WAITING_BLOCK_HEIGHT
          : 0

    return (
      ASSISTANT_MESSAGE_CHROME_HEIGHT +
      blocksHeight +
      (message.finishReason === 'cancelled' ? CANCELLED_APPENDIX_HEIGHT : 0)
    )
  }

  return {
    estimateBlockHeight,
    estimateMessageHeight,
  }
}
