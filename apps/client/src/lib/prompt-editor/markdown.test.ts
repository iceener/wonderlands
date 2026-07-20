// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { Link } from '@tiptap/extension-link'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'vitest'
import { getReferencedFileIdsFromEditor, PromptFileMention } from './file-mention-extension'
import { PromptImage } from './image-extension'
import {
  createDocFromMessage,
  getMarkdownFromEditor,
  getMarkdownPasteContent,
  sanitizeMarkdownPaste,
  validateModelVisibleImageMarkdown,
} from './markdown'

const createEditor = (
  content: ConstructorParameters<typeof Editor>[0]['content'],
  extensions: ConstructorParameters<typeof Editor>[0]['extensions'] = [
    StarterKit,
    PromptImage,
    Markdown,
  ],
) =>
  new Editor({
    element: null,
    extensions,
    content,
    ...(typeof content === 'string' ? { contentType: 'markdown' as const } : {}),
  })

describe('prompt editor markdown transformations', () => {
  test('normalizes message input and keeps empty submissions empty', () => {
    expect(createDocFromMessage('Line one\r\nLine two\rLine three')).toBe(
      'Line one\nLine two\nLine three',
    )
    expect(sanitizeMarkdownPaste('One\u001B[200~ two\u001B[201~\u001B[O')).toBe('One two')
    expect(getMarkdownFromEditor(createEditor(createDocFromMessage('')))).toBe('')
  })

  test('round-trips rich markdown and image syntax through the editor boundary', () => {
    const source =
      '# Heading\r\n\r\n- one\r\n- two\r\n\r\n![Chart](https://example.com/chart.png "Quarterly")'

    expect(getMarkdownFromEditor(createEditor(createDocFromMessage(source)))).toBe(
      '# Heading\n\n- one\n- two\n\n![Chart](https://example.com/chart.png "Quarterly")',
    )
  })

  test('maps inline image and multi-block paste payloads to the right document shape', () => {
    const editor = createEditor('Before ')
    editor.commands.insertContentAt(
      editor.state.doc.content.size - 1,
      getMarkdownPasteContent(editor, '![Chart](https://example.com/chart.png)'),
    )
    expect(getMarkdownFromEditor(editor)).toBe('Before ![Chart](https://example.com/chart.png)')

    expect(getMarkdownPasteContent(editor, '# Heading\n\nParagraph')).toEqual([
      {
        attrs: { level: 1 },
        content: [{ text: 'Heading', type: 'text' }],
        type: 'heading',
      },
      {
        content: [{ text: 'Paragraph', type: 'text' }],
        type: 'paragraph',
      },
    ])
  })

  test('preserves autolinked image URLs and rejects transient image schemes', () => {
    const href = 'https://cloud.overment.com/assets/moderation.png'
    const editor = createEditor(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '![Moderation](' },
              { type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] },
              { type: 'text', text: ')' },
            ],
          },
        ],
      },
      [
        StarterKit.configure({ link: false }),
        PromptImage,
        Link.configure({ autolink: true, linkOnPaste: true, openOnClick: false }),
        Markdown,
      ],
    )

    const markdown = getMarkdownFromEditor(editor)
    expect(markdown).toBe(`![Moderation](${href})`)
    expect(validateModelVisibleImageMarkdown(markdown)).toEqual({ ok: true })
    expect(
      validateModelVisibleImageMarkdown('![Chart](blob:http://localhost/chart)'),
    ).toMatchObject({ ok: false })
  })

  test('serializes and parses file mentions while exposing uploaded file ids', () => {
    const extensions = [StarterKit, PromptFileMention, PromptImage, Markdown]
    const editor = createEditor(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'fileMention',
                attrs: {
                  fileId: null,
                  label: 'index.ts',
                  relativePath: 'src/index.ts',
                  source: 'workspace',
                },
              },
              { type: 'text', text: ' ' },
              {
                type: 'fileMention',
                attrs: {
                  fileId: 'fil_existing',
                  label: 'notes.md',
                  relativePath: null,
                  source: 'attachment',
                },
              },
            ],
          },
        ],
      },
      extensions,
    )

    expect(getMarkdownFromEditor(editor)).toBe('`#src/index.ts` `#notes.md`')
    expect(getReferencedFileIdsFromEditor(editor)).toEqual(['fil_existing'])

    const parsed = createEditor('Review `#src/index.ts` and `#Project Plan.pdf`', extensions)
    const mentions: Array<Record<string, unknown>> = []
    parsed.state.doc.descendants((node) => {
      if (node.type.name === 'fileMention') mentions.push(node.attrs)
    })
    expect(mentions).toMatchObject([
      { label: 'src/index.ts', relativePath: 'src/index.ts', source: 'workspace' },
      { label: 'Project Plan.pdf', relativePath: 'Project Plan.pdf', source: 'workspace' },
    ])
  })
})
