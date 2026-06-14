import { normalizeModelVisibleImageMarkdown } from '../../../../shared/markdown-images'
import { track } from '../../utils/perf'
import { createCodeBlockRenderer } from './code-block-renderer'
import { createMarkdownPipeline } from './markdown-pipeline'
import { createRenderCache } from './render-cache'
import { sanitizeHtml } from './sanitize-html'

const CARET_SPAN = '<span class="caret-blink" aria-hidden="true"></span>'
const MAX_CACHE_ENTRIES = 400

const injectCaret = (html: string): string => {
  const closingTags = [
    '</p>',
    '</li>',
    '</td>',
    '</th>',
    '</blockquote>',
    '</h1>',
    '</h2>',
    '</h3>',
    '</h4>',
  ]

  let bestPosition = -1

  for (const tag of closingTags) {
    const position = html.lastIndexOf(tag)
    if (position > bestPosition) {
      bestPosition = position
    }
  }

  if (bestPosition !== -1) {
    return html.slice(0, bestPosition) + CARET_SPAN + html.slice(bestPosition)
  }

  return html + CARET_SPAN
}

const codeBlockRenderer = createCodeBlockRenderer()
const renderCache = createRenderCache(MAX_CACHE_ENTRIES)
const highlightedMarkdown = createMarkdownPipeline({
  highlight: true,
  renderCodeBlock: codeBlockRenderer,
})
const plainMarkdown = createMarkdownPipeline({
  highlight: false,
  renderCodeBlock: codeBlockRenderer,
})

export interface RenderMarkdownOptions {
  appendCaret?: boolean
  highlight?: boolean
}

const normalizeOptions = (
  options: boolean | RenderMarkdownOptions,
): Required<RenderMarkdownOptions> =>
  typeof options === 'boolean'
    ? { appendCaret: false, highlight: options }
    : { appendCaret: false, highlight: true, ...options }

const cacheKeyFor = (content: string, options: Required<RenderMarkdownOptions>): string =>
  `${options.highlight ? '1' : '0'}:${options.appendCaret ? '1' : '0'}:${content}`

/**
 * Renders markdown to safe HTML.
 * `highlight=false` keeps code blocks cheap during active streaming.
 * `appendCaret=true` injects the typing caret into the last textual block.
 */
export const renderMarkdown = (
  content: string,
  options: boolean | RenderMarkdownOptions = true,
): string => {
  const normalizedOptions = normalizeOptions(options)
  const normalizedContent = normalizeModelVisibleImageMarkdown(content ?? '')
  const key = cacheKeyFor(normalizedContent, normalizedOptions)
  const cached = renderCache.get(key)

  if (cached !== undefined) {
    track('renderMarkdown', () => undefined, true)
    return cached
  }

  return track(
    'renderMarkdown',
    () => {
      const rendered = normalizedOptions.highlight
        ? highlightedMarkdown.render(normalizedContent)
        : plainMarkdown.render(normalizedContent)
      const withCaret = normalizedOptions.appendCaret ? injectCaret(rendered) : rendered
      const sanitized = sanitizeHtml(withCaret)

      renderCache.set(key, sanitized)
      return sanitized
    },
    false,
  )
}
