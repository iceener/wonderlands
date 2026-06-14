import type { Editor, JSONContent } from '@tiptap/core'
import {
  listMarkdownImageReferences,
  normalizeModelVisibleImageMarkdown,
  parseModelVisibleImageSource,
} from '../../../shared/markdown-images'

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n')

const TERMINAL_ESCAPE_CHARACTER = String.fromCharCode(0x1b)
const TERMINAL_ESCAPE_SEQUENCE = new RegExp(
  `${TERMINAL_ESCAPE_CHARACTER}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`,
  'g',
)

export const createDocFromMessage = (markdown: string): string =>
  normalizeLineEndings(markdown ?? '')

export const sanitizeMarkdownPaste = (value: string): string =>
  normalizeLineEndings(value ?? '').replace(TERMINAL_ESCAPE_SEQUENCE, '')

export const getMarkdownPasteContent = (
  editor: Pick<Editor, 'markdown' | 'state'>,
  markdown: string,
): JSONContent[] => {
  const parsed = editor.markdown?.parse(createDocFromMessage(markdown))
  const content = Array.isArray(parsed?.content) ? parsed.content : []

  if (
    content.length === 1 &&
    content[0]?.type === 'paragraph' &&
    editor.state.selection.$from.parent.isTextblock
  ) {
    return content[0].content ?? []
  }

  return content
}

export const getMarkdownFromEditor = (editor: Pick<Editor, 'getMarkdown'>): string =>
  normalizeModelVisibleImageMarkdown(normalizeLineEndings(editor.getMarkdown()))

const stripAgentMentionNodes = (content: JSONContent | null | undefined): JSONContent | null => {
  if (!content) {
    return null
  }

  if (content.type === 'agentMention') {
    return null
  }

  const nextContent = Array.isArray(content.content)
    ? content.content
        .map((child) => stripAgentMentionNodes(child))
        .filter((child): child is JSONContent => child !== null)
    : undefined

  return {
    ...content,
    ...(nextContent ? { content: nextContent } : {}),
  }
}

export const getMarkdownWithoutAgentMentionsFromEditor = (
  editor: Pick<Editor, 'getJSON' | 'markdown'>,
): string => {
  const stripped = stripAgentMentionNodes(editor.getJSON()) ?? {
    content: [],
    type: 'doc',
  }
  const serialized = editor.markdown?.serialize(stripped) ?? ''

  return normalizeModelVisibleImageMarkdown(normalizeLineEndings(serialized))
}

export const validateModelVisibleImageMarkdown = (
  markdown: string,
):
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    } => {
  for (const reference of listMarkdownImageReferences(markdown)) {
    const sourceResult = parseModelVisibleImageSource(reference.url)
    if (sourceResult.ok) {
      continue
    }

    return {
      ok: false,
      error: `Inline image "${reference.alt || reference.url}" is not sendable. ${sourceResult.error.message}`,
    }
  }

  return {
    ok: true,
  }
}
