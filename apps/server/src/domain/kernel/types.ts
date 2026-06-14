export const kernelProviderValues = ['local', 'cloud'] as const
export type KernelProvider = (typeof kernelProviderValues)[number]

export const kernelNetworkModeValues = ['off', 'allow_list', 'open'] as const
export type KernelNetworkMode = (typeof kernelNetworkModeValues)[number]

export const kernelAvailabilityStatusValues = [
  'disabled',
  'pending',
  'ready',
  'unavailable',
] as const
export type KernelAvailabilityStatus = (typeof kernelAvailabilityStatusValues)[number]

export const kernelSessionStatusValues = [
  'pending',
  'running',
  'completed',
  'failed',
  'timeout',
] as const
export type KernelSessionStatus = (typeof kernelSessionStatusValues)[number]

export const kernelArtifactKindValues = [
  'screenshot',
  'html',
  'recording',
  'pdf',
  'cookies',
] as const
export type KernelArtifactKind = (typeof kernelArtifactKindValues)[number]

export interface KernelHealthCheckResult {
  detail: string
  endpoint: string
}

export interface KernelPlaywrightExecution {
  code: string
  timeoutSec?: number
}

export interface KernelPlaywrightExecutionResult {
  result: unknown
}

export interface KernelRecordingStartRequest {
  id: string
  maxDurationSec?: number
}

export interface KernelRecordingDownloadResult {
  body: Uint8Array
  contentType: string
}

export interface KernelViewport {
  height: number
  width: number
}

export interface KernelPolicy {
  browser: {
    allowRecording: boolean
    defaultViewport: KernelViewport
    maxConcurrentSessions: number
    maxDurationSec: number
  }
  enabled: boolean
  network: {
    allowedHosts: string[]
    blockedHosts: string[]
    mode: KernelNetworkMode
  }
  outputs: {
    allowCookies: boolean
    allowHtml: boolean
    allowPdf: boolean
    allowRecording: boolean
    allowScreenshot: boolean
    maxOutputBytes: number
  }
}

export interface KernelRuntimeAvailability {
  available: boolean
  checkedAt: string | null
  detail: string
  enabled: boolean
  endpoint: string | null
  provider: KernelProvider
  status: KernelAvailabilityStatus
}
