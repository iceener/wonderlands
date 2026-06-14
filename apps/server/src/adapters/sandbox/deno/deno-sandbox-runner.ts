import type { SandboxRunner } from '../../../domain/sandbox/sandbox-runner'
import type { AppLogger } from '../../../shared/logger'
import { err } from '../../../shared/result'

export const createDenoSandboxRunner = (input: { logger: AppLogger }): SandboxRunner => ({
  provider: 'deno',
  supportedRuntimes: [],
  runExecution: async (execution) => {
    input.logger.warn('Deno sandbox runner is selected but not implemented', {
      executionId: execution.executionId,
      subsystem: 'sandbox_runner',
    })

    return err({
      message: 'managed deno sandbox runner is not implemented yet',
      type: 'conflict',
    })
  },
})
