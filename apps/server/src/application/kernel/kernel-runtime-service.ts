import { createKernelAdapter } from '../../adapters/kernel'
import type { AppConfig } from '../../app/config'
import type { KernelAdapter } from '../../domain/kernel/kernel-adapter'
import type { KernelRuntimeAvailability } from '../../domain/kernel/types'
import type { AppLogger } from '../../shared/logger'

export interface CreateKernelRuntimeServiceInput {
  config: AppConfig['kernel']
  fetchImpl?: typeof fetch
  logger: AppLogger
  now?: () => string
}

export interface KernelRuntimeService {
  close: () => Promise<void>
  getAdapter: () => KernelAdapter | null
  getAvailability: () => KernelRuntimeAvailability
  initialize: () => Promise<KernelRuntimeAvailability>
}

const buildAvailability = (
  config: AppConfig['kernel'],
  overrides?: Partial<KernelRuntimeAvailability>,
): KernelRuntimeAvailability => ({
  available: false,
  checkedAt: null,
  detail: config.enabled
    ? 'Kernel is enabled but has not been probed yet.'
    : 'Kernel is disabled (KERNEL_ENABLED is not true).',
  enabled: config.enabled,
  endpoint: config.provider === 'local' ? config.local.apiUrl : config.cloud.apiUrl,
  provider: config.provider,
  status: config.enabled ? 'pending' : 'disabled',
  ...overrides,
})

export const createKernelRuntimeService = (
  input: CreateKernelRuntimeServiceInput,
): KernelRuntimeService => {
  let adapter: KernelAdapter | null = null
  let availability = buildAvailability(input.config)
  let initialized = false

  return {
    close: async () => {
      if (!adapter) {
        return
      }

      await adapter.close()
      adapter = null
    },
    getAdapter: () => adapter,
    getAvailability: () => availability,
    initialize: async () => {
      if (initialized) {
        return availability
      }

      initialized = true
      const checkedAt = input.now?.() ?? new Date().toISOString()

      if (!input.config.enabled) {
        availability = buildAvailability(input.config, {
          checkedAt,
          status: 'disabled',
        })
        input.logger.info('kernel: disabled (KERNEL_ENABLED not set)', {
          provider: input.config.provider,
          subsystem: 'kernel',
        })
        return availability
      }

      const candidate = createKernelAdapter({
        config: input.config,
        fetchImpl: input.fetchImpl,
      })
      const health = await candidate.healthCheck()

      if (!health.ok) {
        await candidate.close()
        availability = buildAvailability(input.config, {
          checkedAt,
          detail: health.error.message,
          status: 'unavailable',
        })
        input.logger.warn('kernel: unavailable - browser tools disabled', {
          checkedAt,
          endpoint: candidate.describeEndpoint(),
          message: health.error.message,
          provider: candidate.provider,
          statusCode: health.error.type === 'provider' ? health.error.statusCode : undefined,
          subsystem: 'kernel',
        })
        return availability
      }

      adapter = candidate
      availability = buildAvailability(input.config, {
        available: true,
        checkedAt,
        detail: health.value.detail,
        endpoint: health.value.endpoint,
        status: 'ready',
      })
      input.logger.info('kernel: connected', {
        checkedAt,
        endpoint: health.value.endpoint,
        provider: candidate.provider,
        subsystem: 'kernel',
      })
      return availability
    },
  }
}
