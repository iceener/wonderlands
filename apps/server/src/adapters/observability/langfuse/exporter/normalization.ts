import { isRecord } from '../../../../domain/ai/json-utils'
import type { DomainEventEnvelope } from '../../../../domain/events/domain-event'
import type { EventPayload } from './types'

export const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')

export const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

export const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const toDisplayNameFromAlias = (value: string | null): string | null => {
  if (!value) {
    return null
  }

  return value
    .split(/[-_\s]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join(' ')
}

export const toEventPayload = (event: DomainEventEnvelope<unknown>): EventPayload | null =>
  isRecord(event.payload) ? event.payload : null

export const toErrorOutput = (value: unknown): Record<string, unknown> | string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  if (isRecord(value)) {
    return value
  }

  return value === undefined ? undefined : { error: value }
}

export const toErrorMessage = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  if (isRecord(value)) {
    return asString(value.message) ?? undefined
  }

  return undefined
}

export const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export const normalizeTagValue = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const toTag = (prefix: string, value: string | null): string | null => {
  if (!value) {
    return null
  }

  const normalized = normalizeTagValue(value)

  if (normalized.length === 0) {
    return null
  }

  return truncateText(`${prefix}:${normalized}`, 200)
}

export const toNumericRecord = (value: unknown): Record<string, number> | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const usageDetails: Record<string, number> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      usageDetails[key] = entry
    }
  }

  return Object.keys(usageDetails).length > 0 ? usageDetails : undefined
}

export const sortByTimestamp = <TValue extends { createdAt?: string; startTime?: string }>(
  values: readonly TValue[],
): TValue[] =>
  [...values].sort((left, right) => {
    const leftTimestamp = left.startTime ?? left.createdAt ?? ''
    const rightTimestamp = right.startTime ?? right.createdAt ?? ''
    return leftTimestamp.localeCompare(rightTimestamp)
  })

export const findTurn = (payload: EventPayload | null): number | null => {
  const turn = asNumber(payload?.turn)
  return turn === null ? null : turn
}
