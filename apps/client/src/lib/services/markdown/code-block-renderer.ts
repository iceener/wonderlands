import { hljs } from './highlight'

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const escapeAttribute = (value: string): string => escapeHtml(value).replace(/'/g, '&#39;')

const resolveLanguage = (language: string): string =>
  language && hljs.getLanguage(language) ? language : 'plaintext'

const prettyLanguageLabel = (language: string): string => {
  const normalized = language.toLowerCase()

  switch (normalized) {
    case '':
    case 'plaintext':
      return 'text'
    case 'js':
      return 'javascript'
    case 'ts':
      return 'typescript'
    case 'md':
      return 'markdown'
    case 'sh':
      return 'shell'
    default:
      return normalized
  }
}

const trimTrailingNewlines = (code: string): string => code.replace(/\n+$/, '')

const SPAN_TAG_RE = /<span\b[^>]*>|<\/span>/g

/**
 * Wrap each line of hljs-highlighted HTML in `<span class="line">`,
 * correctly handling `<span>` tags that cross line boundaries
 * (e.g. hljs sub-language wrappers for `<script>` content).
 */
const wrapLines = (html: string): string => {
  const lines = html.split('\n')
  const openSpans: string[] = []
  const result: string[] = []

  for (const line of lines) {
    const prefix = openSpans.join('')

    let tag: RegExpExecArray | null
    SPAN_TAG_RE.lastIndex = 0
    tag = SPAN_TAG_RE.exec(line)
    while (tag !== null) {
      if (tag[0] === '</span>') {
        openSpans.pop()
      } else {
        openSpans.push(tag[0])
      }

      tag = SPAN_TAG_RE.exec(line)
    }

    const suffix = '</span>'.repeat(openSpans.length)
    result.push(`<span class="line">${prefix}${line}${suffix}</span>`)
  }

  return result.join('')
}

export type CodeBlockRenderer = (code: string, info: string, highlight: boolean) => string

export interface CodeBlockRenderModel {
  language: string
  label: string
  lines: string[]
  highlightedLines: string[]
}

export const buildCodeBlockRenderModel = (
  code: string,
  info: string,
  highlight: boolean,
): CodeBlockRenderModel => {
  const [languageHint = ''] = info.trim().split(/\s+/)
  const resolvedLanguage = resolveLanguage(languageHint)
  const label = prettyLanguageLabel(languageHint || resolvedLanguage)
  const trimmedCode = trimTrailingNewlines(code)

  if (!highlight) {
    return {
      language: resolvedLanguage,
      label,
      lines: trimmedCode.split('\n'),
      highlightedLines: [],
    }
  }

  const renderedCode = hljs.highlight(trimmedCode, { language: resolvedLanguage }).value
  const highlightedLines = wrapLines(renderedCode)
    .split(/(?=<span class="line">)/)
    .filter((line) => line.length > 0)

  return {
    language: resolvedLanguage,
    label,
    lines: trimmedCode.split('\n'),
    highlightedLines,
  }
}

export const createCodeBlockRenderer = (): CodeBlockRenderer => (code, info, highlight) => {
  const model = buildCodeBlockRenderModel(code, info, highlight)
  const wrappedLines = highlight
    ? model.highlightedLines.join('')
    : model.lines.map((line) => `<span class="line">${escapeHtml(line)}</span>`).join('')

  return [
    `<div class="sd-code-block" data-code-block data-language="${escapeAttribute(model.label)}">`,
    '<div class="sd-code-header">',
    `<span class="sd-code-language">${escapeHtml(model.label)}</span>`,
    '<div class="sd-code-actions">',
    '<button class="sd-code-button" type="button" data-copy-code>Copy</button>',
    '<button class="sd-code-button" type="button" data-download-code>Download</button>',
    '</div>',
    '</div>',
    `<pre class="code-shell" tabindex="0"><code class="hljs language-${escapeAttribute(model.language)}">${wrappedLines}</code></pre>`,
    '</div>',
  ].join('')
}
