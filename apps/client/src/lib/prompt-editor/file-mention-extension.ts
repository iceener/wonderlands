import type { Editor } from '@tiptap/core'
import { mergeAttributes, Node } from '@tiptap/core'

const SERIALIZED_FILE_MENTION_PATTERN = /^`#([^\s`\n][^`\n]*)`/

const toMentionText = (attrs: Record<string, unknown> | null | undefined): string => {
  const source = attrs?.source === 'attachment' ? 'attachment' : 'workspace'
  const label = typeof attrs?.label === 'string' ? attrs.label.trim() : ''
  const relativePath = typeof attrs?.relativePath === 'string' ? attrs.relativePath.trim() : ''

  if (source === 'attachment') {
    return label || relativePath || 'file'
  }

  return relativePath || label || 'file'
}

const toRenderedMention = (attrs: Record<string, unknown> | null | undefined): string =>
  `#${toMentionText(attrs)}`

const escapeInlineCode = (value: string): string => value.replace(/`/g, '\\`')

export const PromptFileMention = Node.create({
  name: 'fileMention',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,
  markdownTokenName: 'fileMention',

  addAttributes() {
    return {
      fileId: {
        default: null,
      },
      label: {
        default: '',
      },
      relativePath: {
        default: null,
      },
      source: {
        default: 'workspace',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-file-mention]',
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const mentionText = toMentionText(node.attrs)

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-file-id': node.attrs.fileId ?? undefined,
        'data-file-mention': '',
        'data-source': node.attrs.source ?? 'workspace',
        class: 'sd-file-mention',
        contenteditable: 'false',
        title: toRenderedMention(node.attrs),
      }),
      [
        'span',
        {
          'aria-hidden': 'true',
          class: 'sd-file-mention-prefix',
        },
        '#',
      ],
      [
        'span',
        {
          class: 'sd-file-mention-label',
        },
        mentionText,
      ],
    ]
  },

  parseMarkdown(token, helpers) {
    const label = typeof token.attributes?.label === 'string' ? token.attributes.label.trim() : ''
    const relativePath =
      typeof token.attributes?.relativePath === 'string'
        ? token.attributes.relativePath.trim()
        : label

    return helpers.createNode('fileMention', {
      fileId: null,
      label: label || relativePath,
      relativePath: relativePath || null,
      source: 'workspace',
    })
  },

  markdownTokenizer: {
    name: 'fileMention',
    level: 'inline',
    start: '`#',
    tokenize(src) {
      const match = src.match(SERIALIZED_FILE_MENTION_PATTERN)

      if (!match) {
        return undefined
      }

      const mentionText = match[1]?.trim()
      if (!mentionText) {
        return undefined
      }

      return {
        attributes: {
          label: mentionText,
          relativePath: mentionText,
        },
        raw: match[0],
        type: 'fileMention',
      }
    },
  },

  renderMarkdown(node) {
    const mention = escapeInlineCode(toRenderedMention(node.attrs))
    return mention ? `\`${mention}\`` : ''
  },
})

export const getReferencedFileIdsFromEditor = (editor: Pick<Editor, 'state'>): string[] => {
  const fileIds = new Set<string>()

  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'fileMention') {
      return
    }

    const fileId = typeof node.attrs?.fileId === 'string' ? node.attrs.fileId.trim() : ''
    if (fileId) {
      fileIds.add(fileId)
    }
  })

  return [...fileIds]
}
