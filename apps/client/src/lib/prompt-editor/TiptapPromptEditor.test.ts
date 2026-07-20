// @vitest-environment jsdom
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('svelte', async () => {
  // @ts-expect-error Vitest otherwise resolves Svelte's SSR entry in JSDOM.
  return await import('../../../../../node_modules/svelte/src/index-client.js')
})

import { createMountTarget, dispatchPaste, installDomPolyfills } from '../../test/dom'
import TiptapPromptEditor from './TiptapPromptEditor.svelte'

installDomPolyfills()

const mounted: Array<{ instance: Record<string, unknown>; target: HTMLElement }> = []

afterEach(async () => {
  for (const { instance, target } of mounted.splice(0)) {
    await unmount(instance)
    target.remove()
  }
})

const renderEditor = (props: Parameters<typeof TiptapPromptEditor>[1]) => {
  const target = createMountTarget()
  const instance = mount(TiptapPromptEditor, { props, target })
  mounted.push({ instance, target })
  return { instance, target }
}

describe('TiptapPromptEditor mounted interactions', () => {
  test('reports markdown changes from real editor paste input', async () => {
    const onMarkdownChange = vi.fn()
    const { target } = renderEditor({ onMarkdownChange, value: '' })
    await tick()

    const editor = target.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor).not.toBeNull()
    dispatchPaste(editor!, { 'text/plain': '**Hello** from paste' })
    await tick()

    expect(onMarkdownChange).toHaveBeenLastCalledWith('**Hello** from paste')
  })

  test('submits on the platform shortcut unless submission is suppressed', async () => {
    const onSubmitShortcut = vi.fn()
    const { target } = renderEditor({ onSubmitShortcut, value: 'Ready' })
    await tick()
    const editor = target.querySelector<HTMLElement>('[contenteditable="true"]')

    editor?.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        metaKey: true,
      }),
    )
    expect(onSubmitShortcut).toHaveBeenCalledOnce()

    await unmount(mounted.pop()!.instance)
    target.remove()

    const suppressed = renderEditor({
      onSubmitShortcut,
      shouldSuppressSubmitShortcut: () => true,
      value: 'Blocked',
    })
    await tick()
    suppressed.target.querySelector<HTMLElement>('[contenteditable="true"]')?.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Enter',
      }),
    )
    expect(onSubmitShortcut).toHaveBeenCalledOnce()
  })

  test('exposes a non-editable prompt surface while disabled', async () => {
    const onSubmitShortcut = vi.fn()
    const { target } = renderEditor({ disabled: true, onSubmitShortcut, value: 'Waiting' })
    await tick()

    const editorHost = target.querySelector<HTMLElement>('[aria-label="Message prompt"]')
    expect(editorHost?.getAttribute('aria-readonly')).toBe('true')
    expect(target.querySelector('.sd-prompt-shell')?.getAttribute('data-disabled')).toBe('true')
    expect(target.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
  })
})
