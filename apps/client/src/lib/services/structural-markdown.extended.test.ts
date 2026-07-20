import { describe, expect, test } from 'vitest'
import { buildStructuredMarkdown } from './markdown/structural-markdown'

describe('buildStructuredMarkdown', () => {
  test('builds structured paragraph content with inline nodes', () => {
    const blocks = buildStructuredMarkdown(
      'Paragraph with **bold** and [link](https://example.com).',
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', text: 'Paragraph with ' },
        { kind: 'strong' },
        { kind: 'text', text: ' and ' },
        { kind: 'link', href: 'https://example.com' },
        { kind: 'text', text: '.' },
      ],
    })
  })

  test('keeps tight list item text inline while preserving nested lists as blocks', () => {
    const blocks = buildStructuredMarkdown('- Parent\n  - Child')

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'list',
      items: [
        {
          inlines: [{ kind: 'group' }],
          blocks: [{ kind: 'list' }],
        },
      ],
    })
  })

  test('maps markdown code references to mention nodes', () => {
    const blocks = buildStructuredMarkdown('Review `#src/index.ts` with `@researcher`.')

    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', text: 'Review ' },
        { kind: 'file-mention', text: 'src/index.ts' },
        { kind: 'text', text: ' with ' },
        { kind: 'agent-mention', text: 'researcher' },
        { kind: 'text', text: '.' },
      ],
    })
  })

  test('keeps raw html as text rather than rendering it', () => {
    const blocks = buildStructuredMarkdown('<div>raw html</div>')

    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        id: 'block:0',
        inlines: [{ kind: 'text', id: 'block:0.html', text: '<div>raw html</div>' }],
      },
    ])
  })

  test('drops unsafe link targets from structured nodes', () => {
    const blocks = buildStructuredMarkdown('[x](javascript:alert(1))')

    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      inlines: [{ kind: 'link', href: null }],
    })
  })

  test('keeps streaming code blocks on plain line nodes when highlighting is disabled', () => {
    const blocks = buildStructuredMarkdown('```ts\nconst value = 42\n```', { highlight: false })

    expect(blocks).toEqual([
      {
        kind: 'code',
        id: 'block:0',
        model: {
          label: 'typescript',
          language: 'ts',
          lines: ['const value = 42'],
          highlightedLines: [],
        },
      },
    ])
  })
})
