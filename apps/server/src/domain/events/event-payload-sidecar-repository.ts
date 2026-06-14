import { gunzipSync, gzipSync } from 'node:zlib'

import { eq, inArray } from 'drizzle-orm'

import { eventPayloadSidecars } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { RepositoryDatabase } from '../database-port'

const PAYLOAD_SIDECAR_ENCODING = 'gzip-json-v1'
const PAYLOAD_SIDECAR_MIN_BYTES = 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const EVENT_PAYLOAD_SIDECAR_KEYS: Partial<Record<string, readonly string[]>> = {
  'generation.completed': ['outputItems', 'outputMessages', 'toolCalls'],
  'generation.started': ['inputMessages', 'tools'],
}

const encodePayloadFragment = (payload: Record<string, unknown>): Buffer | null => {
  try {
    return gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
  } catch {
    return null
  }
}

const decodePayloadFragment = (buffer: Buffer): Record<string, unknown> | null => {
  try {
    const decoded = JSON.parse(gunzipSync(buffer).toString('utf8'))
    return isRecord(decoded) ? decoded : null
  } catch {
    return null
  }
}

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

    if (Buffer.byteLength(serialized, 'utf8') < PAYLOAD_SIDECAR_MIN_BYTES) {
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

export const createEventPayloadSidecarRepository = (db: RepositoryDatabase) => ({
  create: (input: {
    createdAt: string
    eventId: string
    payload: Record<string, unknown>
  }): Result<null, DomainError> => {
    try {
      const payloadCompressed = encodePayloadFragment(input.payload)

      if (!payloadCompressed) {
        return err({
          message: `failed to encode payload sidecar for event ${input.eventId}`,
          type: 'conflict',
        })
      }

      db.insert(eventPayloadSidecars)
        .values({
          createdAt: input.createdAt,
          encoding: PAYLOAD_SIDECAR_ENCODING,
          eventId: input.eventId,
          payloadCompressed,
        })
        .run()

      return ok(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown event payload sidecar write failure'

      return err({
        message: `failed to persist payload sidecar for event ${input.eventId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByEventIds: (
    eventIds: string[],
  ): Result<Map<string, Record<string, unknown>>, DomainError> => {
    if (eventIds.length === 0) {
      return ok(new Map())
    }

    try {
      const rows = db
        .select({
          encoding: eventPayloadSidecars.encoding,
          eventId: eventPayloadSidecars.eventId,
          payloadCompressed: eventPayloadSidecars.payloadCompressed,
        })
        .from(eventPayloadSidecars)
        .where(inArray(eventPayloadSidecars.eventId, eventIds))
        .all()

      const payloads = new Map<string, Record<string, unknown>>()

      for (const row of rows) {
        if (row.encoding !== PAYLOAD_SIDECAR_ENCODING) {
          return err({
            message: `event ${row.eventId} uses unsupported payload sidecar encoding "${row.encoding}"`,
            type: 'conflict',
          })
        }

        const payload = decodePayloadFragment(Buffer.from(row.payloadCompressed))

        if (!payload) {
          return err({
            message: `failed to decode payload sidecar for event ${row.eventId}`,
            type: 'conflict',
          })
        }

        payloads.set(row.eventId, payload)
      }

      return ok(payloads)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown event payload sidecar query failure'

      return err({
        message: `failed to query payload sidecars: ${message}`,
        type: 'conflict',
      })
    }
  },
  removeByEventId: (eventId: string): Result<null, DomainError> => {
    try {
      db.delete(eventPayloadSidecars).where(eq(eventPayloadSidecars.eventId, eventId)).run()
      return ok(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown event payload sidecar delete failure'

      return err({
        message: `failed to delete payload sidecar for event ${eventId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
