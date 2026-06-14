import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test, vi } from 'vitest'
import {
  getReferencedAgentFromEditor,
  getReferencedAgentIdFromEditor,
  PromptAgentMention,
} from './agent-mention-extension'
import { getMarkdownFromEditor, getMarkdownWithoutAgentMentionsFromEditor } from './markdown'

describe('PromptAgentMention', () => {
  test('renders as inline markdown token and exposes the referenced agent id', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptAgentMention, Markdown],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'agentMention',
                attrs: {
                  agentId: 'agt_researcher',
                  label: 'Researcher',
                  slug: 'researcher',
                },
              },
              {
                type: 'text',
                text: ' Review the architecture.',
              },
            ],
          },
        ],
      },
    })

    expect(getMarkdownFromEditor(editor)).toBe('`@researcher` Review the architecture.')
    expect(getMarkdownWithoutAgentMentionsFromEditor(editor)).toBe(' Review the architecture.')
    expect(getReferencedAgentIdFromEditor(editor)).toBe('agt_researcher')
    expect(getReferencedAgentFromEditor(editor)).toEqual({
      agentId: 'agt_researcher',
      label: 'Researcher',
      slug: 'researcher',
    })
  })

  test('parses serialized markdown references back into agent mention nodes', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptAgentMention, Markdown],
      content: 'Ask `@researcher` to review this.',
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
              text: 'Ask ',
            },
            {
              type: 'agentMention',
              attrs: {
                agentId: null,
                label: 'researcher',
                slug: 'researcher',
              },
            },
            {
              type: 'text',
              text: ' to review this.',
            },
          ],
        },
      ],
    })
  })

  test('returns null when no agent mention exists', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, PromptAgentMention, Markdown],
      content: 'No mention here.',
      contentType: 'markdown',
    })

    expect(getReferencedAgentFromEditor(editor)).toBeNull()
    expect(getReferencedAgentIdFromEditor(editor)).toBeNull()
  })

  test('warns and returns the first mention when multiple mentions exist', () => {
    const warn = vi.fn(() => undefined)
    const originalWarn = console.warn
    console.warn = warn

    try {
      const editor = new Editor({
        element: null,
        extensions: [StarterKit, PromptAgentMention, Markdown],
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'agentMention',
                  attrs: {
                    agentId: 'agt_primary',
                    label: 'Primary',
                    slug: 'primary',
                  },
                },
                {
                  type: 'text',
                  text: ' ',
                },
                {
                  type: 'agentMention',
                  attrs: {
                    agentId: 'agt_secondary',
                    label: 'Secondary',
                    slug: 'secondary',
                  },
                },
              ],
            },
          ],
        },
      })

      expect(getReferencedAgentIdFromEditor(editor)).toBe('agt_primary')
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      console.warn = originalWarn
    }
  })
})
