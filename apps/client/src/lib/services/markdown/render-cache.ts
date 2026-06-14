export interface RenderCache {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void
}

export const createRenderCache = (maxEntries: number): RenderCache => {
  const entries = new Map<string, string>()

  return {
    get(key) {
      return entries.get(key)
    },
    set(key, value) {
      entries.set(key, value)

      if (entries.size <= maxEntries) {
        return
      }

      const oldestKey = entries.keys().next().value
      if (oldestKey !== undefined) {
        entries.delete(oldestKey)
      }
    },
  }
}
