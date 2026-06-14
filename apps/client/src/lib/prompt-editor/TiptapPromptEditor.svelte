<script lang="ts">
import type { Editor, Extension } from '@tiptap/core'
import { onDestroy, onMount } from 'svelte'
import { getReferencedAgentFromEditor } from './agent-mention-extension'
import { createPromptEditor } from './create-prompt-editor'
import { getReferencedFileIdsFromEditor } from './file-mention-extension'
import {
  createDocFromMessage,
  getMarkdownFromEditor,
  getMarkdownWithoutAgentMentionsFromEditor,
} from './markdown'
import type { LargeTextPastePayload } from './types'

interface Props {
  ariaDescribedBy?: string
  ariaLabel?: string
  disabled?: boolean
  onEditorKeyDown?: ((event: KeyboardEvent, cursorAtStart: boolean) => boolean) | null
  onLargeTextPaste?: ((payload: LargeTextPastePayload) => void) | null
  onMarkdownChange?: ((markdown: string) => void) | null
  onPasteFiles?: ((files: File[]) => void) | null
  onReady?: (() => void) | null
  onSubmitShortcut?: (() => void) | null
  placeholder?: string
  shouldSuppressSubmitShortcut?: (() => boolean) | null
  triggers?: Extension[]
  value?: string
}

let {
  ariaDescribedBy = undefined,
  ariaLabel = 'Message prompt',
  disabled = false,
  onEditorKeyDown = null,
  onLargeTextPaste = null,
  onMarkdownChange = null,
  onPasteFiles = null,
  onReady = null,
  onSubmitShortcut = null,
  placeholder = 'Message…',
  shouldSuppressSubmitShortcut = null,
  triggers = [],
  value = '',
}: Props = $props()

let editor: Editor | null = $state(null)
let editorHost: HTMLDivElement | null = $state(null)
let lastKnownMarkdown = $state('')
let readyTimer: ReturnType<typeof setTimeout> | null = null

const syncMarkdown = (markdown: string) => {
  lastKnownMarkdown = markdown
  onMarkdownChange?.(markdown)
}

onMount(() => {
  if (!editorHost) {
    return
  }

  lastKnownMarkdown = createDocFromMessage(value)
  editor = createPromptEditor({
    disabled,
    element: editorHost,
    onEditorKeyDown: onEditorKeyDown ?? undefined,
    onLargeTextPaste: onLargeTextPaste ?? undefined,
    onMarkdownChange: syncMarkdown,
    onPasteFiles: onPasteFiles ?? undefined,
    onSubmitShortcut: onSubmitShortcut ?? undefined,
    placeholder,
    shouldSuppressSubmitShortcut: shouldSuppressSubmitShortcut ?? undefined,
    triggers,
    value,
  })

  readyTimer = setTimeout(() => {
    readyTimer = null
    onReady?.()
  }, 150)
})

onDestroy(() => {
  if (readyTimer != null) {
    clearTimeout(readyTimer)
  }
  editor?.destroy()
  editor = null
})

$effect(() => {
  if (!editor) {
    return
  }

  editor.setEditable(!disabled)
})

$effect(() => {
  if (!editor) {
    return
  }

  const nextValue = createDocFromMessage(value)
  if (nextValue === lastKnownMarkdown) {
    return
  }

  if (nextValue === getMarkdownFromEditor(editor)) {
    lastKnownMarkdown = nextValue
    return
  }

  editor.commands.setContent(nextValue, { contentType: 'markdown', emitUpdate: false })
  lastKnownMarkdown = nextValue
})

export function focus() {
  editor?.commands.focus('end')
}

export function clear() {
  if (!editor) {
    return
  }

  editor.commands.clearContent(false)
  syncMarkdown(getMarkdownFromEditor(editor))
}

export function getMarkdown() {
  return editor ? getMarkdownFromEditor(editor) : createDocFromMessage(value)
}

export function getReferencedFileIds() {
  return editor ? getReferencedFileIdsFromEditor(editor) : []
}

export function getReferencedAgent() {
  return editor ? getReferencedAgentFromEditor(editor) : null
}

export function getSubmissionMarkdown() {
  return editor ? getMarkdownWithoutAgentMentionsFromEditor(editor) : createDocFromMessage(value)
}
</script>

<div
  class={`sd-prompt-shell flex-1 rounded border border-border bg-surface-1 text-text-primary transition-colors focus-within:border-border-strong ${disabled ? 'cursor-wait opacity-60' : ''}`}
  data-disabled={disabled || undefined}
>
  <div
    bind:this={editorHost}
    class="sd-prompt-editor"
    aria-describedby={ariaDescribedBy}
    aria-keyshortcuts="Meta+Enter Control+Enter"
    aria-label={ariaLabel}
    aria-multiline="true"
    aria-readonly={disabled}
    autocapitalize="sentences"
    spellcheck="true"
  ></div>
</div>
