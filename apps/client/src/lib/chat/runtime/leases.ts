import type { RunId, ThreadId } from '@wonderlands/contracts/chat'

export interface ViewLease {
  epoch: number
}

export interface RunLease {
  runEpoch: number
  runId: RunId | null
  viewEpoch: number
}

export interface SubmitLease {
  submitId: number
  viewEpoch: number
}

interface ChatLeaseStateDependencies {
  getLastTerminalRunId: () => RunId | null
  getRunId: () => RunId | null
  getThreadId: () => ThreadId | null
}

export const createChatLeaseState = ({
  getLastTerminalRunId,
  getRunId,
  getThreadId,
}: ChatLeaseStateDependencies) => {
  let viewEpoch = 0
  let runEpoch = 0
  let nextSubmitId = 0
  let activeSubmitId: number | null = null

  const captureViewLease = (): ViewLease => ({
    epoch: viewEpoch,
  })

  const beginViewLease = (): ViewLease => {
    viewEpoch += 1
    activeSubmitId = null
    return captureViewLease()
  }

  const isViewLeaseCurrent = (lease: ViewLease): boolean => lease.epoch === viewEpoch

  const isThreadLeaseCurrent = (lease: ViewLease, threadId: ThreadId | null): boolean =>
    isViewLeaseCurrent(lease) && getThreadId() === threadId

  const beginSubmitLease = (): SubmitLease => {
    const submitId = nextSubmitId + 1
    nextSubmitId = submitId
    activeSubmitId = submitId
    return {
      submitId,
      viewEpoch,
    }
  }

  const isSubmitLeaseCurrent = (lease: SubmitLease): boolean =>
    lease.viewEpoch === viewEpoch && activeSubmitId === lease.submitId

  const releaseSubmitLease = (lease: SubmitLease) => {
    if (activeSubmitId === lease.submitId) {
      activeSubmitId = null
    }
  }

  const captureRunLease = (runId: RunId | null = getRunId()): RunLease => ({
    runEpoch,
    runId,
    viewEpoch,
  })

  const isRunLeaseCurrent = (lease: RunLease): boolean => {
    const currentRunId = getRunId()
    const lastTerminalRunId = getLastTerminalRunId()

    return (
      lease.viewEpoch === viewEpoch &&
      lease.runEpoch === runEpoch &&
      (lease.runId === currentRunId ||
        (lease.runId != null && currentRunId == null && lastTerminalRunId === lease.runId))
    )
  }

  return {
    beginSubmitLease,
    beginViewLease,
    bumpRunEpoch() {
      runEpoch += 1
    },
    captureRunLease,
    captureViewLease,
    clearActiveSubmit() {
      activeSubmitId = null
    },
    get activeSubmitId(): number | null {
      return activeSubmitId
    },
    get runEpoch(): number {
      return runEpoch
    },
    get viewEpoch(): number {
      return viewEpoch
    },
    isRunLeaseCurrent,
    isSubmitLeaseCurrent,
    isThreadLeaseCurrent,
    isViewLeaseCurrent,
    releaseSubmitLease,
  }
}
