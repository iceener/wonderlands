const IS_DEV = import.meta.env.DEV

type SnapshotFn = () => unknown

type ChatDebugWindow = Window & {
  __chatDebugOn?: () => void
  __chatDebugOff?: () => void
  __chatDebugSnapshot?: (name?: string) => void
}

const snapshotters = new Map<string, SnapshotFn>()
let chatDebugEnabled = false
let globalsInstalled = false

const installGlobals = () => {
  if (!IS_DEV || globalsInstalled || typeof window === 'undefined') {
    return
  }

  globalsInstalled = true
  const globalWindow = window as ChatDebugWindow

  globalWindow.__chatDebugOn = () => {
    chatDebugEnabled = true
    console.log('[chat-debug] on')
  }

  globalWindow.__chatDebugOff = () => {
    chatDebugEnabled = false
    console.log('[chat-debug] off')
  }

  globalWindow.__chatDebugSnapshot = (name?: string) => {
    if (name) {
      const snapshot = snapshotters.get(name)
      console.log(`[chat-debug] snapshot:${name}`, snapshot ? snapshot() : null)
      return
    }

    console.log(
      '[chat-debug] snapshot',
      Object.fromEntries(
        Array.from(snapshotters.entries()).map(([key, snapshot]) => [key, snapshot()]),
      ),
    )
  }

  console.log(
    '%c[chat-debug] available%c  call %c__chatDebugOn()%c to log store/render truth, %c__chatDebugSnapshot()%c for current state',
    'color:#f59e0b;font-weight:600',
    'color:inherit',
    'color:#b4a9f8;font-family:monospace',
    'color:inherit',
    'color:#b4a9f8;font-family:monospace',
    'color:inherit',
  )
}

export const registerChatDebugSnapshot = (name: string, snapshot: SnapshotFn): (() => void) => {
  if (!IS_DEV) {
    return () => undefined
  }

  installGlobals()
  snapshotters.set(name, snapshot)

  return () => {
    snapshotters.delete(name)
  }
}

export const logChatDebug = (scope: string, event: string, payload: unknown) => {
  if (!IS_DEV) {
    return
  }

  installGlobals()

  if (!chatDebugEnabled) {
    return
  }

  console.log(`[chat-debug:${scope}] ${event}`, payload)
}

export const isChatDebugEnabled = (): boolean => {
  if (!IS_DEV) {
    return false
  }

  installGlobals()
  return chatDebugEnabled
}
