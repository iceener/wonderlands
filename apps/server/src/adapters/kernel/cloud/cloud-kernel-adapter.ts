import type { KernelAdapter } from '../../../domain/kernel/kernel-adapter'
import type {
  KernelPlaywrightExecution,
  KernelPlaywrightExecutionResult,
  KernelRecordingDownloadResult,
  KernelRecordingStartRequest,
} from '../../../domain/kernel/types'
import type { DomainError } from '../../../shared/errors'
import { err, type Result } from '../../../shared/result'
import { type KernelFetch, probeCloudKernelHealth } from '../health'

export interface CreateCloudKernelAdapterInput {
  apiKey: string
  apiUrl: string
  fetchImpl?: KernelFetch
}

const unsupported = <TValue>(): Result<TValue, DomainError> =>
  err({
    message:
      'Kernel cloud Playwright execution is not wired yet. Use the local provider for browser jobs.',
    provider: 'kernel_cloud',
    retryable: false,
    type: 'provider',
  })

export const createCloudKernelAdapter = (input: CreateCloudKernelAdapterInput): KernelAdapter => ({
  close: async () => {},
  describeEndpoint: () => input.apiUrl,
  downloadRecording: async (
    _recordingId,
  ): Promise<Result<KernelRecordingDownloadResult, DomainError>> => unsupported(),
  executePlaywright: async (
    _request: KernelPlaywrightExecution,
  ): Promise<Result<KernelPlaywrightExecutionResult, DomainError>> => unsupported(),
  healthCheck: () =>
    probeCloudKernelHealth({
      apiKey: input.apiKey,
      apiUrl: input.apiUrl,
      fetchImpl: input.fetchImpl,
    }),
  provider: 'cloud',
  startRecording: async (
    _request: KernelRecordingStartRequest,
  ): Promise<Result<null, DomainError>> => unsupported(),
  stopRecording: async (_recordingId: string): Promise<Result<null, DomainError>> => unsupported(),
  supportsBrowserJobs: false,
})
