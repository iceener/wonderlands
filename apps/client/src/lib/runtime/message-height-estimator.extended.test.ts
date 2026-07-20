import { asArtifactId, asToolCallId, type Block } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import {
  countPreparedTextLines,
  createMessageHeightEstimator,
  describeMessageHeightEstimate,
  findTightBubbleWidth,
  prepareTextLayout,
  supportsTightUserBubble,
} from './message-height-estimator'

const at = '2026-03-29T10:00:00.000Z'

describe('message height estimator', () => {
  test('finds a snug bubble width that preserves line count with a safety margin', () => {
    const prepared = prepareTextLayout(
      'This bubble should stay on the same number of lines while becoming as snug as possible.',
      15,
    )
    const maxWidth = 320
    const targetLineCount = countPreparedTextLines(prepared, maxWidth)
    const tightWidth = findTightBubbleWidth(prepared, maxWidth)

    expect(tightWidth).toBeLessThan(maxWidth)
    expect(tightWidth).toBeGreaterThan(0)
    expect(countPreparedTextLines(prepared, tightWidth)).toBe(targetLineCount)
  })

  test('keeps single-line bubbles close to their actual content width', () => {
    const prepared = prepareTextLayout('Short reply', 15)
    const maxWidth = 280
    const tightWidth = findTightBubbleWidth(prepared, maxWidth)

    expect(countPreparedTextLines(prepared, maxWidth)).toBe(1)
    expect(countPreparedTextLines(prepared, tightWidth)).toBe(1)
    expect(tightWidth).toBeLessThan(140)
  })

  test('keeps shrinkwrap line counting aligned for long unbroken tokens', () => {
    const prepared = prepareTextLayout(
      `https://example.com/reports/QUARTERLY-SNAPSHOT-${'A'.repeat(52)}`,
      15,
    )
    const maxWidth = 320
    const targetLineCount = countPreparedTextLines(prepared, maxWidth)
    const tightWidth = findTightBubbleWidth(prepared, maxWidth)

    expect(tightWidth).toBeLessThan(maxWidth)
    expect(tightWidth).toBeGreaterThan(0)
    expect(countPreparedTextLines(prepared, tightWidth)).toBe(targetLineCount)
  })

  test('predicts taller user messages when width shrinks or text grows', () => {
    const estimator = createMessageHeightEstimator()
    const message = {
      attachments: [],
      role: 'user' as const,
      status: 'complete' as const,
      text: 'This is a long user message that should wrap onto multiple lines in a narrower viewport.',
      blocks: [],
      finishReason: null,
    }

    const wideHeight = estimator.estimateMessageHeight(message, 720)
    const narrowHeight = estimator.estimateMessageHeight(message, 320)

    expect(narrowHeight).toBeGreaterThan(wideHeight)
  })

  test('switches rich user markdown out of the tight-bubble path while keeping plain text shrinkwrapped', () => {
    const estimator = createMessageHeightEstimator()
    const plainMessage = {
      attachments: [],
      role: 'user' as const,
      status: 'complete' as const,
      text: 'A plain sentence that should keep the snug bubble width behavior.',
      blocks: [],
      finishReason: null,
    }
    const markdownMessage = {
      attachments: [],
      role: 'user' as const,
      status: 'complete' as const,
      text: '# Heading\n\n- first item\n- second item\n\n`inline`',
      blocks: [],
      finishReason: null,
    }

    expect(supportsTightUserBubble(plainMessage.text)).toBe(true)
    expect(supportsTightUserBubble(markdownMessage.text)).toBe(false)
    expect(estimator.estimateMessageHeight(markdownMessage, 320)).toBeGreaterThan(
      estimator.estimateMessageHeight(plainMessage, 320),
    )
    expect(describeMessageHeightEstimate(markdownMessage)).toEqual({
      usesFallback: false,
      fallbackSurfaces: [],
    })
  })

  test('accounts for user attachments when estimating message height', () => {
    const estimator = createMessageHeightEstimator()
    const baseMessage = {
      attachments: [],
      role: 'user' as const,
      status: 'complete' as const,
      text: 'Shared summary',
      blocks: [],
      finishReason: null,
    }
    const attachmentMessage = {
      ...baseMessage,
      attachments: [
        {
          id: 'img-1',
          kind: 'image' as const,
          mime: 'image/png',
          name: 'receipt.png',
          size: 2048,
          url: 'blob:http://localhost/img-1',
        },
        {
          id: 'img-2',
          kind: 'image' as const,
          mime: 'image/png',
          name: 'whiteboard.png',
          size: 3072,
          url: 'blob:http://localhost/img-2',
        },
        {
          id: 'img-3',
          kind: 'image' as const,
          mime: 'image/png',
          name: 'diagram.png',
          size: 4096,
          url: 'blob:http://localhost/img-3',
        },
        {
          id: 'img-4',
          kind: 'image' as const,
          mime: 'image/png',
          name: 'notes.png',
          size: 5120,
          url: 'blob:http://localhost/img-4',
        },
      ],
    }

    expect(estimator.estimateMessageHeight(attachmentMessage, 520)).toBeGreaterThan(
      estimator.estimateMessageHeight(baseMessage, 520),
    )
    expect(estimator.estimateMessageHeight(attachmentMessage, 280)).toBeGreaterThan(
      estimator.estimateMessageHeight(attachmentMessage, 520),
    )
  })

  test('user image grid height matches visible attachments when markdown inlines the same image', () => {
    const estimator = createMessageHeightEstimator()
    const sharedUrl = 'https://example.com/shared-photo.png'
    const secondUrl = 'blob:http://localhost/img-only-in-grid'

    const withHiddenDuplicate = {
      attachments: [
        {
          id: 'img-inline',
          kind: 'image' as const,
          mime: 'image/png',
          name: 'shared.png',
          size: 100,
          url: sharedUrl,
        },
        {
          id: 'img-2',
          kind: 'image' as const,
          mime: 'image/png',
          name: 'other.png',
          size: 100,
          url: secondUrl,
        },
      ],
      role: 'user' as const,
      status: 'complete' as const,
      text: `Look ![ref](${sharedUrl})`,
      blocks: [],
      finishReason: null,
    }

    const equivalentVisible = {
      ...withHiddenDuplicate,
      attachments: [withHiddenDuplicate.attachments[1]],
    }

    expect(estimator.estimateMessageHeight(withHiddenDuplicate, 520)).toBe(
      estimator.estimateMessageHeight(equivalentVisible, 520),
    )
  })

  test('estimates assistant text blocks from markdown structure instead of one flat default', () => {
    const estimator = createMessageHeightEstimator()
    const textBlock: Block = {
      id: 'text-1',
      type: 'text',
      content:
        '# Heading\n\nParagraph text that should wrap over multiple lines.\n\n```ts\nconst answer = 42\n```',
      streaming: false,
      createdAt: at,
      renderState: {
        committedSegments: [
          { id: 'seg-1', source: '# Heading' },
          { id: 'seg-2', source: 'Paragraph text that should wrap over multiple lines.' },
          { id: 'seg-3', source: '```ts\nconst answer = 42\n```' },
        ],
        liveTail: '',
        processedContent:
          '# Heading\n\nParagraph text that should wrap over multiple lines.\n\n```ts\nconst answer = 42\n```',
        nextSegmentIndex: 3,
      },
    }

    const shortToolBlock: Block = {
      id: 'tool-1',
      type: 'tool_interaction',
      toolCallId: asToolCallId('call-1'),
      name: 'lookup_sales',
      args: {},
      status: 'running',
      createdAt: at,
    }

    expect(estimator.estimateBlockHeight(textBlock, 520)).toBeGreaterThan(
      estimator.estimateBlockHeight(shortToolBlock, 520),
    )
  })

  test('reuses finalized segment heights and only recomputes the live tail while streaming', () => {
    const finalizedSegmentsMeasured: string[] = []
    const estimator = createMessageHeightEstimator({
      onFinalizedSegmentHeightComputed: ({ id }) => {
        finalizedSegmentsMeasured.push(id)
      },
    })
    const baseBlock: Block = {
      id: 'text-streaming',
      type: 'text',
      content: '# Heading\n\nLive tail',
      streaming: true,
      createdAt: at,
      renderState: {
        committedSegments: [
          { id: 'seg-1', source: '# Heading' },
          { id: 'seg-2', source: 'Stable paragraph that has already been committed.' },
        ],
        liveTail: 'Live tail',
        processedContent:
          '# Heading\n\nStable paragraph that has already been committed.\n\nLive tail',
        nextSegmentIndex: 2,
      },
    }

    const firstHeight = estimator.estimateBlockHeight(baseBlock, 320)

    expect(finalizedSegmentsMeasured).toEqual(['seg-1', 'seg-2'])

    const secondHeight = estimator.estimateBlockHeight(
      {
        ...baseBlock,
        content: `${baseBlock.content} that keeps growing while the stream is still open and forces additional wrapping in the estimate`,
        renderState: {
          ...baseBlock.renderState,
          liveTail:
            'Live tail that keeps growing while the stream is still open and forces additional wrapping in the estimate',
          processedContent:
            '# Heading\n\nStable paragraph that has already been committed.\n\nLive tail that keeps growing while the stream is still open and forces additional wrapping in the estimate',
        },
      },
      320,
    )

    expect(finalizedSegmentsMeasured).toEqual(['seg-1', 'seg-2'])
    expect(secondHeight).toBeGreaterThan(firstHeight)
  })

  test('uses conservative fallback heights for rich surfaces and still accounts for cancellation appendix', () => {
    const estimator = createMessageHeightEstimator()
    const artifactBlock: Block = {
      id: 'artifact-1',
      type: 'artifact',
      artifactId: asArtifactId('artifact-1'),
      kind: 'markdown',
      title: 'Report',
      preview: '# Summary',
      createdAt: at,
    }
    const artifactBlockWithLongPreview: Block = {
      ...artifactBlock,
      preview:
        '# Summary\n\nThis preview has enough content to occupy space.\n\n- item one\n- item two\n- item three',
    }
    const richTextBlock: Block = {
      id: 'text-rich',
      type: 'text',
      content: '```ts\nconst answer = 42\n```',
      streaming: false,
      createdAt: at,
      renderState: {
        committedSegments: [{ id: 'seg-code', source: '```ts\nconst answer = 42\n```' }],
        liveTail: '',
        processedContent: '```ts\nconst answer = 42\n```',
        nextSegmentIndex: 1,
      },
    }

    const completeMessage = {
      attachments: [],
      role: 'assistant' as const,
      status: 'complete' as const,
      text: '',
      blocks: [artifactBlock],
      finishReason: 'stop' as const,
    }
    const cancelledMessage = {
      ...completeMessage,
      finishReason: 'cancelled' as const,
    }

    expect(estimator.estimateBlockHeight(artifactBlock, 520)).toBe(
      estimator.estimateBlockHeight(artifactBlockWithLongPreview, 520),
    )
    expect(estimator.estimateBlockHeight(richTextBlock, 520)).toBeGreaterThanOrEqual(148)
    expect(estimator.estimateMessageHeight(cancelledMessage, 520)).toBeGreaterThan(
      estimator.estimateMessageHeight(completeMessage, 520),
    )
  })

  test('describes fallback surfaces for rich assistant content while keeping plain text deterministic', () => {
    const richAssistantMessage = {
      attachments: [],
      role: 'assistant' as const,
      status: 'complete' as const,
      text: '',
      finishReason: 'stop' as const,
      blocks: [
        {
          id: 'thinking-1',
          type: 'thinking' as const,
          title: 'Thinking',
          content: '...',
          status: 'done' as const,
          createdAt: at,
        },
        {
          id: 'text-2',
          type: 'text' as const,
          content: '```ts\nconst answer = 42\n```\n\n|a|b|',
          streaming: false,
          createdAt: at,
          renderState: {
            committedSegments: [
              { id: 'seg-4', source: '```ts\nconst answer = 42\n```' },
              { id: 'seg-5', source: '|a|b|\n|---|---|\n|1|2|' },
            ],
            liveTail: '',
            processedContent: '```ts\nconst answer = 42\n```\n\n|a|b|\n|---|---|\n|1|2|',
            nextSegmentIndex: 2,
          },
        },
      ],
    }
    const plainAssistantMessage = {
      attachments: [],
      role: 'assistant' as const,
      status: 'complete' as const,
      text: '',
      finishReason: 'stop' as const,
      blocks: [
        {
          id: 'error-plain',
          type: 'error' as const,
          message: 'A plain error message.',
          createdAt: at,
        },
        {
          id: 'text-plain',
          type: 'text' as const,
          content: 'A normal paragraph.',
          streaming: false,
          createdAt: at,
          renderState: {
            committedSegments: [{ id: 'seg-plain', source: 'A normal paragraph.' }],
            liveTail: '',
            processedContent: 'A normal paragraph.',
            nextSegmentIndex: 1,
          },
        },
      ],
    }

    expect(describeMessageHeightEstimate(richAssistantMessage)).toEqual({
      usesFallback: true,
      fallbackSurfaces: ['thinking_block', 'code_fence', 'table_block'],
    })
    expect(describeMessageHeightEstimate(plainAssistantMessage)).toEqual({
      usesFallback: false,
      fallbackSurfaces: [],
    })
  })

  test('surfaces fallback blocks for user markdown when the message contains fenced code or tables', () => {
    const richUserMessage = {
      attachments: [],
      role: 'user' as const,
      status: 'complete' as const,
      text: '```ts\nconst answer = 42\n```\n\n|a|b|\n|---|---|\n|1|2|',
      finishReason: null,
      blocks: [],
    }

    expect(describeMessageHeightEstimate(richUserMessage)).toEqual({
      usesFallback: true,
      fallbackSurfaces: ['code_fence', 'table_block'],
    })
  })

  test('estimates plain error text deterministically from message length', () => {
    const estimator = createMessageHeightEstimator()
    const shortError: Block = {
      id: 'error-1',
      type: 'error',
      message: 'Short error.',
      createdAt: at,
    }
    const longError: Block = {
      ...shortError,
      id: 'error-2',
      message:
        'Longer error text that should wrap across multiple lines in a narrower viewport and therefore take more space.',
    }

    expect(estimator.estimateBlockHeight(longError, 280)).toBeGreaterThan(
      estimator.estimateBlockHeight(shortError, 280),
    )
  })
})
