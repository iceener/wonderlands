import remend from 'remend'

const CODE_FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/

/**
 * Walks a markdown string line-by-line per the CommonMark spec to determine
 * whether an opening code fence has no matching closing fence.
 *
 * A closing fence must use the same character and be at least as long.
 */
export const hasIncompleteCodeFence = (markdown: string): boolean => {
  const lines = markdown.split('\n')
  let openChar: string | null = null
  let openLen = 0

  for (const line of lines) {
    const match = CODE_FENCE_PATTERN.exec(line)

    if (openChar === null) {
      if (match) {
        openChar = match[1][0]
        openLen = match[1].length
      }
    } else if (match && match[1][0] === openChar && match[1].length >= openLen) {
      openChar = null
      openLen = 0
    }
  }

  return openChar !== null
}

const TABLE_DELIMITER_PATTERN = /^\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?$/

export const hasTable = (markdown: string): boolean => {
  const lines = markdown.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length > 0 && trimmed.includes('|') && TABLE_DELIMITER_PATTERN.test(trimmed)) {
      return true
    }
  }
  return false
}

/**
 * Applies lightweight repair before parsing streamed markdown. This smooths over
 * common incomplete-token states without mutating complete content.
 */
export const prepareMarkdownForRender = (markdown: string, streaming = false): string => {
  if (!markdown || !streaming) {
    return markdown
  }

  return remend(markdown)
}

// A trailing incomplete emphasis marker (*, **, ***) at the end of an ordered
// list item line gets misinterpreted as a nested unordered-list marker by the
// markdown renderer. For example, "1. *" from the start of "1. **bold**" renders
// as <ol><li><ul><li></li></ul></li></ol> instead of plain text.
//
// Appending a zero-width space (U+200B) after the asterisk(s) breaks the list
// marker interpretation — CommonMark requires a regular ASCII space after * —
// while being completely invisible in the rendered output.
const TRAILING_EMPHASIS_IN_ORDERED_LIST = /((?:^|\n)[ \t]*\d+[.)]\s+)(\*{1,3})[ \t]*$/

/**
 * Repairs incomplete markdown so partial content during streaming renders
 * correctly instead of producing garbled output.
 *
 * Only fixes the highest-impact cases (unclosed code fences, partial bold/italic
 * in list items) to avoid false-positive repairs on intentional syntax.
 */
export const repairIncompleteMarkdown = (markdown: string): string => {
  if (!markdown) return markdown

  let result = prepareMarkdownForRender(markdown, true)

  if (hasIncompleteCodeFence(result)) {
    result += '\n```'
  }

  result = result.replace(
    TRAILING_EMPHASIS_IN_ORDERED_LIST,
    (_, prefix, stars) => `${prefix}${stars}\u200B`,
  )

  return result
}
