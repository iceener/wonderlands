import { getContext, setContext } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'

export type ActiveView =
  | { kind: 'chat' }
  | { kind: 'mcp-form'; serverId?: string }
  | { kind: 'agent-form'; agentId?: string }
  | { kind: 'agent-task-form'; taskId?: string; agentId?: string }
  | { kind: 'garden-archive' }
  | { kind: 'garden-form'; gardenSiteId?: string }
  | { kind: 'tool-profile-form'; toolProfileId?: string }
  | { kind: 'keyboard-shortcuts' }

interface ConfirmOptions {
  cancelLabel?: string
  confirmLabel?: string
  title: string
}

const VIEW_STORE_CONTEXT = Symbol('view-store')
const MAX_DEPTH = 4

const VIEW_LABELS: Record<ActiveView['kind'], string> = {
  chat: 'Chat',
  'agent-form': 'Agent',
  'agent-task-form': 'Scheduled Task',
  'garden-archive': 'Archive',
  'garden-form': 'Garden',
  'keyboard-shortcuts': 'Shortcuts',
  'mcp-form': 'MCP Server',
  'tool-profile-form': 'Tool Profile',
}

const labelForView = (view: ActiveView): string => `Back to ${VIEW_LABELS[view.kind]}`

export const viewKey = (view: ActiveView): string => {
  switch (view.kind) {
    case 'chat':
      return 'chat'
    case 'agent-form':
      return `agent-form:${view.agentId ?? 'new'}`
    case 'agent-task-form':
      return `agent-task-form:${view.taskId ?? 'new'}`
    case 'garden-archive':
      return 'garden-archive'
    case 'garden-form':
      return `garden-form:${view.gardenSiteId ?? 'new'}`
    case 'keyboard-shortcuts':
      return 'keyboard-shortcuts'
    case 'mcp-form':
      return `mcp-form:${view.serverId ?? 'new'}`
    case 'tool-profile-form':
      return `tool-profile-form:${view.toolProfileId ?? 'new'}`
  }
}

export interface ViewNavigator {
  readonly activeView: ActiveView
  readonly mountedViews: ActiveView[]
  readonly canGoBack: boolean
  readonly backLabel: string | null
  readonly isDirty: boolean
  push: (next: ActiveView) => void
  pop: () => void
  requestPop: () => Promise<boolean>
  replace: (next: ActiveView) => void
  requestReplace: (next: ActiveView) => Promise<boolean>
  resetToChat: () => void
  registerDirtyGuard: (view: ActiveView, guard: () => boolean) => void
  clearDirtyGuard: (view: ActiveView) => void
}

export type ViewStore = ViewNavigator

export const createViewNavigator = (
  openConfirm: (options: ConfirmOptions) => Promise<boolean>,
): ViewNavigator => {
  let stack = $state<ActiveView[]>([])
  let activeView = $state<ActiveView>({ kind: 'chat' })
  const dirtyGuards = new SvelteMap<string, () => boolean>()

  const mountedViews = $derived([...stack, activeView])

  const backLabel = $derived.by(() => {
    const target = stack.at(-1)
    if (!target) {
      return activeView.kind === 'chat' ? null : 'Back to Chat'
    }

    return labelForView(target)
  })

  const activeGuard = $derived.by(() => {
    return dirtyGuards.get(viewKey(activeView)) ?? null
  })

  const confirmIfDirty = async (): Promise<boolean> => {
    if (!activeGuard?.()) {
      return true
    }

    return await openConfirm({
      cancelLabel: 'Keep editing',
      confirmLabel: 'Discard changes',
      title: 'You have unsaved changes',
    })
  }

  const doPop = () => {
    dirtyGuards.delete(viewKey(activeView))

    const previousView = stack.at(-1)
    if (previousView) {
      stack = stack.slice(0, -1)
      activeView = previousView
      return
    }

    activeView = { kind: 'chat' }
  }

  const doReplace = (next: ActiveView) => {
    dirtyGuards.delete(viewKey(activeView))
    activeView = next
  }

  return {
    get activeView() {
      return activeView
    },
    get mountedViews() {
      return mountedViews
    },
    get canGoBack() {
      return stack.length > 0 || activeView.kind !== 'chat'
    },
    get backLabel() {
      return backLabel
    },
    get isDirty() {
      return activeGuard?.() ?? false
    },
    push(next) {
      if (viewKey(next) === viewKey(activeView)) {
        return
      }

      stack = [...stack, activeView]
      if (stack.length > MAX_DEPTH) {
        const evicted = stack[0]
        if (evicted) {
          dirtyGuards.delete(viewKey(evicted))
        }
        stack = stack.slice(1)
      }

      activeView = next
    },
    pop() {
      doPop()
    },
    async requestPop() {
      if (!(await confirmIfDirty())) {
        return false
      }

      doPop()
      return true
    },
    replace(next) {
      doReplace(next)
    },
    async requestReplace(next) {
      if (!(await confirmIfDirty())) {
        return false
      }

      doReplace(next)
      return true
    },
    resetToChat() {
      for (const view of [...stack, activeView]) {
        dirtyGuards.delete(viewKey(view))
      }
      stack = []
      activeView = { kind: 'chat' }
    },
    registerDirtyGuard(view, guard) {
      dirtyGuards.set(viewKey(view), guard)
    },
    clearDirtyGuard(view) {
      dirtyGuards.delete(viewKey(view))
    },
  }
}

export const createViewStore = createViewNavigator

export const setViewStoreContext = (store: ViewStore): ViewStore => {
  setContext(VIEW_STORE_CONTEXT, store)
  return store
}

export const getViewStoreContext = (): ViewStore => getContext<ViewStore>(VIEW_STORE_CONTEXT)
