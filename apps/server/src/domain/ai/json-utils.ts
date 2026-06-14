import { DomainErrorException } from '../../shared/errors'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseRequiredJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse failure'

    throw new DomainErrorException({
      message: `${label} must be valid JSON: ${message}`,
      type: 'validation',
    })
  }
}

export const tryParseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
