// Garden markdown rendering: inline markdown, shortcodes, lists, tables,
// headings, and typographic post-processing (smartypants).

import { escapeHtml, renderHrefAttributes, renderSrcAttributes } from './html-utils'

export interface HeadingInfo {
  id: string
  level: number
  text: string
}

export interface MarkdownResult {
  headings: HeadingInfo[]
  html: string
}

const slugify = (text: string): string => {
  const slug = text
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

const stripInlineMarkdown = (text: string): string =>
  text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')

export const smartypants = (html: string): string => {
  const parts = html.split(
    /(<pre[\s>][\s\S]*?<\/pre>|<code[\s>][\s\S]*?<\/code>|<script[\s>][\s\S]*?<\/script>|<style[\s>][\s\S]*?<\/style>)/gi,
  )
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part.replace(/>([^<]+)</g, (_, text: string) => {
        let t = text
        t = t.replace(/---/g, '\u2014')
        t = t.replace(/--/g, '\u2013')
        t = t.replace(/\.\.\./g, '\u2026')
        t = t.replace(/(^|[\s(])&quot;/g, '$1\u201c')
        t = t.replace(/&quot;/g, '\u201d')
        t = t.replace(/(^|[\s(])&#39;/g, '$1\u2018')
        t = t.replace(/&#39;/g, '\u2019')
        return `>${t}<`
      })
    })
    .join('')
}

// --- Inline Markdown ---

const normalizeMarkdownUrl = (value: string): string => {
  const trimmed = value.trim()
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed
}

const renderInlineMarkdown = (value: string): string => {
  let output = escapeHtml(value)

  output = output.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt: string, src: string) =>
      `<img alt="${escapeHtml(alt)}"${renderSrcAttributes(normalizeMarkdownUrl(src))} loading="lazy" decoding="async">`,
  )
  output = output.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) =>
      `<a${renderHrefAttributes(normalizeMarkdownUrl(href))}>${label}</a>`,
  )
  output = output.replace(
    /&lt;(https?:\/\/[^&]+)&gt;/g,
    (_match, href: string) => `<a${renderHrefAttributes(href)}>${escapeHtml(href)}</a>`,
  )
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>')
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  return output
}

// --- Shortcodes / raw HTML compatibility ---

const NEWSLETTER_FORM_SHORTCODE_RE = /^\s*<NewsletterForm\s*\/?>\s*$/
const FENCE_RE = /^\s*(```|~~~)/

const renderNewsletterForm = (): string =>
  '<div class="newsletter-form" data-newsletter-form data-status="idle" data-pagefind-ignore="all"><form class="newsletter-form__form" novalidate><div class="newsletter-form__row"><input class="newsletter-form__input" data-newsletter-email type="email" inputmode="email" autocomplete="email" placeholder="your@email.com" aria-label="Email address" aria-invalid="false" required><button class="newsletter-form__button" data-newsletter-submit type="submit" disabled>I\'m in</button></div><p class="newsletter-form__hint newsletter-form__hint--error" data-newsletter-validation hidden>That email doesn\u2019t look right.</p><div class="newsletter-form__notice" data-newsletter-notice role="status" aria-live="polite" hidden></div></form></div>'

export const renderShortcodes = (markdown: string): string => {
  let inFence = false

  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        inFence = !inFence
        return line
      }

      return !inFence && NEWSLETTER_FORM_SHORTCODE_RE.test(line) ? renderNewsletterForm() : line
    })
    .join('\n')
}

const isAllowedRawHtmlBlock = (line: string): boolean => {
  const trimmed = line.trim()
  return /^<img\s[^>]*>$/.test(trimmed) || /^<div class="newsletter-form"\s/.test(trimmed)
}

interface ListMarker {
  content: string
  indent: number
  ordered: boolean
}

const parseListMarker = (line: string): ListMarker | null => {
  const match = line.match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(.+)$/)

  if (!match) {
    return null
  }

  return {
    content: match[4],
    indent: match[1].length,
    ordered: match[3] !== undefined,
  }
}

const leadingSpaces = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0

const renderListBlock = (
  lines: readonly string[],
  startIndex: number,
  baseIndent = parseListMarker(lines[startIndex] ?? '')?.indent ?? 0,
): { html: string; index: number } => {
  const firstMarker = parseListMarker(lines[startIndex] ?? '')

  if (!firstMarker) {
    return {
      html: '',
      index: startIndex,
    }
  }

  const ordered = firstMarker.ordered
  const tag = ordered ? 'ol' : 'ul'
  const items: string[] = []
  let index = startIndex

  while (index < lines.length) {
    const marker = parseListMarker(lines[index] ?? '')

    if (!marker || marker.indent !== baseIndent || marker.ordered !== ordered) {
      break
    }

    let itemHtml = renderInlineMarkdown(marker.content.trim())
    index += 1

    while (index < lines.length) {
      const line = lines[index] ?? ''

      if (line.trim().length === 0) {
        index += 1
        break
      }

      const nestedMarker = parseListMarker(line)

      if (nestedMarker) {
        if (nestedMarker.indent > baseIndent) {
          const nested = renderListBlock(lines, index, nestedMarker.indent)
          itemHtml += nested.html
          index = nested.index
          continue
        }

        break
      }

      if (leadingSpaces(line) > baseIndent) {
        itemHtml += `<br>${renderInlineMarkdown(line.trim())}`
        index += 1
        continue
      }

      break
    }

    items.push(`<li>${itemHtml}</li>`)
  }

  return {
    html: `<${tag}>${items.join('')}</${tag}>`,
    index,
  }
}

// --- Markdown to HTML ---

export const renderMarkdownToHtml = (markdown: string): MarkdownResult => {
  const normalized = markdown.replace(/\r/g, '')
  const lines = normalized.split('\n')
  const html: string[] = []
  const headings: HeadingInfo[] = []
  const usedIds = new Map<string, number>()
  let index = 0

  const uniqueId = (base: string): string => {
    const count = usedIds.get(base) ?? 0
    usedIds.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.trim().length === 0) {
      index += 1
      continue
    }

    if (isAllowedRawHtmlBlock(line)) {
      html.push(line.trim())
      index += 1
      continue
    }

    // Fenced code blocks with optional language and filename
    if (line.startsWith('```')) {
      const fenceMatch = line.match(/^```(\w+)?(?::(.+))?/)
      const lang = fenceMatch?.[1] ?? ''
      const filename = fenceMatch?.[2]?.trim() ?? ''
      const codeLines: string[] = []
      index += 1

      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }

      if (index < lines.length) {
        index += 1
      }

      const headerParts: string[] = []
      if (lang) headerParts.push(`<span class="code-lang">${escapeHtml(lang)}</span>`)
      if (filename) headerParts.push(`<span class="code-file">${escapeHtml(filename)}</span>`)
      const headerHtml =
        headerParts.length > 0 ? `<div class="code-header">${headerParts.join('')}</div>` : ''
      const ariaLabel = lang ? ` role="region" aria-label="${escapeHtml(lang)} code"` : ''
      html.push(
        `<div class="code-block"${ariaLabel}>${headerHtml}<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></div>`,
      )
      continue
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('> ')) {
        quoteLines.push((lines[index] ?? '').slice(2).trim())
        index += 1
      }
      html.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join(' '))}</p></blockquote>`)
      continue
    }

    // Horizontal rules
    if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
      html.push('<hr>')
      index += 1
      continue
    }

    // Headings with auto-generated IDs
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const rawText = headingMatch[2]
      const plainText = stripInlineMarkdown(rawText)
      const id = uniqueId(slugify(plainText))

      if (level >= 2 && level <= 4) {
        headings.push({ id, level, text: plainText })
      }

      html.push(`<h${level} id="${escapeHtml(id)}">${renderInlineMarkdown(rawText)}</h${level}>`)
      index += 1
      continue
    }

    // Lists, including simple nested Obsidian/Markdown lists
    if (parseListMarker(line)) {
      const list = renderListBlock(lines, index)
      html.push(list.html)
      index = list.index
      continue
    }

    // Tables
    if (line.trimStart().startsWith('|') && index + 1 < lines.length) {
      const nextLine = (lines[index + 1] ?? '').trim()
      if (nextLine.startsWith('|') && /^[\s|:-]+$/.test(nextLine)) {
        const parseRow = (row: string): string[] =>
          row
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim())

        const headerCells = parseRow(line)
        index += 2 // skip header + separator

        const headerHtml = headerCells
          .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
          .join('')

        const bodyRows: string[] = []
        while (index < lines.length && (lines[index] ?? '').trimStart().startsWith('|')) {
          const cells = parseRow(lines[index] ?? '')
          const rowHtml = cells.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')
          bodyRows.push(`<tr>${rowHtml}</tr>`)
          index += 1
        }

        html.push(
          `<div class="table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyRows.join('')}</tbody></table></div>`,
        )
        continue
      }
    }

    // Paragraphs
    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? '').trim().length > 0 &&
      !(lines[index] ?? '').startsWith('```') &&
      !parseListMarker(lines[index] ?? '') &&
      !(lines[index] ?? '').startsWith('> ') &&
      !(lines[index] ?? '').trimStart().startsWith('|') &&
      !/^(#{1,6})\s+/.test(lines[index] ?? '') &&
      !/^(---|___|\*\*\*)$/.test((lines[index] ?? '').trim())
    ) {
      paragraphLines.push((lines[index] ?? '').trim())
      index += 1
    }
    html.push(`<p>${renderInlineMarkdown(paragraphLines.join(' '))}</p>`)
  }

  return { headings, html: html.join('\n') }
}
