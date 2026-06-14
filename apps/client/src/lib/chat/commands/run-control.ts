import type { BackendRun, RunId, ThreadId } from '@wonderlands/contracts/chat'

interface RunControlCommandsDependencies<Lease, RunLease> {
  abortActiveStream: () => void
  bumpStreamPulse: () => void
  cancelRun: (runId: RunId) => Promise<unknown>
  captureRunLease: (runId: RunId) => RunLease
  captureViewLease: () => Lease
  finalizeRun: (
    status: BackendRun['status'],
    finishReason: 'cancelled',
    input: { runId: RunId },
  ) => void
  getRunId: () => RunId | null
  getRunStatus: () => BackendRun['status'] | null
  getThreadId: () => ThreadId | null
  isTerminalRunStatus: (status: BackendRun['status']) => boolean
  isThreadLeaseCurrent: (lease: Lease, threadId: ThreadId | null) => boolean
  isViewLeaseCurrent: (lease: Lease) => boolean
  reconcileRunState: (runId: RunId, lease: Lease, runLease: RunLease) => Promise<unknown>
  refreshThreadMessages: (threadId: ThreadId, lease: Lease) => Promise<void>
  setError: (message: string | null) => void
  setIsCancelling: (value: boolean) => void
  toDisplayError: (error: unknown, fallback: string) => string
}

export const createRunControlCommands = <Lease, RunLease>(
  dependencies: RunControlCommandsDependencies<Lease, RunLease>,
) => {
  const cancelActiveRun = async () => {
    const runId = dependencies.getRunId()

    if (!runId) {
      return
    }

    const cancellableStatuses: Array<BackendRun['status'] | null> = [
      'pending',
      'running',
      'waiting',
    ]
    if (!cancellableStatuses.includes(dependencies.getRunStatus())) {
      return
    }

    dependencies.setError(null)
    dependencies.setIsCancelling(true)

    const threadId = dependencies.getThreadId()
    const viewLease = dependencies.captureViewLease()
    const runLease = dependencies.captureRunLease(runId)

    try {
      await dependencies.cancelRun(runId)
      if (!dependencies.isViewLeaseCurrent(viewLease)) {
        return
      }

      if (threadId) {
        await dependencies.refreshThreadMessages(threadId, viewLease).catch((error) => {
          if (dependencies.isThreadLeaseCurrent(viewLease, threadId)) {
            dependencies.setError(
              dependencies.toDisplayError(error, 'Failed to refresh thread messages.'),
            )
          }
        })
      }
      if (!dependencies.isViewLeaseCurrent(viewLease)) {
        return
      }

      try {
        await dependencies.reconcileRunState(runId, viewLease, runLease)
      } catch {
        // GET /runs/:id may fail transiently; fall through to local finalize.
      }

      if (!dependencies.isViewLeaseCurrent(viewLease)) {
        return
      }

      const currentRunStatus = dependencies.getRunStatus()
      if (currentRunStatus && !dependencies.isTerminalRunStatus(currentRunStatus)) {
        dependencies.finalizeRun('cancelled', 'cancelled', { runId })
      }

      dependencies.abortActiveStream()
    } catch (error) {
      if (!dependencies.isViewLeaseCurrent(viewLease)) {
        return
      }

      try {
        const activeRunId = dependencies.getRunId()
        if (activeRunId) {
          await dependencies.reconcileRunState(
            activeRunId,
            viewLease,
            dependencies.captureRunLease(activeRunId),
          )
          return
        }
      } catch {
        // Fall through to surface the original cancellation error.
      }

      dependencies.setError(
        dependencies.toDisplayError(error, 'Could not stop the current run. Try again.'),
      )
    } finally {
      if (dependencies.isViewLeaseCurrent(viewLease)) {
        dependencies.setIsCancelling(false)
        dependencies.bumpStreamPulse()
      }
    }
  }

  return {
    cancelActiveRun,
  }
}
