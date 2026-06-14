import type { Editor, Range } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { exitSuggestion, Suggestion } from '@tiptap/suggestion'

export interface TriggerCallbacks {
  onActivate: (props: { query: string; range: Range; editor: Editor }) => void
  onUpdate: (props: { query: string; range: Range; editor: Editor }) => void
  onDeactivate: () => void
  onKeyDown: (props: { event: KeyboardEvent; view: EditorView }) => boolean
}

export interface TriggerConfig {
  name: string
  char: string
  callbacks: TriggerCallbacks
}

export const createSuggestionTrigger = ({ name, char, callbacks }: TriggerConfig): Extension => {
  const pluginKey = new PluginKey(name)
  const readPasteState = (editor: Editor): { _pasteInProgress?: boolean } =>
    editor as unknown as { _pasteInProgress?: boolean }

  return Extension.create({
    name,

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char,
          pluginKey,
          allowedPrefixes: null,
          allowSpaces: false,
          startOfLine: false,

          shouldShow: ({ editor: ed, transaction }) => {
            // Skip if our custom paste handler is active
            if (readPasteState(ed)._pasteInProgress) return false
            // Skip if ProseMirror's native paste handler created this transaction
            if (transaction.getMeta('paste') || transaction.getMeta('uiEvent') === 'paste')
              return false
            return true
          },

          render: () => ({
            onStart: (props) => {
              callbacks.onActivate({
                query: props.query,
                range: props.range,
                editor: props.editor,
              })
            },

            onUpdate: (props) => {
              callbacks.onUpdate({
                editor: props.editor,
                query: props.query,
                range: props.range,
              })
            },

            onExit: () => {
              callbacks.onDeactivate()
            },

            onKeyDown: ({ event, view }) => {
              return callbacks.onKeyDown({ event, view })
            },
          }),
        }),
      ]
    },
  })
}

export { exitSuggestion }
