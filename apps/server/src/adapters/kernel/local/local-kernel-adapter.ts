import type { KernelAdapter } from '../../../domain/kernel/kernel-adapter'
import type {
  KernelPlaywrightExecution,
  KernelPlaywrightExecutionResult,
  KernelRecordingDownloadResult,
  KernelRecordingStartRequest,
} from '../../../domain/kernel/types'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { type KernelFetch, probeLocalKernelHealth } from '../health'

export interface CreateLocalKernelAdapterInput {
  apiUrl: string
  cdpUrl: string
  fetchImpl?: KernelFetch
}

const toProviderError = (message: string, statusCode?: number): Result<never, DomainError> =>
  err({
    message,
    provider: 'kernel_local',
    retryable: statusCode === undefined || statusCode >= 500,
    statusCode,
    type: 'provider',
  })

const parseJsonResponse = async <TValue>(
  response: Response,
  fallbackMessage: string,
): Promise<Result<TValue, DomainError>> => {
  let body: unknown = null

  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'message' in body &&
      typeof body.message === 'string' &&
      body.message.trim().length > 0
        ? body.message
        : `${fallbackMessage} (HTTP ${response.status})`

    return toProviderError(message, response.status)
  }

  return ok(body as TValue)
}

const toPlaywrightResult = (
  body: unknown,
): Result<KernelPlaywrightExecutionResult, DomainError> => {
  if (!body || typeof body !== 'object') {
    return toProviderError('Kernel returned an invalid Playwright execution payload')
  }

  if (!('success' in body) || typeof body.success !== 'boolean') {
    return toProviderError('Kernel Playwright execution payload omitted the success field')
  }

  if (!body.success) {
    const message =
      'error' in body && typeof body.error === 'string' && body.error.trim().length > 0
        ? body.error
        : 'Kernel Playwright execution failed'

    return toProviderError(message)
  }

  return ok({
    result: 'result' in body ? body.result : null,
  })
}

export const createLocalKernelAdapter = (input: CreateLocalKernelAdapterInput): KernelAdapter => {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch

  return {
    close: async () => {},
    describeEndpoint: () => input.apiUrl,
    downloadRecording: async (
      recordingId,
    ): Promise<Result<KernelRecordingDownloadResult, DomainError>> => {
      const endpoint = new URL('/recording/download', input.apiUrl)
      endpoint.searchParams.set('id', recordingId)

      try {
        const response = await fetchImpl(endpoint, {
          headers: {
            Accept: 'video/mp4',
          },
        })

        if (!response.ok) {
          let message = `Kernel recording download failed (HTTP ${response.status})`

          try {
            const body = (await response.json()) as { message?: unknown }

            if (typeof body.message === 'string' && body.message.trim().length > 0) {
              message = body.message
            }
          } catch {
            // ignore malformed provider payloads
          }

          return toProviderError(message, response.status)
        }

        const arrayBuffer = await response.arrayBuffer()

        return ok({
          body: new Uint8Array(arrayBuffer),
          contentType: response.headers.get('content-type')?.trim() || 'video/mp4',
        })
      } catch (error) {
        return toProviderError(
          error instanceof Error
            ? error.message
            : 'Unknown local Kernel recording download failure',
        )
      }
    },
    executePlaywright: async (
      request: KernelPlaywrightExecution,
    ): Promise<Result<KernelPlaywrightExecutionResult, DomainError>> => {
      try {
        const response = await fetchImpl(new URL('/playwright/execute', input.apiUrl), {
          body: JSON.stringify({
            code: request.code,
            ...(request.timeoutSec ? { timeout_sec: request.timeoutSec } : {}),
          }),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })
        const parsed = await parseJsonResponse<Record<string, unknown>>(
          response,
          'Kernel Playwright execution failed',
        )

        return parsed.ok ? toPlaywrightResult(parsed.value) : parsed
      } catch (error) {
        return toProviderError(
          error instanceof Error ? error.message : 'Unknown local Kernel execution failure',
        )
      }
    },
    healthCheck: () =>
      probeLocalKernelHealth({
        apiUrl: input.apiUrl,
        cdpUrl: input.cdpUrl,
        fetchImpl,
      }),
    provider: 'local',
    startRecording: async (
      request: KernelRecordingStartRequest,
    ): Promise<Result<null, DomainError>> => {
      try {
        const response = await fetchImpl(new URL('/recording/start', input.apiUrl), {
          body: JSON.stringify({
            id: request.id,
            ...(request.maxDurationSec ? { maxDurationInSeconds: request.maxDurationSec } : {}),
          }),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })
        const parsed = await parseJsonResponse(response, 'Kernel recording start failed')

        return parsed.ok ? ok(null) : parsed
      } catch (error) {
        return toProviderError(
          error instanceof Error ? error.message : 'Unknown local Kernel recording start failure',
        )
      }
    },
    stopRecording: async (recordingId: string): Promise<Result<null, DomainError>> => {
      try {
        const response = await fetchImpl(new URL('/recording/stop', input.apiUrl), {
          body: JSON.stringify({
            id: recordingId,
          }),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })
        const parsed = await parseJsonResponse(response, 'Kernel recording stop failed')

        return parsed.ok ? ok(null) : parsed
      } catch (error) {
        return toProviderError(
          error instanceof Error ? error.message : 'Unknown local Kernel recording stop failure',
        )
      }
    },
    supportsBrowserJobs: true,
  }
}
