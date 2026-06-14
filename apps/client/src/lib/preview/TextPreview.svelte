<script lang="ts">
import { createDocFromMessage } from '../prompt-editor/markdown'
import TiptapPromptEditor from '../prompt-editor/TiptapPromptEditor.svelte'
import { copyTextToClipboard } from '../services/clipboard'
import type { TextPreviewItem } from './types'

interface Props {
  item: TextPreviewItem
  onSave?: ((content: string) => void) | null
}

let { item, onSave = null }: Props = $props()

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const isMarkdownItem = (value: TextPreviewItem): boolean =>
  value.mime === 'text/markdown' || value.name.endsWith('.md') || value.name.endsWith('.markdown')

const getFrontmatterMatch = (value: TextPreviewItem): RegExpMatchArray | null =>
  isMarkdownItem(value) ? value.content.match(FRONTMATTER_RE) : null

const getFrontmatterYaml = (value: TextPreviewItem): string => getFrontmatterMatch(value)?.[1] ?? ''

const getSourceEditorContent = (value: TextPreviewItem): string => {
  const match = getFrontmatterMatch(value)
  return match ? value.content.slice(match[0].length) : value.content
}

const initialDraft = (() => {
  const markdown = createDocFromMessage(getSourceEditorContent(item))

  return {
    editedFrontmatter: getFrontmatterYaml(item),
    editorMarkdown: markdown,
    initialMarkdown: markdown,
  }
})()

let copyLabel = $state('Copy')
let copyTimer: number | null = null
let isDirty = $state(false)
let editorMarkdown = $state(initialDraft.editorMarkdown)
let initialMarkdown = $state(initialDraft.initialMarkdown)
let editedFrontmatter = $state(initialDraft.editedFrontmatter)
let frontmatterDirty = $state(false)
let editorReady = $state(false)
let previewItemKey = $state(0)
let previousItem: TextPreviewItem | null = null

const isMarkdown = $derived(isMarkdownItem(item))
const frontmatterMatch = $derived(isMarkdown ? item.content.match(FRONTMATTER_RE) : null)
const frontmatterYaml = $derived(frontmatterMatch?.[1] ?? '')
const sourceEditorContent = $derived(
  frontmatterMatch ? item.content.slice(frontmatterMatch[0].length) : item.content,
)

$effect(() => {
  if (previousItem === null) {
    previousItem = item
    return
  }

  if (item === previousItem) {
    return
  }

  previousItem = item
  previewItemKey += 1
  editorReady = false
})

$effect(() => {
  const nextMarkdown = createDocFromMessage(sourceEditorContent)
  editorMarkdown = nextMarkdown
  initialMarkdown = nextMarkdown
  editedFrontmatter = frontmatterYaml
  frontmatterDirty = false
  isDirty = false
})

const getFullContent = (): string => {
  const body = editorMarkdown
  if (!frontmatterMatch) return body
  const fm = frontmatterDirty ? editedFrontmatter : frontmatterYaml
  return `---\n${fm}\n---\n${body}`
}

const handleMarkdownChange = (markdown: string) => {
  editorMarkdown = markdown
  isDirty = markdown !== initialMarkdown || frontmatterDirty
}

const handleFrontmatterInput = (event: Event) => {
  editedFrontmatter = (event.target as HTMLTextAreaElement).value
  frontmatterDirty = editedFrontmatter !== frontmatterYaml
  isDirty = frontmatterDirty || editorMarkdown !== initialMarkdown
}

const handleCopy = async () => {
  try {
    await copyTextToClipboard(getFullContent())
    copyLabel = 'Copied'
  } catch {
    copyLabel = 'Failed'
  }

  if (copyTimer != null) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copyLabel = 'Copy'
    copyTimer = null
  }, 1200)
}

const handleSave = () => {
  onSave?.(getFullContent())
  initialMarkdown = editorMarkdown
  isDirty = false
}
</script>

<div class="preview-text flex min-h-0 flex-1 flex-col">
  <div class="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
    <div class="flex items-center gap-3 text-[11px] text-text-tertiary">
      <span>{item.mime}</span>
      {#if isDirty}
        <span class="text-accent">unsaved</span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="rounded border border-border bg-surface-0 px-2 py-0.5 text-[12px] text-text-secondary transition-colors hover:text-text-primary"
        onclick={() => { void handleCopy() }}
      >
        {copyLabel}
      </button>
      {#if item.editable && onSave}
        <button
          type="button"
          class="rounded border border-border px-2 py-0.5 text-[12px] transition-colors {isDirty ? 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20' : 'bg-surface-0 text-text-tertiary'}"
          disabled={!isDirty}
          onclick={handleSave}
        >
          Save
        </button>
      {/if}
    </div>
  </div>

  {#if isMarkdown}
    <div class="min-h-0 flex-1 overflow-auto bg-surface-1">
      {#if frontmatterYaml}
        <div class="mx-5 mt-4 rounded border border-border/40 bg-surface-0/50 px-3.5 py-2.5">
          <div class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Frontmatter</div>
          <textarea
            class="w-full resize-none bg-transparent font-mono text-[12px] leading-relaxed text-text-secondary outline-none"
            rows={frontmatterYaml.split('\n').length}
            value={frontmatterDirty ? editedFrontmatter : frontmatterYaml}
            oninput={handleFrontmatterInput}
          ></textarea>
        </div>
      {/if}
      {#key previewItemKey}
        {#if !editorReady}
          <div class="preview-skeleton" aria-hidden="true">
            <div class="skel-line w-2/5 h-5"></div>
            <div class="skel-line w-full"></div>
            <div class="skel-line w-11/12"></div>
            <div class="skel-line w-4/5"></div>
            <div class="skel-line w-0 h-2"></div>
            <div class="skel-line w-full"></div>
            <div class="skel-line w-3/5"></div>
          </div>
        {/if}
        <div class={`preview-editor-fade ${editorReady ? 'opacity-100' : 'opacity-0'}`}>
          <TiptapPromptEditor
            value={editorMarkdown}
            placeholder=""
            ariaLabel="File content"
            disabled={false}
            onMarkdownChange={handleMarkdownChange}
            onReady={() => {
              editorReady = true
            }}
          />
        </div>
      {/key}
    </div>
  {:else}
    <textarea
      class="min-h-0 flex-1 resize-none overflow-auto bg-surface-1 px-5 py-3 font-mono text-[13px] leading-relaxed text-text-primary outline-none"
      value={item.content}
      readonly={!item.editable}
    ></textarea>
  {/if}
</div>

<style>
  .preview-text :global(.sd-prompt-shell) {
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    flex: none !important;
  }

  .preview-skeleton {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem 1.25rem;
  }

  .skel-line {
    height: 0.75rem;
    border-radius: 4px;
    background: var(--color-surface-2);
    opacity: 0.5;
    animation: skel-pulse 1.2s ease-in-out infinite;
  }

  @keyframes skel-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.6; }
  }

  .preview-editor-fade {
    transition: opacity 120ms ease;
  }

  .preview-text :global(.sd-prompt-editor .ProseMirror) {
    max-height: none !important;
    overflow-y: visible !important;
    padding: 1rem 1.25rem !important;
  }

  .preview-text :global(.sd-prompt-editor .ProseMirror img) {
    max-width: 50%;
  }
</style>
