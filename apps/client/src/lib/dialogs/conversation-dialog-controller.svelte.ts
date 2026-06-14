export type ConversationDialogRequest =
  | {
      currentTitle: string
      kind: 'rename'
    }
  | {
      currentTitle: string
      kind: 'delete'
    }

type ClosedDialogState = {
  kind: 'closed'
}

type RenameDialogState = ConversationDialogRequest & {
  kind: 'rename'
  resolve: (value: string | null) => void
}

type DeleteDialogState = ConversationDialogRequest & {
  kind: 'delete'
  resolve: (value: boolean) => void
}

type ConversationDialogState = ClosedDialogState | RenameDialogState | DeleteDialogState

export interface ConversationDialogController {
  readonly isOpen: boolean
  readonly currentRequest: ConversationDialogRequest | null
  openDelete: (input: { currentTitle: string }) => Promise<boolean>
  openRename: (input: { currentTitle: string }) => Promise<string | null>
  cancel: () => void
  confirmDelete: () => void
  submitRename: (title: string) => void
}

const createClosedState = (): ClosedDialogState => ({
  kind: 'closed',
})

const toVisibleRequest = (state: ConversationDialogState): ConversationDialogRequest | null => {
  if (state.kind === 'closed') {
    return null
  }

  return {
    currentTitle: state.currentTitle,
    kind: state.kind,
  }
}

export const createConversationDialogController = (): ConversationDialogController => {
  const state = $state<ConversationDialogState>(createClosedState())

  const cancelCurrent = (): void => {
    if (state.kind === 'rename') {
      const { resolve } = state
      resolve(null)
      Object.assign(state, createClosedState())
      return
    }

    if (state.kind === 'delete') {
      const { resolve } = state
      resolve(false)
      Object.assign(state, createClosedState())
    }
  }

  return {
    get isOpen() {
      return state.kind !== 'closed'
    },

    get currentRequest() {
      return toVisibleRequest(state)
    },

    openDelete(input) {
      cancelCurrent()

      return new Promise<boolean>((resolve) => {
        Object.assign(state, {
          currentTitle: input.currentTitle,
          kind: 'delete',
          resolve,
        } satisfies DeleteDialogState)
      })
    },

    openRename(input) {
      cancelCurrent()

      return new Promise<string | null>((resolve) => {
        Object.assign(state, {
          currentTitle: input.currentTitle,
          kind: 'rename',
          resolve,
        } satisfies RenameDialogState)
      })
    },

    cancel() {
      cancelCurrent()
    },

    confirmDelete() {
      if (state.kind !== 'delete') {
        return
      }

      const { resolve } = state
      resolve(true)
      Object.assign(state, createClosedState())
    },

    submitRename(title) {
      if (state.kind !== 'rename') {
        return
      }

      const { resolve } = state
      resolve(title)
      Object.assign(state, createClosedState())
    },
  }
}
