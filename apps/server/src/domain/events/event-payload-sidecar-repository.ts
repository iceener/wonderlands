import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const EVENT_PAYLOAD_SIDECAR_KEYS: Partial<Record<string, readonly string[]>> = {
  'generation.completed': ['outputItems', 'outputMessages', 'toolCalls'],
  'generation.started': ['inputMessages', 'tools'],
}

/**
 * Splits large event payload fragments out of the primary event payload so
 * they can be stored in a compressed sidecar record instead of inline. This
 * is pure domain logic (no persistence access); the concrete sidecar
 * storage lives under `adapters/persistence/sqlite/` -- see
 * `EventPayloadSidecarRepository` below and
 * `test/architecture-guardrails.test.ts`.
 */
export const splitEventPayloadForStorage = (
  type: string,
  payload: unknown,
): {
  primaryPayload: unknown
  sidecarPayload: Record<string, unknown> | null
} => {
  if (!isRecord(payload)) {
    return {
      primaryPayload: payload,
      sidecarPayload: null,
    }
  }

  const sidecarKeys = EVENT_PAYLOAD_SIDECAR_KEYS[type]

  if (!sidecarKeys || sidecarKeys.length === 0) {
    return {
      primaryPayload: payload,
      sidecarPayload: null,
    }
  }

  const primaryPayload: Record<string, unknown> = { ...payload }
  const sidecarPayload: Record<string, unknown> = {}

  for (const key of sidecarKeys) {
    if (!Object.hasOwn(payload, key)) {
      continue
    }

    sidecarPayload[key] = payload[key]
    delete primaryPayload[key]
  }

  if (Object.keys(sidecarPayload).length === 0) {
    return {
      primaryPayload: payload,
      sidecarPayload: null,
    }
  }

  try {
    const serialized = JSON.stringify(sidecarPayload)

    if (Buffer.byteLength(serialized, 'utf8') < 1024) {
      return {
        primaryPayload: payload,
        sidecarPayload: null,
      }
    }
  } catch {
    return {
      primaryPayload: payload,
      sidecarPayload: null,
    }
  }

  return {
    primaryPayload,
    sidecarPayload,
  }
}

export const hydrateStoredEventPayload = (
  payload: unknown,
  sidecarPayload: Record<string, unknown> | null | undefined,
): unknown => {
  if (!sidecarPayload) {
    return payload
  }

  if (!isRecord(payload)) {
    return sidecarPayload
  }

  return {
    ...payload,
    ...sidecarPayload,
  }
}

export interface CreateEventPayloadSidecarInput {
  createdAt: string
  eventId: string
  payload: Record<string, unknown>
}

/**
 * Persistence-neutral port for event payload sidecar storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface EventPayloadSidecarRepository {
  create: (input: CreateEventPayloadSidecarInput) => Result<null, DomainError>
  listByEventIds: (eventIds: string[]) => Result<Map<string, Record<string, unknown>>, DomainError>
  removeByEventId: (eventId: string) => Result<null, DomainError>
}
