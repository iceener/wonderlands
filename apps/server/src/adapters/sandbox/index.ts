import type { SandboxRunner } from '../../domain/sandbox/sandbox-runner'
import type { SandboxProvider } from '../../domain/sandbox/types'
import type { AppLogger } from '../../shared/logger'
import { createDenoSandboxRunner } from './deno/deno-sandbox-runner'
import { createLocalDevSandboxRunner } from './local-dev/local-dev-sandbox-runner'

export interface CreateSandboxRunnerInput {
  logger: AppLogger
  lo: {
    binaryPath: string | null
    bootstrapEntry: string | null
  }
  provider: SandboxProvider
}

export const createSandboxRunner = (input: CreateSandboxRunnerInput): SandboxRunner => {
  switch (input.provider) {
    case 'deno':
      return createDenoSandboxRunner({
        logger: input.logger,
      })
    case 'local_dev':
      return createLocalDevSandboxRunner({
        logger: input.logger,
        lo: input.lo,
      })
  }
}
