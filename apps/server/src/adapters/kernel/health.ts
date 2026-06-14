import type { KernelHealthCheckResult } from '../../domain/kernel/types'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

export type KernelFetch = typeof fetch

interface ProbeLocalKernelHealthInput {
  apiUrl: string
  cdpUrl: string
  fetchImpl?: KernelFetch
}

interface ProbeCloudKernelHealthInput {
  apiKey: string
  apiUrl: string
  fetchImpl?: KernelFetch
}

const toProviderError = (
  provider: string,
  message: string,
  statusCode?: number,
): Result<never, DomainError> =>
  err({
    message,
    provider,
    retryable: statusCode === undefined || statusCode >= 500,
    statusCode,
    type: 'provider',
  })

const fetchJson = async (
  input: string,
  init: RequestInit,
  fetchImpl: KernelFetch,
  provider: string,
): Promise<Result<{ body: unknown; response: Response }, DomainError>> => {
  try {
    const response = await fetchImpl(input, init)

    if (!response.ok) {
      return toProviderError(
        provider,
        `${provider} health check failed with HTTP ${response.status}`,
        response.status,
      )
    }

    let body: unknown = null

    try {
      body = await response.json()
    } catch {
      body = null
    }

    return ok({
      body,
      response,
    })
  } catch (error) {
    return toProviderError(
      provider,
      error instanceof Error ? error.message : `Unknown ${provider} health check failure`,
    )
  }
}

export const probeLocalKernelHealth = async (
  input: ProbeLocalKernelHealthInput,
): Promise<Result<KernelHealthCheckResult, DomainError>> => {
  const apiEndpoint = new URL('/recording/list', input.apiUrl).toString()
  const apiResponse = await fetchJson(
    apiEndpoint,
    {
      headers: {
        Accept: 'application/json',
      },
    },
    input.fetchImpl ?? globalThis.fetch,
    'kernel_local',
  )

  if (!apiResponse.ok) {
    return apiResponse
  }

  const cdpEndpoint = new URL('/json/version', input.cdpUrl).toString()
  const cdpResponse = await fetchJson(
    cdpEndpoint,
    {
      headers: {
        Accept: 'application/json',
      },
    },
    input.fetchImpl ?? globalThis.fetch,
    'kernel_local',
  )

  const webSocketDebuggerUrl =
    cdpResponse.ok &&
    cdpResponse.value.body &&
    typeof cdpResponse.value.body === 'object' &&
    'webSocketDebuggerUrl' in cdpResponse.value.body &&
    typeof cdpResponse.value.body.webSocketDebuggerUrl === 'string'
      ? cdpResponse.value.body.webSocketDebuggerUrl
      : null

  if (!cdpResponse.ok) {
    return ok({
      detail: `Kernel local API is reachable at ${apiEndpoint}. CDP probe at ${cdpEndpoint} failed with: ${cdpResponse.error.message}`,
      endpoint: apiEndpoint,
    })
  }

  if (!webSocketDebuggerUrl) {
    return ok({
      detail: `Kernel local API is reachable at ${apiEndpoint}. CDP proxy responded at ${cdpEndpoint} but did not include webSocketDebuggerUrl.`,
      endpoint: apiEndpoint,
    })
  }

  return ok({
    detail: `Kernel local API is reachable at ${apiEndpoint} and CDP is reachable at ${cdpEndpoint}`,
    endpoint: apiEndpoint,
  })
}

export const probeCloudKernelHealth = async (
  input: ProbeCloudKernelHealthInput,
): Promise<Result<KernelHealthCheckResult, DomainError>> => {
  const endpoint = new URL('/apps?limit=1', input.apiUrl).toString()
  const response = await fetchJson(
    endpoint,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
    },
    input.fetchImpl ?? globalThis.fetch,
    'kernel_cloud',
  )

  if (!response.ok) {
    return response
  }

  return ok({
    detail: `Kernel cloud API is reachable at ${endpoint}`,
    endpoint,
  })
}
