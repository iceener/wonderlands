import { describe, expect, test } from 'vitest'
import {
  createScrollController,
  type ScrollControllerState,
  type ScrollViewportLike,
} from './scroll-controller'

interface TestContext {
  chunkHeights: Map<number, number>
  controller: ReturnType<typeof createScrollController>
  logs: Array<{ event: string; extra?: Record<string, unknown> }>
  metrics: Map<number, { endOffset: number }>
  state: ScrollControllerState
  totalHeight: number
  viewport: ScrollViewportLike
}

const createContext = (): TestContext => {
  const state: ScrollControllerState = {
    pinnedToBottom: true,
    scrollTop: 0,
    viewportHeight: 200,
  }

  const viewport: ScrollViewportLike = {
    clientHeight: 200,
    scrollHeight: 1000,
    scrollTop: 800,
    scrollTo(options) {
      this.scrollTop = options.top ?? this.scrollTop
    },
  }

  const chunkHeights = new Map<number, number>()
  const metrics = new Map<number, { endOffset: number }>()
  const logs: Array<{ event: string; extra?: Record<string, unknown> }> = []
  const currentTime = 1000
  let totalHeight = 1000

  const controller = createScrollController({
    defaultMessageHeight: 220,
    getChunkHeights: () => chunkHeights,
    getChunkMetric: (chunkIndex) => metrics.get(chunkIndex),
    getTotalHeight: () => totalHeight,
    getViewport: () => viewport,
    log(event, extra) {
      logs.push({ event, extra })
    },
    now: () => currentTime,
    pinReacquireDistance: 4,
    pinReleaseDistance: 80,
    setChunkHeights(next) {
      chunkHeights.clear()
      for (const entry of next.entries()) {
        chunkHeights.set(entry[0], entry[1])
      }
    },
    state,
  })

  return {
    chunkHeights,
    controller,
    logs,
    metrics,
    state,
    get totalHeight() {
      return totalHeight
    },
    set totalHeight(value: number) {
      totalHeight = value
    },
    viewport,
  }
}

describe('createScrollController', () => {
  test('releases and reacquires pin state based on distance from bottom', () => {
    const ctx = createContext()

    ctx.viewport.scrollTop = 600
    ctx.controller.handleScroll()

    expect(ctx.state.pinnedToBottom).toBe(false)

    ctx.viewport.scrollTop = 797
    ctx.controller.handleScroll()

    expect(ctx.state.pinnedToBottom).toBe(true)
  })

  test('anchors scroll position when a measured chunk above the viewport changes height', () => {
    const ctx = createContext()

    ctx.state.pinnedToBottom = false
    ctx.state.scrollTop = 500
    ctx.viewport.scrollTop = 500
    ctx.chunkHeights.set(0, 200)
    ctx.metrics.set(0, { endOffset: 120 })

    ctx.controller.updateChunkHeight(0, 260)

    expect(ctx.viewport.scrollTop).toBe(560)
    expect(ctx.state.scrollTop).toBe(560)
    expect(ctx.chunkHeights.get(0)).toBe(260)
  })

  test('prepositions and locks before performing the jump-to-bottom scroll', async () => {
    const ctx = createContext()
    const scheduled: Array<() => void> = []

    ctx.viewport.scrollTop = 120
    ctx.viewport.scrollHeight = 1000
    ctx.totalHeight = 1000

    await ctx.controller.jumpToBottom({
      awaitTick: async () => undefined,
      schedule(task) {
        scheduled.push(task)
      },
    })

    expect(ctx.state.scrollTop).toBe(800)
    expect(ctx.viewport.scrollTop).toBe(800)
    expect(ctx.state.pinnedToBottom).toBe(true)
    expect(scheduled).toHaveLength(1)

    scheduled[0]()

    expect(ctx.viewport.scrollTop).toBe(800)
    expect(ctx.controller.getTimingState().bottomLockUntil).toBeGreaterThan(1000)
  })

  test('keeps pin while guarded follow sees a small upward correction', () => {
    const ctx = createContext()

    ctx.controller.scrollToEnd(100)
    ctx.viewport.scrollTop = 782
    ctx.controller.handleScroll()

    expect(ctx.state.pinnedToBottom).toBe(true)
    expect(ctx.logs.some((entry) => entry.event === 'handleScrollUserScrolledUp')).toBe(false)
  })

  test('releases pin during guarded follow when the user scrolls up decisively', () => {
    const ctx = createContext()

    ctx.controller.scrollToEnd(100)
    ctx.viewport.scrollTop = 760
    ctx.controller.handleScroll()

    expect(ctx.state.pinnedToBottom).toBe(false)
    expect(ctx.controller.getTimingState()).toEqual({
      bottomLockUntil: 0,
      scrollGuardUntil: 0,
    })
  })

  test('repins and hides stale unpinned state when content no longer overflows', () => {
    const ctx = createContext()

    ctx.state.pinnedToBottom = false
    ctx.state.scrollTop = 420
    ctx.viewport.scrollTop = 420
    ctx.viewport.scrollHeight = 180
    ctx.viewport.clientHeight = 200

    ctx.controller.handleContentResize()

    expect(ctx.state.pinnedToBottom).toBe(true)
    expect(ctx.state.scrollTop).toBe(0)
    expect(ctx.viewport.scrollTop).toBe(0)
    expect(ctx.logs.some((entry) => entry.event === 'reconcileViewportPinned')).toBe(true)
  })
})
