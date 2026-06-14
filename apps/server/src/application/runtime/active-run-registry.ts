import type { AiProviderName } from '../../domain/ai/types'
import type { RunId } from '../../shared/ids'

export type ActiveRunPhase =
  | 'context.loading'
  | 'generation.streaming'
  | 'run.starting'
  | 'run.turn_boundary'
  | 'tools.executing'

export interface ActiveRunSnapshot {
  phase: ActiveRunPhase
  provider: AiProviderName | null
  responseId: string | null
  rootRunId: RunId
  runId: RunId
}

export interface ActiveRunHandle {
  unregister: () => void
  update: (input: Partial<Pick<ActiveRunSnapshot, 'phase' | 'provider' | 'responseId'>>) => void
}

export interface ActiveRunRegistry {
  abort: (runId: RunId, reason: string) => boolean
  get: (runId: RunId) => ActiveRunSnapshot | null
  register: (
    input: ActiveRunSnapshot & {
      abortController: AbortController
    },
  ) => ActiveRunHandle
}

interface ActiveRunEntry extends ActiveRunSnapshot {
  abortController: AbortController
}

export const createActiveRunRegistry = (): ActiveRunRegistry => {
  const activeRuns = new Map<RunId, ActiveRunEntry>()

  return {
    abort: (runId, reason) => {
      const activeRun = activeRuns.get(runId)

      if (!activeRun) {
        return false
      }

      if (!activeRun.abortController.signal.aborted) {
        activeRun.abortController.abort(reason)
      }

      return true
    },
    get: (runId) => {
      const activeRun = activeRuns.get(runId)

      if (!activeRun) {
        return null
      }

      return {
        phase: activeRun.phase,
        provider: activeRun.provider,
        responseId: activeRun.responseId,
        rootRunId: activeRun.rootRunId,
        runId: activeRun.runId,
      }
    },
    register: (input) => {
      const activeRun: ActiveRunEntry = {
        abortController: input.abortController,
        phase: input.phase,
        provider: input.provider,
        responseId: input.responseId,
        rootRunId: input.rootRunId,
        runId: input.runId,
      }
      activeRuns.set(input.runId, activeRun)

      return {
        unregister: () => {
          if (activeRuns.get(input.runId) === activeRun) {
            activeRuns.delete(input.runId)
          }
        },
        update: (update) => {
          if (activeRuns.get(input.runId) !== activeRun) {
            return
          }

          if (update.phase !== undefined) {
            activeRun.phase = update.phase
          }

          if (update.provider !== undefined) {
            activeRun.provider = update.provider
          }

          if (update.responseId !== undefined) {
            activeRun.responseId = update.responseId
          }
        },
      }
    },
  }
}
