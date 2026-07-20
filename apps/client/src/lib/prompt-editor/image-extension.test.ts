import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'vitest'
import { PromptImage } from './image-extension'

const imageMarkdown = '![Chart](https://example.com/chart.png)'

const createEditor = (content: string) =>
  new Editor({
    element: null,
    extensions: [StarterKit, PromptImage, Markdown],
    content,
    contentType: 'markdown',
  })

const findNodePosition = (state: EditorState, type: string): number => {
  let found = -1
  state.doc.descendants((node, position) => {
    if (node.type.name === type && found < 0) {
      found = position
      return false
    }
  })
  if (found < 0) throw new Error(`Expected a ${type} node.`)
  return found
}

const findTextPosition = (state: EditorState, text: string): number => {
  let found = -1
  state.doc.descendants((node, position) => {
    const offset = node.isText ? (node.text?.indexOf(text) ?? -1) : -1
    if (offset >= 0) {
      found = position + offset
      return false
    }
  })
  if (found < 0) throw new Error(`Expected text ${text}.`)
  return found
}

const pluginFor = (editor: Editor) => {
  const plugin = editor.extensionManager.plugins.find((candidate) =>
    candidate.key.startsWith('imageInlineEdit$'),
  )
  if (!plugin) throw new Error('Expected the PromptImage plugin.')
  return plugin
}

const applyTransaction = (
  editor: Editor,
  oldState: EditorState,
  transaction: Transaction,
): EditorState => {
  const nextState = oldState.apply(transaction)
  const appended = pluginFor(editor).spec.appendTransaction?.([transaction], oldState, nextState)
  return appended ? nextState.apply(appended) : nextState
}

const selectImage = (editor: Editor): EditorState => {
  const position = findNodePosition(editor.state, 'image')
  return applyTransaction(
    editor,
    editor.state,
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)),
  )
}

const pressKey = (
  editor: Editor,
  state: EditorState,
  key: 'Enter' | 'Backspace',
  position: number,
): EditorState => {
  let currentState = state.apply(state.tr.setSelection(TextSelection.create(state.doc, position)))
  const view = {
    dispatch(transaction: Transaction) {
      currentState = applyTransaction(editor, currentState, transaction)
      view.state = currentState
    },
    state: currentState,
  }
  const event = {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    preventDefault() {},
    shiftKey: false,
  } as KeyboardEvent

  expect(pluginFor(editor).props.handleKeyDown?.(view as never, event)).toBe(true)
  return currentState
}

const countNodes = (state: EditorState, type: string): number => {
  let count = 0
  state.doc.descendants((node) => {
    if (node.type.name === type) count += 1
  })
  return count
}

describe('prompt image inline editing', () => {
  test('expands a selected inline image onto a dedicated editable line', () => {
    const editor = createEditor(`Before ${imageMarkdown} After`)
    const expanded = selectImage(editor)

    expect(expanded.selection).toBeInstanceOf(TextSelection)
    expect(expanded.doc.textContent).toBe(`Before ${imageMarkdown} After`)
    expect(countNodes(expanded, 'image')).toBe(0)
    expect(countNodes(expanded, 'hardBreak')).toBe(2)
  })

  test('collapses edited markdown back into an image when selection leaves it', () => {
    const editor = createEditor(`Before ${imageMarkdown} After`)
    const expanded = selectImage(editor)
    const collapsed = applyTransaction(
      editor,
      expanded,
      expanded.tr.setSelection(TextSelection.create(expanded.doc, 1)),
    )

    expect(collapsed.doc.toJSON()).toEqual(editor.state.doc.toJSON())
  })

  test('keeps nested list structure while expanding image markdown', () => {
    const editor = createEditor(`- Before ${imageMarkdown} After`)
    const expanded = selectImage(editor)

    expect(expanded.doc.firstChild?.type.name).toBe('bulletList')
    expect(expanded.doc.textContent).toBe(`Before ${imageMarkdown} After`)
    expect(countNodes(expanded, 'hardBreak')).toBe(2)
  })

  test('Enter and Backspace move an image down and back up without losing it', () => {
    const editor = createEditor(`Before ${imageMarkdown} After`)
    const expanded = selectImage(editor)
    const markdownStart = findTextPosition(expanded, '![Chart]')
    const movedDown = pressKey(editor, expanded, 'Enter', markdownStart)

    expect(countNodes(movedDown, 'image')).toBe(1)
    expect(countNodes(movedDown, 'hardBreak')).toBe(3)

    const movedUp = pressKey(editor, movedDown, 'Backspace', movedDown.selection.from)
    expect(countNodes(movedUp, 'image')).toBe(1)
    expect(countNodes(movedUp, 'hardBreak')).toBe(2)
    expect(movedUp.doc.textContent).toBe('Before  After')
  })
})
