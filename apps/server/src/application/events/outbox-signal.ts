type OutboxWakeListener = () => void

const listeners = new Set<OutboxWakeListener>()

export const registerOutboxWakeListener = (listener: OutboxWakeListener): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export const signalOutboxPending = (): void => {
  for (const listener of listeners) {
    listener()
  }
}
