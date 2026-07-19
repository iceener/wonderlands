import {
  getRootReservedApiBasePathPrefixes,
  isRootReservedApiBasePath,
} from '../../shared/http-routing'

export const parseCsv = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) {
    return fallback
  }

  const values = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (values.length === 0) {
    throw new Error('Expected a non-empty comma-separated list')
  }

  return [...new Set(values)]
}

export const parseInteger = (
  value: string | undefined,
  fallback: number,
  fieldName: string,
): number => {
  const resolved = value ?? String(fallback)
  const parsed = Number.parseInt(resolved, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`)
  }

  return parsed
}

export const parseBoolean = (
  value: string | undefined,
  fallback: boolean,
  fieldName: string,
): boolean => {
  if (value === undefined) {
    return fallback
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new Error(`${fieldName} must be "true" or "false"`)
}

export const parseNonNegativeInteger = (
  value: string | undefined,
  fallback: number,
  fieldName: string,
): number => {
  const resolved = value ?? String(fallback)
  const parsed = Number.parseInt(resolved, 10)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`)
  }

  return parsed
}

export const parseOptionalString = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export const parseUrl = (
  value: string | undefined,
  fallback: string,
  fieldName: string,
): string => {
  const resolved = value?.trim() || fallback

  try {
    return new URL(resolved).toString()
  } catch {
    throw new Error(`${fieldName} must be a valid URL`)
  }
}

export const parseUnitInterval = (
  value: string | undefined,
  fallback: number,
  fieldName: string,
): number => {
  const resolved = value ?? String(fallback)
  const parsed = Number.parseFloat(resolved)

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`${fieldName} must be a number between 0 and 1`)
  }

  return parsed
}

export const parseBasePath = (value: string | undefined): string => {
  // This is the canonical API mount used for generated links and primary routing.
  // It must stay distinct from root-owned routes such as /status and /_auth.
  const basePath = value?.trim() || '/api'

  if (!basePath.startsWith('/')) {
    throw new Error('API_BASE_PATH must start with "/"')
  }

  if (basePath.length > 1 && basePath.endsWith('/')) {
    throw new Error('API_BASE_PATH must not end with "/"')
  }

  if (basePath === '/') {
    throw new Error('API_BASE_PATH must not be "/"')
  }

  if (isRootReservedApiBasePath(basePath)) {
    throw new Error(
      `API_BASE_PATH must not shadow root-owned routes: ${getRootReservedApiBasePathPrefixes().join(', ')}`,
    )
  }

  return basePath
}

export const parseJsonString = <TValue>(
  value: string | undefined,
  fallback: TValue,
  parser: (input: unknown) => TValue,
  fieldName: string,
): TValue => {
  if (!value) {
    return fallback
  }

  try {
    const parsed = JSON.parse(value)
    return parser(parsed)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse failure'
    throw new Error(`${fieldName} is invalid: ${message}`)
  }
}
