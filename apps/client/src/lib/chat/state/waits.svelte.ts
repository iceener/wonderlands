import type { BackendPendingWait, RunId } from '@wonderlands/contracts/chat'

const clonePendingWait = (
  wait: BackendPendingWait,
  ownerRunId?: RunId | string | null,
): BackendPendingWait => ({
  ...wait,
  args: wait.args ? { ...wait.args } : null,
  ...(wait.ownerRunId
    ? { ownerRunId: wait.ownerRunId }
    : ownerRunId
      ? { ownerRunId: String(ownerRunId) }
      : {}),
})

const clonePendingWaits = (
  waits: BackendPendingWait[],
  ownerRunId?: RunId | string | null,
): BackendPendingWait[] => waits.map((wait) => clonePendingWait(wait, ownerRunId))

export const createWaitState = () => {
  let pending: BackendPendingWait[] = $state.raw([])
  let waitIds: string[] = $state.raw([])
  let resolvingIds: Set<string> = $state.raw(new Set<string>())

  return {
    clear() {
      pending = []
      waitIds = []
    },

    clearResolving() {
      resolvingIds = new Set()
    },

    clone(wait: BackendPendingWait, ownerRunId?: RunId | string | null): BackendPendingWait {
      return clonePendingWait(wait, ownerRunId)
    },

    cloneAll(
      waits: BackendPendingWait[],
      ownerRunId?: RunId | string | null,
    ): BackendPendingWait[] {
      return clonePendingWaits(waits, ownerRunId)
    },

    find(waitId: string): BackendPendingWait | null {
      return pending.find((wait) => wait.waitId === waitId) ?? null
    },

    finishResolving(waitId: string) {
      const next = new Set(resolvingIds)
      next.delete(waitId)
      resolvingIds = next
    },

    get pending(): BackendPendingWait[] {
      return pending
    },

    get resolvingIds(): Set<string> {
      return resolvingIds
    },

    get waitIds(): string[] {
      return waitIds
    },

    hasResolving(waitId: string): boolean {
      return resolvingIds.has(waitId)
    },

    mergeForRun(
      waits: BackendPendingWait[],
      ownerRunId?: RunId | string | null,
    ): BackendPendingWait[] {
      const ownerRunIdValue = ownerRunId ? String(ownerRunId) : null
      const merged = clonePendingWaits(waits, ownerRunId)

      for (const existingWait of pending) {
        if (!existingWait.ownerRunId || existingWait.ownerRunId === ownerRunIdValue) {
          continue
        }

        if (merged.some((wait) => wait.waitId === existingWait.waitId)) {
          continue
        }

        merged.push(clonePendingWait(existingWait))
      }

      return merged
    },

    removeByCallId(callId: string) {
      pending = pending.filter((wait) => String(wait.callId) !== callId)
      waitIds = pending.map((wait) => wait.waitId)
    },

    removeByWaitId(waitId: string) {
      pending = pending.filter((wait) => wait.waitId !== waitId)
      waitIds = pending.map((wait) => wait.waitId)
    },

    set(waits: BackendPendingWait[], ownerRunId?: RunId | string | null) {
      pending = clonePendingWaits(waits, ownerRunId)
      waitIds = pending.map((wait) => wait.waitId)
    },

    setWaitIds(nextWaitIds: string[]) {
      waitIds = [...nextWaitIds]
    },

    sizeResolving(): number {
      return resolvingIds.size
    },

    startResolving(waitId: string) {
      resolvingIds = new Set([...resolvingIds, waitId])
    },

    upsert(wait: BackendPendingWait) {
      const nextWait = clonePendingWait(wait)
      const nextWaits = clonePendingWaits(pending)
      const index = nextWaits.findIndex((entry) => entry.waitId === nextWait.waitId)

      if (index >= 0) {
        nextWaits[index] = nextWait
      } else {
        nextWaits.push(nextWait)
      }

      pending = nextWaits
      waitIds = pending.map((entry) => entry.waitId)
    },
  }
}
