import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type {
  KernelHealthCheckResult,
  KernelPlaywrightExecution,
  KernelPlaywrightExecutionResult,
  KernelProvider,
  KernelRecordingDownloadResult,
  KernelRecordingStartRequest,
} from './types'

export interface KernelAdapter {
  close: () => Promise<void>
  describeEndpoint: () => string
  downloadRecording: (
    recordingId: string,
  ) => Promise<Result<KernelRecordingDownloadResult, DomainError>>
  executePlaywright: (
    input: KernelPlaywrightExecution,
  ) => Promise<Result<KernelPlaywrightExecutionResult, DomainError>>
  healthCheck: () => Promise<Result<KernelHealthCheckResult, DomainError>>
  provider: KernelProvider
  startRecording: (input: KernelRecordingStartRequest) => Promise<Result<null, DomainError>>
  stopRecording: (recordingId: string) => Promise<Result<null, DomainError>>
  supportsBrowserJobs: boolean
}
