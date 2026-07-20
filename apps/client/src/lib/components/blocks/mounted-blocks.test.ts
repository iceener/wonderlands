// @vitest-environment jsdom
import type { Block } from '@wonderlands/contracts/chat'
import { type Component, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('svelte', async () => {
  // @ts-expect-error Vitest otherwise resolves Svelte's SSR entry in JSDOM.
  return await import('../../../../../../node_modules/svelte/src/index-client.js')
})
vi.mock('../../stores/theme.svelte', () => ({ themeStore: { isDark: false } }))

import { createMountTarget, installDomPolyfills } from '../../../test/dom'
import BlockRenderer from './BlockRenderer.svelte'
import ErrorBlock from './ErrorBlock.svelte'

installDomPolyfills()

const mounted: Array<{ instance: Record<string, unknown>; target: HTMLElement }> = []

afterEach(async () => {
  for (const { instance, target } of mounted.splice(0)) {
    await unmount(instance)
    target.remove()
  }
})

const render = <Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
) => {
  const target = createMountTarget()
  const instance = mount(component, { props, target })
  mounted.push({ instance, target })
  return target
}

describe('mounted message blocks', () => {
  test('renders an actionable error as an assertive alert', async () => {
    const retry = vi.fn()
    const target = render(ErrorBlock, {
      action: { label: 'Retry', onclick: retry },
      message: 'The request failed',
    })
    await tick()

    const alert = target.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('The request failed')
    target.querySelector<HTMLButtonElement>('button')?.click()
    expect(retry).toHaveBeenCalledOnce()
  })

  test('renders error blocks and a live waiting state through BlockRenderer', async () => {
    const errorBlock: Block = {
      createdAt: '2026-04-06T12:00:00.000Z',
      id: 'error-1',
      message: 'Provider unavailable',
      type: 'error',
    }
    const errorTarget = render(BlockRenderer, {
      blocks: [errorBlock],
      messageStatus: 'error' as const,
    })
    await tick()
    expect(errorTarget.querySelector('[role="alert"]')?.textContent).toContain(
      'Provider unavailable',
    )

    const waitingTarget = render(BlockRenderer, { blocks: [], messageStatus: 'streaming' as const })
    await tick()
    expect(waitingTarget.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
      'Waiting for response',
    )
  })
})
