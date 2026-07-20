// @vitest-environment jsdom
import type { BackendFilePickerResult } from '@wonderlands/contracts/chat'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('svelte', async () => {
  // @ts-expect-error Vitest otherwise resolves Svelte's SSR entry in JSDOM.
  return await import('../../../../../../node_modules/svelte/src/index-client.js')
})

import { createMountTarget, installDomPolyfills } from '../../../test/dom'
import FilePickerPopoverHarness from '../../../test/FilePickerPopoverHarness.svelte'

installDomPolyfills()

const mounted: Array<{ instance: Record<string, unknown>; target: HTMLElement }> = []

afterEach(async () => {
  for (const { instance, target } of mounted.splice(0)) {
    await unmount(instance)
    target.remove()
  }
})

const result = (
  fileId: string,
  relativePath: string,
  source: BackendFilePickerResult['source'] = 'workspace',
): BackendFilePickerResult => ({
  accessScope: source === 'attachment' ? 'account_library' : null,
  depth: relativePath.split('/').length - 1,
  extension: relativePath.split('.').at(-1) ?? null,
  fileId,
  label: relativePath.split('/').at(-1) ?? relativePath,
  matchIndices: [],
  mentionText: `#${relativePath}`,
  mimeType: 'text/plain',
  relativePath,
  sizeBytes: 10,
  source,
})

const renderPicker = (props: {
  initialResults: BackendFilePickerResult[]
  onClose?: () => void
  onSelect: (picked: BackendFilePickerResult) => void
}) => {
  const target = createMountTarget()
  const instance = mount(FilePickerPopoverHarness, { props, target })
  mounted.push({ instance, target })
  return { instance, target }
}

describe('FilePickerPopover mounted interactions', () => {
  test('moves selection with arrows and selects the active result with Enter', async () => {
    const onSelect = vi.fn()
    const results = [result('fil_1', 'src/first.ts'), result('fil_2', 'src/second.ts')]
    const { target } = renderPicker({ initialResults: results, onSelect })
    await tick()

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
    await tick()

    const options = target.querySelectorAll<HTMLElement>('[role="option"]')
    expect(options[0]?.getAttribute('aria-selected')).toBe('false')
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    expect(onSelect).toHaveBeenCalledWith(results[1])
  })

  test('closes on Escape and outside pointer interaction', async () => {
    const onClose = vi.fn()
    renderPicker({
      initialResults: [result('fil_1', 'notes.md')],
      onClose,
      onSelect: () => undefined,
    })
    await tick()

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('replaces stale visible results when a newer result set arrives', async () => {
    const { instance, target } = renderPicker({
      initialResults: [result('fil_old', 'old-result.md')],
      onSelect: () => undefined,
    })
    await tick()

    flushSync(() => {
      instance.replaceResults([result('fil_new', 'new-result.md')])
    })

    expect(target.textContent).toContain('new-result.md')
    expect(target.textContent).not.toContain('old-result.md')
  })
})
