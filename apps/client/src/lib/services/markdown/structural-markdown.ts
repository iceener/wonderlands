import { Lexer, type Token, type Tokens } from 'marked'
import { normalizeModelVisibleImageMarkdown } from '../../../../shared/markdown-images'
import { buildCodeBlockRenderModel, type CodeBlockRenderModel } from './code-block-renderer'

const FILE_REFERENCE_PATTERN = /^#([^\s`\n][^`\n]*)$/
const AGENT_REFERENCE_PATTERN = /^@([a-z0-9][a-z0-9_-]*)$/i
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'data:'])

interface BaseNode {
  id: string
}

export interface StructuredMarkdownTextNode extends BaseNode {
  kind: 'text'
  text: string
}

export interface StructuredMarkdownGroupNode extends BaseNode {
  kind: 'group'
  children: StructuredMarkdownInlineNode[]
}

export interface StructuredMarkdownEmphasisNode extends BaseNode {
  kind: 'strong' | 'em' | 'del'
  children: StructuredMarkdownInlineNode[]
}

export interface StructuredMarkdownCodeSpanNode extends BaseNode {
  kind: 'codespan'
  text: string
}

export interface StructuredMarkdownMentionNode extends BaseNode {
  kind: 'file-mention' | 'agent-mention'
  text: string
}

export interface StructuredMarkdownLinkNode extends BaseNode {
  kind: 'link'
  href: string | null
  title: string | null
  children: StructuredMarkdownInlineNode[]
}

export interface StructuredMarkdownImageNode extends BaseNode {
  kind: 'image'
  src: string | null
  alt: string
  title: string | null
}

export interface StructuredMarkdownBreakNode extends BaseNode {
  kind: 'br'
}

export type StructuredMarkdownInlineNode =
  | StructuredMarkdownTextNode
  | StructuredMarkdownGroupNode
  | StructuredMarkdownEmphasisNode
  | StructuredMarkdownCodeSpanNode
  | StructuredMarkdownMentionNode
  | StructuredMarkdownLinkNode
  | StructuredMarkdownImageNode
  | StructuredMarkdownBreakNode

export interface StructuredMarkdownParagraphBlock extends BaseNode {
  kind: 'paragraph'
  inlines: StructuredMarkdownInlineNode[]
}

export interface StructuredMarkdownHeadingBlock extends BaseNode {
  kind: 'heading'
  depth: number
  inlines: StructuredMarkdownInlineNode[]
}

export interface StructuredMarkdownBlockquoteBlock extends BaseNode {
  kind: 'blockquote'
  children: StructuredMarkdownBlock[]
}

export interface StructuredMarkdownListItem extends BaseNode {
  task: boolean
  checked: boolean
  loose: boolean
  inlines: StructuredMarkdownInlineNode[]
  blocks: StructuredMarkdownBlock[]
}

export interface StructuredMarkdownListBlock extends BaseNode {
  kind: 'list'
  ordered: boolean
  start: number
  items: StructuredMarkdownListItem[]
}

export interface StructuredMarkdownCodeBlock extends BaseNode {
  kind: 'code'
  model: CodeBlockRenderModel
}

export interface StructuredMarkdownTableCell extends BaseNode {
  align: 'center' | 'left' | 'right' | null
  header: boolean
  inlines: StructuredMarkdownInlineNode[]
}

export interface StructuredMarkdownTableBlock extends BaseNode {
  kind: 'table'
  header: StructuredMarkdownTableCell[]
  rows: StructuredMarkdownTableCell[][]
}

export interface StructuredMarkdownHorizontalRuleBlock extends BaseNode {
  kind: 'hr'
}

export type StructuredMarkdownBlock =
  | StructuredMarkdownParagraphBlock
  | StructuredMarkdownHeadingBlock
  | StructuredMarkdownBlockquoteBlock
  | StructuredMarkdownListBlock
  | StructuredMarkdownCodeBlock
  | StructuredMarkdownTableBlock
  | StructuredMarkdownHorizontalRuleBlock

const sanitizeUrl = (raw: string | null | undefined, image: boolean): string | null => {
  const value = raw?.trim()
  if (!value) {
    return null
  }

  try {
    const resolved = new URL(value, 'https://example.invalid')
    const protocol = resolved.protocol.toLowerCase()
    const allowed = image ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS
    return allowed.has(protocol) ? value : null
  } catch {
    return null
  }
}

const textNode = (id: string, text: string): StructuredMarkdownTextNode => ({
  kind: 'text',
  id,
  text,
})

const inlineNodesFromTokens = (
  tokens: Token[] | undefined,
  path: string,
): StructuredMarkdownInlineNode[] => {
  if (!tokens || tokens.length === 0) {
    return []
  }

  return tokens.flatMap((token, index) => inlineNodesFromToken(token, `${path}:${index}`))
}

const inlineNodesFromToken = (token: Token, path: string): StructuredMarkdownInlineNode[] => {
  switch (token.type) {
    case 'text':
      if (token.tokens && token.tokens.length > 0) {
        return [
          {
            kind: 'group',
            id: path,
            children: inlineNodesFromTokens(token.tokens, `${path}.tokens`),
          },
        ]
      }
      return [textNode(path, token.text)]
    case 'escape':
      return [textNode(path, token.text)]
    case 'strong':
      return [
        {
          kind: 'strong',
          id: path,
          children: inlineNodesFromTokens(token.tokens, `${path}.tokens`),
        },
      ]
    case 'em':
      return [
        {
          kind: 'em',
          id: path,
          children: inlineNodesFromTokens(token.tokens, `${path}.tokens`),
        },
      ]
    case 'del':
      return [
        {
          kind: 'del',
          id: path,
          children: inlineNodesFromTokens(token.tokens, `${path}.tokens`),
        },
      ]
    case 'codespan': {
      const fileMatch = token.text.match(FILE_REFERENCE_PATTERN)
      if (fileMatch?.[1]) {
        return [{ kind: 'file-mention', id: path, text: fileMatch[1] }]
      }

      const agentMatch = token.text.match(AGENT_REFERENCE_PATTERN)
      if (agentMatch?.[1]) {
        return [{ kind: 'agent-mention', id: path, text: agentMatch[1] }]
      }

      return [{ kind: 'codespan', id: path, text: token.text }]
    }
    case 'link':
      return [
        {
          kind: 'link',
          id: path,
          href: sanitizeUrl(token.href, false),
          title: token.title ?? null,
          children: inlineNodesFromTokens(token.tokens, `${path}.tokens`),
        },
      ]
    case 'image':
      return [
        {
          kind: 'image',
          id: path,
          src: sanitizeUrl(token.href, true),
          alt: token.text,
          title: token.title ?? null,
        },
      ]
    case 'br':
      return [{ kind: 'br', id: path }]
    case 'html':
      return [textNode(path, token.raw)]
    default:
      return [textNode(path, token.raw)]
  }
}

const blockNodesFromTokens = (
  tokens: Token[] | undefined,
  path: string,
  highlight = false,
): StructuredMarkdownBlock[] => {
  if (!tokens || tokens.length === 0) {
    return []
  }

  return tokens.flatMap((token, index) => blockNodesFromToken(token, `${path}:${index}`, highlight))
}

const buildListItem = (
  item: Tokens.ListItem,
  path: string,
  highlight: boolean,
): StructuredMarkdownListItem => {
  const inlines: StructuredMarkdownInlineNode[] = []
  const blocks: StructuredMarkdownBlock[] = []

  for (let index = 0; index < item.tokens.length; index += 1) {
    const token = item.tokens[index]
    const tokenPath = `${path}.token:${index}`

    if (!item.loose && token.type === 'text') {
      inlines.push(...inlineNodesFromToken(token, tokenPath))
      continue
    }

    blocks.push(...blockNodesFromToken(token, tokenPath, highlight))
  }

  if (inlines.length === 0 && blocks.length === 0 && item.text) {
    inlines.push(textNode(`${path}.text`, item.text))
  }

  return {
    id: path,
    task: item.task,
    checked: Boolean(item.checked),
    loose: item.loose,
    inlines,
    blocks,
  }
}

const buildTableCell = (cell: Tokens.TableCell, path: string): StructuredMarkdownTableCell => ({
  id: path,
  align: cell.align,
  header: cell.header,
  inlines: inlineNodesFromTokens(cell.tokens, `${path}.tokens`),
})

const blockNodesFromToken = (
  token: Token,
  path: string,
  highlight = false,
): StructuredMarkdownBlock[] => {
  switch (token.type) {
    case 'space':
      return []
    case 'paragraph':
      return [
        {
          kind: 'paragraph',
          id: path,
          inlines: inlineNodesFromTokens(token.tokens, `${path}.tokens`),
        },
      ]
    case 'heading':
      return [
        {
          kind: 'heading',
          id: path,
          depth: token.depth,
          inlines: inlineNodesFromTokens(token.tokens, `${path}.tokens`),
        },
      ]
    case 'blockquote':
      return [
        {
          kind: 'blockquote',
          id: path,
          children: blockNodesFromTokens(token.tokens, `${path}.tokens`, highlight),
        },
      ]
    case 'list':
      return [
        {
          kind: 'list',
          id: path,
          ordered: token.ordered,
          start: typeof token.start === 'number' ? token.start : 1,
          items: token.items.map((item: Tokens.ListItem, index: number) =>
            buildListItem(item, `${path}.item:${index}`, highlight),
          ),
        },
      ]
    case 'code':
      return [
        {
          kind: 'code',
          id: path,
          model: buildCodeBlockRenderModel(token.text, token.lang ?? '', highlight),
        },
      ]
    case 'table':
      return [
        {
          kind: 'table',
          id: path,
          header: token.header.map((cell: Tokens.TableCell, index: number) =>
            buildTableCell(cell, `${path}.head:${index}`),
          ),
          rows: token.rows.map((row: Tokens.TableCell[], rowIndex: number) =>
            row.map((cell: Tokens.TableCell, cellIndex: number) =>
              buildTableCell(cell, `${path}.row:${rowIndex}:${cellIndex}`),
            ),
          ),
        },
      ]
    case 'hr':
      return [{ kind: 'hr', id: path }]
    case 'text':
      return [
        {
          kind: 'paragraph',
          id: path,
          inlines: inlineNodesFromToken(token, `${path}.tokens`),
        },
      ]
    case 'html':
      return [
        {
          kind: 'paragraph',
          id: path,
          inlines: [textNode(`${path}.html`, token.raw)],
        },
      ]
    default:
      return [
        {
          kind: 'paragraph',
          id: path,
          inlines: [textNode(`${path}.raw`, token.raw)],
        },
      ]
  }
}

export const buildStructuredMarkdown = (
  source: string,
  options: { highlight?: boolean } = {},
): StructuredMarkdownBlock[] => {
  const normalizedSource = normalizeModelVisibleImageMarkdown(source ?? '')
  if (!normalizedSource) {
    return []
  }

  const tokens = Lexer.lex(normalizedSource, { gfm: true, breaks: true })
  return blockNodesFromTokens(tokens, 'block', options.highlight ?? false)
}
