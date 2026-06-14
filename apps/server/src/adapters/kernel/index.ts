import type { AppConfig } from '../../app/config'
import type { KernelAdapter } from '../../domain/kernel/kernel-adapter'
import { createCloudKernelAdapter } from './cloud/cloud-kernel-adapter'
import type { KernelFetch } from './health'
import { createLocalKernelAdapter } from './local/local-kernel-adapter'

export interface CreateKernelAdapterInput {
  config: AppConfig['kernel']
  fetchImpl?: KernelFetch
}

export const createKernelAdapter = (input: CreateKernelAdapterInput): KernelAdapter => {
  switch (input.config.provider) {
    case 'cloud': {
      if (!input.config.cloud.apiKey) {
        throw new Error('Kernel cloud adapter requires KERNEL_API_KEY')
      }

      return createCloudKernelAdapter({
        apiKey: input.config.cloud.apiKey,
        apiUrl: input.config.cloud.apiUrl,
        fetchImpl: input.fetchImpl,
      })
    }
    case 'local':
      return createLocalKernelAdapter({
        apiUrl: input.config.local.apiUrl,
        cdpUrl: input.config.local.cdpUrl,
        fetchImpl: input.fetchImpl,
      })
  }
}
