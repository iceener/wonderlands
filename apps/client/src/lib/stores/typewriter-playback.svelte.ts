export interface TypewriterPlaybackStore {
  readonly hasPending: boolean
  readonly pendingKeys: string[]
  readonly streamedKeys: string[]
  clear: (messageKey: string) => void
  clearAll: () => void
  hasPendingKey: (messageKey: string) => boolean
  markStreamed: (messageKey: string) => void
  hasStreamed: (messageKey: string) => boolean
  setPending: (messageKey: string, pending: boolean) => void
}

export const createTypewriterPlaybackStore = (): TypewriterPlaybackStore => {
  let pendingKeys = $state<string[]>([])
  let streamedKeys = $state<string[]>([])

  const normalizeKey = (messageKey: string): string => messageKey.trim()

  const withoutKey = (messageKey: string): string[] =>
    pendingKeys.filter((existingKey) => existingKey !== messageKey)

  return {
    get hasPending() {
      return pendingKeys.length > 0
    },

    get pendingKeys() {
      return pendingKeys
    },

    get streamedKeys() {
      return streamedKeys
    },

    clear(messageKey) {
      const normalizedKey = normalizeKey(messageKey)
      if (!normalizedKey || !pendingKeys.includes(normalizedKey)) {
        return
      }

      pendingKeys = withoutKey(normalizedKey)
    },

    clearAll() {
      pendingKeys = []
      streamedKeys = []
    },

    hasPendingKey(messageKey) {
      const normalizedKey = normalizeKey(messageKey)
      return normalizedKey.length > 0 && pendingKeys.includes(normalizedKey)
    },

    hasStreamed(messageKey) {
      const normalizedKey = normalizeKey(messageKey)
      return normalizedKey.length > 0 && streamedKeys.includes(normalizedKey)
    },

    markStreamed(messageKey) {
      const normalizedKey = normalizeKey(messageKey)
      if (!normalizedKey || streamedKeys.includes(normalizedKey)) {
        return
      }

      streamedKeys = [...streamedKeys, normalizedKey]
    },

    setPending(messageKey, pending) {
      const normalizedKey = normalizeKey(messageKey)
      if (!normalizedKey) {
        return
      }

      if (!pending) {
        if (!pendingKeys.includes(normalizedKey)) {
          return
        }

        pendingKeys = withoutKey(normalizedKey)
        return
      }

      if (pendingKeys.includes(normalizedKey)) {
        return
      }

      pendingKeys = [...pendingKeys, normalizedKey]
    },
  }
}

export const typewriterPlayback = createTypewriterPlaybackStore()
