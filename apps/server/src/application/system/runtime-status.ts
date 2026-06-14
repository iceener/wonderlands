import type { BackendSystemRuntimeStatus } from '@wonderlands/contracts/chat'
import type { KernelRuntimeService } from '../kernel/kernel-runtime-service'
import type { SandboxExecutionService } from '../sandbox/sandbox-execution-service'

export const buildRuntimeStatus = (input: {
  kernel: Pick<KernelRuntimeService, 'getAvailability'>
  sandbox: Pick<SandboxExecutionService, 'provider' | 'supportedRuntimes'>
}): BackendSystemRuntimeStatus => {
  const kernel = input.kernel.getAvailability()
  const supportedRuntimes = [...input.sandbox.supportedRuntimes]

  return {
    kernel: {
      available: kernel.available,
      checkedAt: kernel.checkedAt,
      detail: kernel.detail,
      enabled: kernel.enabled,
      provider: kernel.provider,
      status: kernel.status,
    },
    sandbox: {
      available: supportedRuntimes.length > 0,
      detail:
        supportedRuntimes.length > 0
          ? `Sandbox provider ${input.sandbox.provider} supports ${supportedRuntimes.join(', ')}.`
          : `Sandbox provider ${input.sandbox.provider} is configured, but no sandbox runtimes are currently available.`,
      provider: input.sandbox.provider,
      supportedRuntimes,
    },
  }
}
