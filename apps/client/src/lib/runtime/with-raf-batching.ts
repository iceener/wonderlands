export interface RafBatchController<T> {
  flush: () => void
  push: (item: T) => void
}

interface RafBatchingOptions {
  schedule?: (flush: () => void) => void
}

const defaultSchedule = (flush: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    let didFlush = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const runFlush = () => {
      if (didFlush) {
        return
      }

      didFlush = true
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      flush()
    }

    requestAnimationFrame(() => runFlush())
    timeoutId = setTimeout(runFlush, 100)
    return
  }

  setTimeout(flush, 0)
}

export const withRafBatching = <T>(
  onBatch: (batch: T[]) => void,
  options: RafBatchingOptions = {},
): RafBatchController<T> => {
  const schedule = options.schedule ?? defaultSchedule
  let pending: T[] = []
  let scheduled = false

  const flush = () => {
    scheduled = false

    if (pending.length === 0) {
      return
    }

    const batch = pending
    pending = []
    onBatch(batch)
  }

  return {
    flush,
    push(item: T) {
      pending.push(item)

      if (scheduled) {
        return
      }

      scheduled = true
      schedule(flush)
    },
  }
}
