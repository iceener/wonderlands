import { Lexer } from 'marked'
import { track } from '../utils/perf'

const footnoteReferencePattern = /\[\^[\w-]{1,200}\](?!:)/
const footnoteDefinitionPattern = /\[\^[\w-]{1,200}\]:/
const openingTagPattern = /<(\w+)[\s>]/

const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const TAG_PATTERN_CACHE_LIMIT = 200
const openTagPatternCache = new Map<string, RegExp>()
const closeTagPatternCache = new Map<string, RegExp>()

const getOpenTagPattern = (tagName: string): RegExp => {
  const normalized = tagName.toLowerCase()
  const cached = openTagPatternCache.get(normalized)
  if (cached) {
    return cached
  }

  if (openTagPatternCache.size >= TAG_PATTERN_CACHE_LIMIT) {
    openTagPatternCache.clear()
  }

  const pattern = new RegExp(`<${normalized}(?=[\\s>/])[^>]*>`, 'gi')
  openTagPatternCache.set(normalized, pattern)
  return pattern
}

const getCloseTagPattern = (tagName: string): RegExp => {
  const normalized = tagName.toLowerCase()
  const cached = closeTagPatternCache.get(normalized)
  if (cached) {
    return cached
  }

  if (closeTagPatternCache.size >= TAG_PATTERN_CACHE_LIMIT) {
    closeTagPatternCache.clear()
  }

  const pattern = new RegExp(`</${normalized}(?=[\\s>])[^>]*>`, 'gi')
  closeTagPatternCache.set(normalized, pattern)
  return pattern
}

const countNonSelfClosingOpenTags = (block: string, tagName: string): number => {
  if (voidElements.has(tagName.toLowerCase())) {
    return 0
  }

  const matches = block.match(getOpenTagPattern(tagName))
  if (!matches) {
    return 0
  }

  let count = 0
  for (const match of matches) {
    if (!match.trimEnd().endsWith('/>')) {
      count += 1
    }
  }

  return count
}

const countClosingTags = (block: string, tagName: string): number => {
  const matches = block.match(getCloseTagPattern(tagName))
  return matches ? matches.length : 0
}

const countDoubleDollars = (str: string): number => {
  let count = 0
  for (let i = 0; i < str.length - 1; i += 1) {
    if (str[i] === '$' && str[i + 1] === '$') {
      count += 1
      i += 1
    }
  }
  return count
}

/**
 * Splits a markdown string into independent blocks using the marked Lexer.
 * Each block is a self-contained unit (paragraph, heading, code fence, list, etc.)
 * that can be rendered and cached independently.
 *
 * Adjacent blocks are merged when they belong together:
 *  - HTML blocks with nested tags
 *  - Math blocks with unclosed $$ delimiters
 *  - Footnotes, which must stay in a single parse tree
 */
export const parseMarkdownIntoBlocks = (markdown: string): string[] =>
  track('parseBlocks', () => _parseMarkdownIntoBlocks(markdown))

const _parseMarkdownIntoBlocks = (markdown: string): string[] => {
  if (!markdown) return []

  if (footnoteReferencePattern.test(markdown) || footnoteDefinitionPattern.test(markdown)) {
    return [markdown]
  }

  const tokens = Lexer.lex(markdown, { gfm: true })
  const blocks: string[] = []
  const htmlStack: string[] = []
  let previousTokenWasCode = false

  for (const token of tokens) {
    const raw = token.raw
    const blockCount = blocks.length

    if (htmlStack.length > 0 && blockCount > 0) {
      blocks[blockCount - 1] += raw

      const trackedTag = htmlStack[htmlStack.length - 1]
      const newOpenTags = countNonSelfClosingOpenTags(raw, trackedTag)
      const newCloseTags = countClosingTags(raw, trackedTag)

      for (let i = 0; i < newOpenTags; i += 1) {
        htmlStack.push(trackedTag)
      }

      for (let i = 0; i < newCloseTags; i += 1) {
        if (htmlStack[htmlStack.length - 1] === trackedTag) {
          htmlStack.pop()
        }
      }

      continue
    }

    if (token.type === 'html' && token.block) {
      const openingTagMatch = raw.match(openingTagPattern)
      if (openingTagMatch) {
        const tagName = openingTagMatch[1]
        const openTags = countNonSelfClosingOpenTags(raw, tagName)
        const closeTags = countClosingTags(raw, tagName)

        if (openTags > closeTags) {
          htmlStack.push(tagName)
        }
      }
    }

    if (blockCount > 0 && !previousTokenWasCode) {
      const previousBlock = blocks[blockCount - 1]
      if (countDoubleDollars(previousBlock) % 2 === 1) {
        blocks[blockCount - 1] = previousBlock + raw
        continue
      }
    }

    blocks.push(raw)

    if (token.type !== 'space') {
      previousTokenWasCode = token.type === 'code'
    }
  }

  return blocks
}
