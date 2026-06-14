import { describe, expect, test } from 'vitest'
import { parseMarkdownIntoBlocks } from './parse-blocks'

describe('parseMarkdownIntoBlocks', () => {
  test('keeps headings separate from following paragraphs', () => {
    const blocks = parseMarkdownIntoBlocks('# Heading\n\nBody copy')

    expect(blocks).toEqual(['# Heading\n\n', 'Body copy'])
  })

  test('keeps footnote content in a single parse tree', () => {
    const markdown = ['Alpha with a footnote.[^note]', '', '[^note]: Footnote definition'].join(
      '\n',
    )

    expect(parseMarkdownIntoBlocks(markdown)).toEqual([markdown])
  })

  test('keeps nested html blocks together', () => {
    const markdown = [
      '<div>',
      '<section>',
      'nested html',
      '</section>',
      '</div>',
      '',
      'After block',
    ].join('\n')

    const blocks = parseMarkdownIntoBlocks(markdown)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toContain('<section>')
    expect(blocks[0]).toContain('</div>')
    expect(blocks[1]).toContain('After block')
  })

  test('keeps code fences separate from following paragraphs', () => {
    const markdown = ['```ts', 'const value = 42', '```', '', 'Next paragraph'].join('\n')

    const blocks = parseMarkdownIntoBlocks(markdown).filter((block) => block.trim().length > 0)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toContain('```ts')
    expect(blocks[0]).toContain('const value = 42')
    expect(blocks[1]).toContain('Next paragraph')
  })

  test('keeps unclosed $$ math content together until the closing block arrives', () => {
    const markdown = ['$$', 'E = mc^2', '', '$$', '', 'After block'].join('\n')

    const blocks = parseMarkdownIntoBlocks(markdown).filter((block) => block.trim().length > 0)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toContain('$$')
    expect(blocks[0]).toContain('E = mc^2')
    expect(blocks[1]).toContain('After block')
  })
})
