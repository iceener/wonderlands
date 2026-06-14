import MarkdownIt from 'markdown-it'
import type { CodeBlockRenderer } from './code-block-renderer'

interface MarkdownPipelineOptions {
  highlight: boolean
  renderCodeBlock: CodeBlockRenderer
}

const FILE_REFERENCE_PATTERN = /^#([^\s`\n][^`\n]*)$/
const AGENT_REFERENCE_PATTERN = /^@([a-z0-9][a-z0-9_-]*)$/i

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const renderFileReference = (value: string): string => {
  const label = escapeHtml(value)
  const title = escapeHtml(`#${value}`)

  return [
    '<span class="sd-file-mention" data-file-mention data-source="workspace" title="',
    title,
    '"><span class="sd-file-mention-prefix" aria-hidden="true">#</span><span class="sd-file-mention-label">',
    label,
    '</span></span>',
  ].join('')
}

const renderAgentReference = (value: string): string => {
  const label = escapeHtml(value)
  const title = escapeHtml(`@${value}`)

  return [
    '<span class="sd-agent-mention" data-agent-mention title="',
    title,
    '"><span class="sd-agent-mention-prefix" aria-hidden="true">@</span><span class="sd-agent-mention-label">',
    label,
    '</span></span>',
  ].join('')
}

export const createMarkdownPipeline = ({
  highlight,
  renderCodeBlock,
}: MarkdownPipelineOptions): MarkdownIt => {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
  })
  markdown.linkify.set({
    fuzzyLink: false,
  })

  const defaultLinkOpen =
    markdown.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noreferrer')
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  const defaultTableOpen =
    markdown.renderer.rules.table_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  const defaultTableClose =
    markdown.renderer.rules.table_close ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  markdown.renderer.rules.table_open = (tokens, idx, options, env, self) =>
    `<div class="md-table-wrap">${defaultTableOpen(tokens, idx, options, env, self)}`
  markdown.renderer.rules.table_close = (tokens, idx, options, env, self) =>
    `${defaultTableClose(tokens, idx, options, env, self)}</div>`

  const NON_IMAGE_HOSTS =
    /^https?:\/\/(www\.)?(vimeo\.com|youtube\.com|youtu\.be|twitter\.com|x\.com)\//i
  const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?)(\?|#|$)/i

  const isLikelyImageUrl = (url: string): boolean => {
    if (NON_IMAGE_HOSTS.test(url)) return false
    if (IMAGE_EXTENSIONS.test(url)) return true
    // Relative paths or API URLs without extensions — allow as images
    if (!url.startsWith('http')) return true
    // External URLs without a recognizable image extension — still allow, but
    // non-image hosts above are filtered out
    return true
  }

  const defaultImage = markdown.renderer.rules.image
  if (defaultImage) {
    markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
      const src = tokens[idx].attrGet('src') ?? ''
      if (!isLikelyImageUrl(src)) {
        // Render as a regular link instead of a broken <img>
        const alt = tokens[idx].content || src
        return `<a href="${escapeHtml(src)}" target="_blank" rel="noreferrer">${escapeHtml(alt)}</a>`
      }
      tokens[idx].attrSet('loading', 'lazy')
      tokens[idx].attrSet('decoding', 'async')
      return defaultImage(tokens, idx, options, env, self)
    }
  }

  markdown.renderer.rules.fence = (tokens, idx) =>
    renderCodeBlock(tokens[idx].content, tokens[idx].info, highlight)

  markdown.renderer.rules.code_block = (tokens, idx) =>
    renderCodeBlock(tokens[idx].content, '', highlight)

  const defaultInlineCode =
    markdown.renderer.rules.code_inline ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  markdown.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
    const content = tokens[idx]?.content ?? ''
    const match = content.match(FILE_REFERENCE_PATTERN)
    const agentMatch = content.match(AGENT_REFERENCE_PATTERN)

    if (match?.[1]) {
      return renderFileReference(match[1])
    }

    if (agentMatch?.[1]) {
      return renderAgentReference(agentMatch[1])
    }

    return defaultInlineCode(tokens, idx, options, env, self)
  }

  return markdown
}
