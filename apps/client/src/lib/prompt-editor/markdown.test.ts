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

describe('prompt editor markdown helpers', () => {
  test('normalizes incoming message markdown to LF line endings', () => {
    expect(createDocFromMessage('Line one\r\nLine two\rLine three')).toBe(
      'Line one\nLine two\nLine three',
    )
  })

  test('removes terminal control sequences from pasted markdown text', () => {
    expect(sanitizeMarkdownPaste('One\u001B[200~ two\u001B[201~\u001B[O')).toBe('One two')
  })

  test('serializes markdown from a headless editor without changing the message contract', () => {
    const source = createDocFromMessage('# Heading\r\n\r\n- one\r\n- two\r\n\r\n`inline`')
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptImage, Markdown],
      content: source,
      contentType: 'markdown',
    })

    expect(getMarkdownFromEditor(editor)).toBe('# Heading\n\n- one\n- two\n\n`inline`')
  })

  test('keeps empty content empty at the submit boundary', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptImage, Markdown],
      content: createDocFromMessage(''),
      contentType: 'markdown',
    })

    expect(getMarkdownFromEditor(editor)).toBe('')
  })

  test('round-trips markdown image syntax through the editor boundary', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptImage, Markdown],
      content: createDocFromMessage('![Chart](https://example.com/chart.png "Quarterly")'),
      contentType: 'markdown',
    })

    expect(getMarkdownFromEditor(editor)).toBe(
      '![Chart](https://example.com/chart.png "Quarterly")',
    )
  })

  test('prepares pasted markdown images as inline content inside text blocks', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptImage, Markdown],
      content: createDocFromMessage('Before '),
      contentType: 'markdown',
    })

    editor.commands.insertContentAt(
      editor.state.doc.content.size - 1,
      getMarkdownPasteContent(editor, '![Chart](https://example.com/chart.png)'),
    )

    expect(getMarkdownFromEditor(editor)).toBe('Before ![Chart](https://example.com/chart.png)')
  })

  test('keeps multi-block markdown paste content as top-level blocks', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptImage, Markdown],
      content: createDocFromMessage('Start'),
      contentType: 'markdown',
    })

    const content = getMarkdownPasteContent(editor, '# Heading\n\nParagraph')

    expect(content).toEqual([
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

  test('keeps autolinked bare urls valid inside markdown image syntax', () => {
    const href = 'https://cloud.overment.com/2026-02-04/ai_devs_4_moderation-6969de9a-e.png'
    const editor = new Editor({
      element: null,
      extensions: [
        StarterKit.configure({ link: false }),
        PromptImage,
        Link.configure({
          autolink: true,
          defaultProtocol: 'https',
          linkOnPaste: true,
          openOnClick: false,
        }),
        Markdown,
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '![Blokowanie zapytań naruszających zasady dostawców modeli bądź nasze wewnętrzne](',
              },
              {
                type: 'text',
                text: href,
                marks: [{ type: 'link', attrs: { href } }],
              },
              {
                type: 'text',
                text: ')',
              },
            ],
          },
        ],
      },
    })

    const markdown = getMarkdownFromEditor(editor)

    expect(markdown).toBe(
      '![Blokowanie zapytań naruszających zasady dostawców modeli bądź nasze wewnętrzne](https://cloud.overment.com/2026-02-04/ai_devs_4_moderation-6969de9a-e.png)',
    )
    expect(validateModelVisibleImageMarkdown(markdown)).toEqual({ ok: true })
  })

  test('rejects non-sendable inline image urls at submit time', () => {
    expect(validateModelVisibleImageMarkdown('![Chart](blob:http://localhost/chart)')).toEqual({
      ok: false,
      error:
        'Inline image "Chart" is not sendable. Unsupported image URL scheme "blob:". Only http(s) URLs and uploaded image URLs are supported.',
    })

    expect(validateModelVisibleImageMarkdown('![Chart](https://example.com/chart.png)')).toEqual({
      ok: true,
    })
  })

  test('serializes file mentions as inline code references and exposes referenced attachment ids', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptFileMention, PromptImage, Markdown],
      content: {
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
              {
                type: 'text',
                text: ' ',
              },
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
    })

    expect(getMarkdownFromEditor(editor)).toBe('`#src/index.ts` `#notes.md`')
    expect(getReferencedFileIdsFromEditor(editor)).toEqual(['fil_existing'])
  })

  test('parses serialized file mention references back into file mention nodes', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptFileMention, PromptImage, Markdown],
      content: createDocFromMessage('Review `#src/index.ts` and `#Project Plan.pdf`'),
      contentType: 'markdown',
    })

    expect(editor.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Review ',
            },
            {
              type: 'fileMention',
              attrs: {
                fileId: null,
                label: 'src/index.ts',
                relativePath: 'src/index.ts',
                source: 'workspace',
              },
            },
            {
              type: 'text',
              text: ' and ',
            },
            {
              type: 'fileMention',
              attrs: {
                fileId: null,
                label: 'Project Plan.pdf',
                relativePath: 'Project Plan.pdf',
                source: 'workspace',
              },
            },
          ],
        },
      ],
    })
  })
})
