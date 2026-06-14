import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, test } from 'vitest'
import { PromptImage } from './image-extension'

const createEditor = (content: string) =>
  new Editor({
    element: null,
    extensions: [StarterKit, PromptImage, Markdown],
    content,
    contentType: 'markdown',
  })

const findImagePos = (editor: Editor): number => {
  let imagePos = -1

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && imagePos < 0) {
      imagePos = pos
      return false
    }
  })

  if (imagePos < 0) {
    throw new Error('Expected an image node in the test document.')
  }

  return imagePos
}

const findImagePosInState = (state: EditorState): number => {
  let imagePos = -1

  state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && imagePos < 0) {
      imagePos = pos
      return false
    }
  })

  if (imagePos < 0) {
    throw new Error('Expected an image node in the test document.')
  }

  return imagePos
}

const applyImageAppendTransaction = (
  editor: Editor,
  oldState: EditorState,
  transaction: Transaction,
): EditorState => {
  const nextState = oldState.apply(transaction)
  const plugin = editor.extensionManager.plugins.find((candidate) =>
    candidate.key.startsWith('imageInlineEdit$'),
  )

  if (!plugin?.spec.appendTransaction) {
    throw new Error('Expected the PromptImage appendTransaction plugin to be registered.')
  }

  const appended = plugin.spec.appendTransaction([transaction], oldState, nextState)

  return appended ? nextState.apply(appended) : nextState
}

const applyImageKeyDown = (
  editor: Editor,
  oldState: EditorState,
  key: string,
  selection: TextSelection,
): { handled: boolean; state: EditorState } => {
  const plugin = editor.extensionManager.plugins.find((candidate) =>
    candidate.key.startsWith('imageInlineEdit$'),
  )

  if (!plugin?.props.handleKeyDown) {
    throw new Error('Expected the PromptImage keydown handler to be registered.')
  }

  let currentState = oldState.apply(oldState.tr.setSelection(selection))
  const view = {
    dispatch(tr: Transaction) {
      currentState = applyImageAppendTransaction(editor, currentState, tr)
      view.state = currentState
    },
    state: currentState,
  }
  let defaultPrevented = false

  const handled = plugin.props.handleKeyDown(
    view as never,
    {
      altKey: false,
      ctrlKey: false,
      key,
      metaKey: false,
      preventDefault() {
        defaultPrevented = true
      },
      shiftKey: false,
    } as KeyboardEvent,
  )

  return {
    handled: Boolean(handled && defaultPrevented),
    state: currentState,
  }
}

const findTextPosition = (state: EditorState, text: string): number => {
  let foundPos = -1

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return
    }

    const offset = node.text.indexOf(text)
    if (offset >= 0) {
      foundPos = pos + offset
      return false
    }
  })

  if (foundPos < 0) {
    throw new Error(`Expected to find text "${text}" in the document.`)
  }

  return foundPos
}

describe('prompt image inline editing', () => {
  test('expands an inline image onto its own line when text follows', () => {
    const editor = createEditor('![Chart](https://example.com/chart.png)After text')
    const imagePos = findImagePos(editor)
    const result = applyImageAppendTransaction(
      editor,
      editor.state,
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
    )

    expect(result.selection).toBeInstanceOf(TextSelection)
    expect(result.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '![Chart](https://example.com/chart.png)',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'text',
              text: 'After text',
            },
          ],
        },
      ],
    })
  })

  test('expands an inline image onto its own line when surrounded by text', () => {
    const editor = createEditor('Before ![Chart](https://example.com/chart.png) After')
    const imagePos = findImagePos(editor)
    const result = applyImageAppendTransaction(
      editor,
      editor.state,
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
    )

    expect(result.selection).toBeInstanceOf(TextSelection)
    expect(result.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Before ',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'text',
              text: '![Chart](https://example.com/chart.png)',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'text',
              text: ' After',
            },
          ],
        },
      ],
    })
  })

  test('collapses expanded markdown back into an image when cursor leaves the markdown', () => {
    const editor = createEditor('Before ![Chart](https://example.com/chart.png) After')
    const imagePos = findImagePos(editor)
    const expanded = applyImageAppendTransaction(
      editor,
      editor.state,
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
    )

    const collapsed = applyImageAppendTransaction(
      editor,
      expanded,
      expanded.tr.setSelection(TextSelection.create(expanded.doc, 1)),
    )

    expect(collapsed.doc.toJSON()).toEqual(editor.state.doc.toJSON())
  })

  test('expands inside nested list content without changing block structure', () => {
    const editor = createEditor('- Before ![Chart](https://example.com/chart.png) After')
    const imagePos = findImagePos(editor)
    const result = applyImageAppendTransaction(
      editor,
      editor.state,
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
    )

    expect(result.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Before ',
                    },
                    {
                      type: 'hardBreak',
                    },
                    {
                      type: 'text',
                      text: '![Chart](https://example.com/chart.png)',
                    },
                    {
                      type: 'hardBreak',
                    },
                    {
                      type: 'text',
                      text: ' After',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
  })

  test('pressing Enter inside expanded image markdown collapses it and creates a continuation line', () => {
    const editor = createEditor('Before ![Chart](https://example.com/chart.png) After')
    const imagePos = findImagePos(editor)
    const expanded = applyImageAppendTransaction(
      editor,
      editor.state,
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
    )
    const markdownPos = findTextPosition(expanded, 'https://example.com/chart.png')
    const enterResult = applyImageKeyDown(
      editor,
      expanded,
      'Enter',
      TextSelection.create(expanded.doc, markdownPos),
    )

    expect(enterResult.handled).toBe(true)
    expect(enterResult.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Before ',
            },
            {
              type: 'image',
              attrs: {
                alt: 'Chart',
                src: 'https://example.com/chart.png',
                title: null,
              },
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'text',
              text: ' After',
            },
          ],
        },
      ],
    })
  })

  test('pressing Enter at the start of expanded image markdown pushes the image down', () => {
    const editor = createEditor('Before ![Chart](https://example.com/chart.png) After')
    const imagePos = findImagePos(editor)
    const expanded = applyImageAppendTransaction(
      editor,
      editor.state,
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
    )
    const markdownStart = findTextPosition(expanded, '![Chart]')
    const enterResult = applyImageKeyDown(
      editor,
      expanded,
      'Enter',
      TextSelection.create(expanded.doc, markdownStart),
    )

    expect(enterResult.handled).toBe(true)
    expect(enterResult.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Before ',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'image',
              attrs: {
                alt: 'Chart',
                src: 'https://example.com/chart.png',
                title: null,
              },
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'text',
              text: ' After',
            },
          ],
        },
      ],
    })
  })

  test('pressing Enter directly before an image pushes it down another line', () => {
    const editor = createEditor('Before ![Chart](https://example.com/chart.png) After')
    const imagePos = findImagePos(editor)
    const expanded = applyImageAppendTransaction(
      editor,
      editor.state,
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
    )
    const markdownStart = findTextPosition(expanded, '![Chart]')
    const firstEnter = applyImageKeyDown(
      editor,
      expanded,
      'Enter',
      TextSelection.create(expanded.doc, markdownStart),
    )
    const secondEnter = applyImageKeyDown(
      editor,
      firstEnter.state,
      'Enter',
      firstEnter.state.selection as TextSelection,
    )

    expect(secondEnter.handled).toBe(true)
    expect(secondEnter.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Before ',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'image',
              attrs: {
                alt: 'Chart',
                src: 'https://example.com/chart.png',
                title: null,
              },
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'text',
              text: ' After',
            },
          ],
        },
      ],
    })
    expect((secondEnter.state.selection as TextSelection).from).toBe(
      findImagePosInState(secondEnter.state),
    )
  })

  test('pressing Backspace directly before an image pulls it up one line', () => {
    const editor = createEditor('Before ![Chart](https://example.com/chart.png) After')
    const imagePos = findImagePos(editor)
    const expanded = applyImageAppendTransaction(
      editor,
      editor.state,
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
    )
    const markdownStart = findTextPosition(expanded, '![Chart]')
    const firstEnter = applyImageKeyDown(
      editor,
      expanded,
      'Enter',
      TextSelection.create(expanded.doc, markdownStart),
    )
    const backspace = applyImageKeyDown(
      editor,
      firstEnter.state,
      'Backspace',
      firstEnter.state.selection as TextSelection,
    )

    expect(backspace.handled).toBe(true)
    expect(backspace.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Before ',
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'image',
              attrs: {
                alt: 'Chart',
                src: 'https://example.com/chart.png',
                title: null,
              },
            },
            {
              type: 'hardBreak',
            },
            {
              type: 'text',
              text: ' After',
            },
          ],
        },
      ],
    })
  })
})
