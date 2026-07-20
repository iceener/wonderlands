import { describe, expect, test } from 'vitest'
import { withRafBatching } from './with-raf-batching'

const requireScheduledFlush = (flush: (() => void) | null): (() => void) => {
  if (flush == null) {
    throw new Error('Expected a scheduled flush callback.')
  }

  return flush
}

describe('withRafBatching', () => {
  test('coalesces multiple pushes into a single scheduled batch', () => {
    const batches: number[][] = []
    let scheduledFlush: (() => void) | null = null
    let scheduleCalls = 0

    const batcher = withRafBatching<number>(
      (batch) => {
        batches.push(batch)
      },
      {
        schedule(flush) {
          scheduleCalls += 1
          scheduledFlush = flush
        },
      },
    )

    batcher.push(1)
    batcher.push(2)
    batcher.push(3)

    expect(scheduleCalls).toBe(1)
    expect(batches).toEqual([])

    requireScheduledFlush(scheduledFlush)()

    expect(batches).toEqual([[1, 2, 3]])
  })

  test('flushes remaining items synchronously at stream end', () => {
    const batches: string[][] = []

    const batcher = withRafBatching<string>(
      (batch) => {
        batches.push(batch)
      },
      {
        schedule() {
          // Intentionally do not auto-run the scheduled flush in this test.
        },
      },
    )

    batcher.push('a')
    batcher.push('b')
    batcher.flush()

    expect(batches).toEqual([['a', 'b']])
  })

  test('schedules a new batch after a prior flush completes', () => {
    const batches: number[][] = []
    const scheduledFlushes: Array<() => void> = []

    const batcher = withRafBatching<number>(
      (batch) => {
        batches.push(batch)
      },
      {
        schedule(flush) {
          scheduledFlushes.push(flush)
        },
      },
    )

    batcher.push(1)
    expect(scheduledFlushes).toHaveLength(1)

    scheduledFlushes[0]?.()
    expect(batches).toEqual([[1]])

    batcher.push(2)
    expect(scheduledFlushes).toHaveLength(2)

    scheduledFlushes[1]?.()
    expect(batches).toEqual([[1], [2]])
  })

  test('falls back to a timer when requestAnimationFrame does not flush promptly', async () => {
    const batches: string[][] = []
    const originalRaf = globalThis.requestAnimationFrame

    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame

    try {
      const batcher = withRafBatching<string>((batch) => {
        batches.push(batch)
      })

      batcher.push('background')
      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(batches).toEqual([['background']])
    } finally {
      globalThis.requestAnimationFrame = originalRaf
    }
  })
})
