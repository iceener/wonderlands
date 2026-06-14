interface ErrorPayload {
  error?: unknown
}

interface HumanizeErrorMessageOptions {
  status?: number
}

const asErrorPayload = (value: unknown): ErrorPayload | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  return value as ErrorPayload
}

export const extractErrorMessage = (body: string, fallback: string): string => {
  const trimmed = body.trim()
  if (!trimmed) {
    return fallback
  }

  try {
    const payload = asErrorPayload(JSON.parse(trimmed))
    if (payload) {
      if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
        return payload.error
      }

      if (
        payload.error &&
        typeof payload.error === 'object' &&
        'message' in payload.error &&
        typeof payload.error.message === 'string' &&
        payload.error.message.trim().length > 0
      ) {
        return payload.error.message
      }
    }
  } catch {}

  return trimmed
}

const isBlank = (value: string): boolean => value.trim().length === 0

export const humanizeErrorMessage = (
  message: string,
  options: HumanizeErrorMessageOptions = {},
): string => {
  const normalized = message.trim()

  if (isBlank(normalized)) {
    return 'Something went wrong. Try again.'
  }

  if (/request must not mix api key auth with another authentication method/iu.test(normalized)) {
    return 'Your browser session is out of sync. Refresh the page and try again.'
  }

  if (
    /failed to read browser auth session/iu.test(normalized) ||
    /failed to initialize browser auth session/iu.test(normalized)
  ) {
    if (options.status && options.status >= 500) {
      return 'The server is not available right now. Refresh the page and try again.'
    }

    return 'Could not sign in right now. Refresh the page and try again.'
  }

  if (
    /this operation requires an authenticated account/iu.test(normalized) ||
    /x-tenant-id requires authorization/iu.test(normalized)
  ) {
    return 'Your session expired. Refresh the page and try again.'
  }

  if (/provider is not configured/iu.test(normalized)) {
    return 'The selected model provider is not configured on the backend. Check the backend API keys and model settings.'
  }

  if (
    /unique constraint failed:\s*mcp_servers\.tenant_id,\s*mcp_servers\.created_by_account_id,\s*mcp_servers\.label/iu.test(
      normalized,
    )
  ) {
    return 'An MCP with that name already exists in your workspace. Use a different name or let the UI rename it for you.'
  }

  if (/invalid authorization token/iu.test(normalized)) {
    return "The MCP server rejected your Authorization header. Verify you entered the server's own bearer token exactly as configured on that server."
  }

  if (/authorization popup was blocked/iu.test(normalized)) {
    return 'The authentication popup was blocked by your browser. Allow popups for this site and try again.'
  }

  if (/authentication window closed before completion/iu.test(normalized)) {
    return 'Authentication was cancelled before completion.'
  }

  if (/authentication failed/iu.test(normalized)) {
    return 'Authentication failed. Check the provider account in the popup and try again.'
  }

  if (/authorization required\./iu.test(normalized)) {
    return 'This MCP server requires an Authorization header. Add the exact bearer token configured on that server.'
  }

  if (/provider error/iu.test(normalized) || /upstream unavailable/iu.test(normalized)) {
    return normalized
  }

  if (options.status === 502) {
    return normalized || 'The server is temporarily unavailable. Try again in a moment.'
  }

  if (options.status && options.status >= 500) {
    return 'The server failed to process the request. Try again in a moment.'
  }

  return normalized
}

export const readErrorResponseMessage = async (
  response: Pick<Response, 'status' | 'text'>,
  fallback: string,
): Promise<string> =>
  humanizeErrorMessage(extractErrorMessage(await response.text(), fallback), {
    status: response.status,
  })
