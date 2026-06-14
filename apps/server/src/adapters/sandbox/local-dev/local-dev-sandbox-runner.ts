import type { SandboxRunner } from '../../../domain/sandbox/sandbox-runner'
import type { AppLogger } from '../../../shared/logger'
import { createLocalDevLoEngine } from '../engines/lo/local-dev-lo-engine'
import { createLocalDevNodeEngine } from '../engines/node/local-dev-node-engine'

export const createLocalDevSandboxRunner = (input: {
  logger: AppLogger
  lo?: {
    binaryPath: string | null
    bootstrapEntry: string | null
  }
}): SandboxRunner => {
  const nodeEngine = createLocalDevNodeEngine({
    logger: input.logger,
  })
  const loEngine = createLocalDevLoEngine({
    config: input.lo ?? {
      binaryPath: null,
      bootstrapEntry: null,
    },
    logger: input.logger,
  })

  return {
    provider: 'local_dev',
    supportedRuntimes: ['node', ...(loEngine.available ? (['lo'] as const) : [])],
    runExecution: async (execution) => {
      switch (execution.runtime) {
        case 'lo':
          return await loEngine.runExecution(execution)
        case 'node':
          return await nodeEngine.runExecution(execution)
      }
    },
  }
}
