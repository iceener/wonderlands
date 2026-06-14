import type { Extension } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { collectTransferFiles } from '../attachments/intake'
import { PromptAgentMention } from './agent-mention-extension'
import { PromptFileMention } from './file-mention-extension'
import { PromptImage } from './image-extension'
import { shouldUploadLargeTextPaste } from './large-paste'
import {
  createDocFromMessage,
  getMarkdownFromEditor,
  getMarkdownPasteContent,
  sanitizeMarkdownPaste,
} from './markdown'
import type { LargeTextPastePayload } from './types'

export interface CreatePromptEditorOptions {
  disabled?: boolean
  element: HTMLElement
  onEditorKeyDown?: (event: KeyboardEvent, cursorAtStart: boolean) => boolean
  onLargeTextPaste?: (payload: LargeTextPastePayload) => void
  onMarkdownChange?: (markdown: string) => void
  onPasteFiles?: (files: File[]) => void
  onSubmitShortcut?: () => void
  placeholder?: string
  shouldSuppressSubmitShortcut?: () => boolean
  triggers?: Extension[]
  value?: string
}

const CLEAN_ESCAPED_MD = /\\([_*~`[\]()#>+\-!|])/g

const URL_PATTERN = /^https?:\/\/\S+$/i

const hasClipboardHtml = (clipboardData: DataTransfer | null): boolean =>
  Array.from(clipboardData?.types ?? []).includes('text/html')

const getPastedUrl = (clipboardData: DataTransfer | null): string | null => {
  const plainText = clipboardData?.getData('text/plain')?.trim() ?? ''
  return URL_PATTERN.test(plainText) ? plainText : null
}

export const createPromptEditor = ({
  disabled = false,
  element,
  onEditorKeyDown,
  onLargeTextPaste,
  onMarkdownChange,
  onPasteFiles,
  onSubmitShortcut,
  placeholder = 'Message…',
  shouldSuppressSubmitShortcut,
  triggers = [],
  value = '',
}: CreatePromptEditorOptions): Editor => {
  let editor!: Editor

  const pasteState = (): { _pasteInProgress?: boolean } =>
    editor as unknown as { _pasteInProgress?: boolean }

  const emitMarkdown = () => {
    onMarkdownChange?.(getMarkdownFromEditor(editor))
  }

  editor = new Editor({
    element,
    editable: !disabled,
    content: createDocFromMessage(value),
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({
        dropcursor: false,
        link: false,
      }),
      Link.configure({
        autolink: false,
        defaultProtocol: 'https',
        linkOnPaste: true,
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: false,
      }),
      PromptAgentMention,
      PromptFileMention,
      PromptImage,
      Markdown,
      ...triggers,
    ],
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (onEditorKeyDown) {
          const cursorAtStart = editor.state.selection.empty && editor.state.selection.from <= 1
          if (onEditorKeyDown(event, cursorAtStart)) {
            event.preventDefault()
            return true
          }
        }

        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          if (shouldSuppressSubmitShortcut?.()) {
            return false
          }
          event.preventDefault()
          onSubmitShortcut?.()
          return true
        }

        return false
      },
      handleDrop: (_view, event) => {
        const files = collectTransferFiles(event.dataTransfer)
        if (files.length === 0 || !onPasteFiles) {
          return false
        }

        event.preventDefault()
        onPasteFiles(files)
        return true
      },
      handlePaste: (_view, event) => {
        const _clipboardTypes = Array.from(event.clipboardData?.types ?? [])
        const files = collectTransferFiles(event.clipboardData)

        // Mark paste in progress so suggestion triggers ignore these transactions
        const withPasteProgress = <TValue>(action: () => TValue): TValue => {
          pasteState()._pasteInProgress = true
          try {
            return action()
          } finally {
            queueMicrotask(() => {
              pasteState()._pasteInProgress = false
            })
          }
        }

        const pasteInsert = (
          content: Parameters<typeof editor.commands.insertContent>[0],
          options?: Parameters<typeof editor.commands.insertContentAt>[2],
        ): boolean =>
          withPasteProgress(() => {
            const { from, to } = editor.state.selection

            return editor.commands.insertContentAt({ from, to }, content, {
              ...options,
              errorOnInvalidContent: false,
            })
          })

        const pasteInsertMarkdown = (markdownContent: string): boolean =>
          withPasteProgress(() => {
            const content = getMarkdownPasteContent(editor, markdownContent)
            const { from, to } = editor.state.selection

            if (content.length === 0) {
              return true
            }

            return editor.commands.insertContentAt({ from, to }, content, {
              errorOnInvalidContent: false,
            })
          })

        // Files (including images): send to attachment system
        if (files.length > 0) {
          if (!onPasteFiles) {
            return false
          }

          event.preventDefault()
          onPasteFiles(files)
          return true
        }

        const plainText = event.clipboardData?.getData('text/plain') ?? ''
        const cleanedPlainText = sanitizeMarkdownPaste(plainText).replace(CLEAN_ESCAPED_MD, '$1')
        const markdown = createDocFromMessage(event.clipboardData?.getData('text/markdown') ?? '')
        const pastedUrl = getPastedUrl(event.clipboardData)
        const { from, to } = editor.state.selection

        if (from !== to && pastedUrl) {
          event.preventDefault()
          return editor
            .chain()
            .focus()
            .setTextSelection({ from, to })
            .setLink({ href: pastedUrl })
            .run()
        }

        const oversizedPaste =
          onLargeTextPaste && shouldUploadLargeTextPaste(markdown || cleanedPlainText)
            ? {
                format: markdown ? ('markdown' as const) : ('text' as const),
                text: markdown || cleanedPlainText,
              }
            : null

        if (oversizedPaste) {
          event.preventDefault()
          const handleLargeTextPaste = onLargeTextPaste
          return withPasteProgress(() => {
            handleLargeTextPaste?.({
              editor,
              format: oversizedPaste.format,
              range: { from, to },
              text: oversizedPaste.text,
            })
            return true
          })
        }

        if (editor.isActive('codeBlock')) {
          return false
        }

        if (markdown) {
          event.preventDefault()
          return pasteInsertMarkdown(markdown)
        }

        if (hasClipboardHtml(event.clipboardData)) {
          return false
        }

        if (!plainText) {
          return false
        }

        event.preventDefault()

        try {
          return pasteInsertMarkdown(cleanedPlainText)
        } catch (_error) {
          return pasteInsert(cleanedPlainText)
        }
      },
    },
    onCreate: emitMarkdown,
    onUpdate: emitMarkdown,
  })

  return editor
}
