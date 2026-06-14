export const createPollingWorker = <TProcessResult>(input: {
  computeNextDelay: (input: {
    error: unknown | null
    result: TProcessResult | null
    wakeRequested: boolean
  }) => number
  onError?: (error: unknown) => void
  runOnce: () => Promise<TProcessResult>
  supportsWake?: boolean
}) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let started = false
  let stopRequested = false
  let wakeRequested = false

  const schedule = (delayMs: number) => {
    if (stopRequested) {
      return
    }

    timer = setTimeout(() => {
      timer = null
      inFlight = (async () => {
        let result: TProcessResult | null = null
        let error: unknown | null = null

        try {
          result = await input.runOnce()
        } catch (caught) {
          error = caught
          input.onError?.(caught)
        } finally {
          const nextDelay = input.computeNextDelay({
            error,
            result,
            wakeRequested,
          })
          wakeRequested = false
          schedule(nextDelay)
        }
      })().finally(() => {
        inFlight = null
      })
    }, delayMs)
  }

  const start = () => {
    if (started) {
      return
    }

    started = true
    stopRequested = false
    schedule(0)
  }

  const stop = async () => {
    stopRequested = true
    started = false

    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    await inFlight
  }

  const wake = () => {
    if (!input.supportsWake || !started || stopRequested) {
      return
    }

    wakeRequested = true

    if (timer) {
      clearTimeout(timer)
      timer = null
      schedule(0)
    }
  }

  return {
    start,
    stop,
    wake,
  }
}
