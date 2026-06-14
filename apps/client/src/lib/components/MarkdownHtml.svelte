<script lang="ts">
import { tryGetPreviewContext } from '../preview/preview-context'
import { renderMarkdown } from '../services/markdown/render-markdown'
import { createMarkdownActions } from './markdown-actions'

interface Props {
  source?: string
  highlight?: boolean
  appendCaret?: boolean
  className?: string
}

let { source = '', highlight = true, appendCaret = false, className = '' }: Props = $props()

const attachMarkdownActions = createMarkdownActions(tryGetPreviewContext())
const html = $derived(renderMarkdown(source, { appendCaret, highlight }))
</script>

<div class={`md-body ${className}`.trim()} use:attachMarkdownActions={html}>
  {@html html}
</div>
