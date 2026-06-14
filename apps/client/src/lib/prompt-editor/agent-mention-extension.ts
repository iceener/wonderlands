import type { Editor } from '@tiptap/core'
import { mergeAttributes, Node } from '@tiptap/core'

const SERIALIZED_AGENT_MENTION_PATTERN = /^`@([a-z0-9][a-z0-9_-]*)`/

const escapeInlineCode = (value: string): string => value.replace(/`/g, '\\`')

const toAgentLabel = (attrs: Record<string, unknown> | null | undefined): string => {
  const label = typeof attrs?.label === 'string' ? attrs.label.trim() : ''
  const slug = typeof attrs?.slug === 'string' ? attrs.slug.trim() : ''

  return label || slug || 'agent'
}

const toAgentSlug = (attrs: Record<string, unknown> | null | undefined): string => {
  const slug = typeof attrs?.slug === 'string' ? attrs.slug.trim() : ''
  const label = typeof attrs?.label === 'string' ? attrs.label.trim() : ''

  return slug || label
}

export interface ReferencedAgentMention {
  agentId: string | null
  label: string
  slug: string
}

export const PromptAgentMention = Node.create({
  name: 'agentMention',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,
  markdownTokenName: 'agentMention',

  addAttributes() {
    return {
      agentId: {
        default: null,
      },
      label: {
        default: '',
      },
      slug: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-agent-mention]',
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const label = toAgentLabel(node.attrs)

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-agent-id': node.attrs.agentId ?? undefined,
        'data-agent-mention': '',
        class: 'sd-agent-mention',
        contenteditable: 'false',
        title: `@${label}`,
      }),
      [
        'span',
        {
          'aria-hidden': 'true',
          class: 'sd-agent-mention-prefix',
        },
        '@',
      ],
      [
        'span',
        {
          class: 'sd-agent-mention-label',
        },
        label,
      ],
    ]
  },

  parseMarkdown(token, helpers) {
    const slug = typeof token.attributes?.slug === 'string' ? token.attributes.slug.trim() : ''

    return helpers.createNode('agentMention', {
      agentId: null,
      label: slug,
      slug,
    })
  },

  markdownTokenizer: {
    name: 'agentMention',
    level: 'inline',
    start: '`@',
    tokenize(src) {
      const match = src.match(SERIALIZED_AGENT_MENTION_PATTERN)

      if (!match?.[1]) {
        return undefined
      }

      return {
        attributes: {
          label: match[1],
          slug: match[1],
        },
        raw: match[0],
        type: 'agentMention',
      }
    },
  },

  renderMarkdown(node) {
    const slug = escapeInlineCode(toAgentSlug(node.attrs))
    return slug ? `\`@${slug}\`` : ''
  },
})

export const getReferencedAgentFromEditor = (
  editor: Pick<Editor, 'state'>,
): ReferencedAgentMention | null => {
  const mentions: ReferencedAgentMention[] = []

  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'agentMention') {
      return
    }

    mentions.push({
      agentId:
        typeof node.attrs?.agentId === 'string' && node.attrs.agentId.trim().length > 0
          ? node.attrs.agentId.trim()
          : null,
      label: toAgentLabel(node.attrs),
      slug: toAgentSlug(node.attrs),
    })
  })

  if (mentions.length > 1) {
    console.warn(
      `[agent-mention] Expected at most one agent mention per message, found ${mentions.length}. Using the first mention.`,
    )
  }

  return mentions[0] ?? null
}

export const getReferencedAgentIdFromEditor = (editor: Pick<Editor, 'state'>): string | null =>
  getReferencedAgentFromEditor(editor)?.agentId ?? null
