import { createHash } from 'node:crypto'

import type { Context } from 'hono'

import type { AppEnv } from '../../app/types'
import {
  createHttpIdempotencyKeyRepository,
  type HttpIdempotencyKeyRecord,
} from '../../domain/operations/http-idempotency-key-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { Result } from '../../shared/result'
import { successEnvelope } from './api-envelope'

const IN_PROGRESS_TTL_MS = 5 * 60 * 1000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue)
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeJsonValue(child)]),
    )
  }

  return value
}

export const toRequestHash = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(normalizeJsonValue(value)))
    .digest('hex')

const addMilliseconds = (value: string, milliseconds: number): string =>
  new Date(Date.parse(value) + milliseconds).toISOString()

export interface IdempotentRouteSuccess<TData> {
  data: TData
  status: 200 | 201 | 202
}

export interface IdempotentExecutionContext {
  idempotencyRecordId: string | null
  recordProgress: (value: unknown) => void
}

interface MatchedIdempotencyRecord {
  record: HttpIdempotencyKeyRecord
  scope: string
}

export const recoverRecordedIdempotentProgress = <TData>(input: {
  parse: (value: unknown) => TData
  record: HttpIdempotencyKeyRecord
  status: IdempotentRouteSuccess<TData>['status']
}): IdempotentRouteSuccess<TData> | null => {
  try {
    return {
      data: input.parse(input.record.responseDataJson),
      status: input.status,
    }
  } catch {
    return null
  }
}

const toReplayStatus = <TData>(statusCode: number): IdempotentRouteSuccess<TData>['status'] => {
  if (statusCode === 200 || statusCode === 201 || statusCode === 202) {
    return statusCode
  }

  throw new DomainErrorException({
    message: `cached idempotent response has unsupported status code ${statusCode}`,
    type: 'conflict',
  })
}

export const maybeHandleIdempotentJsonRoute = async <TData>(
  c: Context<AppEnv>,
  input: {
    execute: (
      context?: IdempotentExecutionContext,
    ) => Promise<IdempotentRouteSuccess<TData>> | IdempotentRouteSuccess<TData>
    parseReplayData: (value: unknown) => TData
    recoverInProgress?: (input: {
      record: HttpIdempotencyKeyRecord
    }) => Promise<IdempotentRouteSuccess<TData> | null> | IdempotentRouteSuccess<TData> | null
    legacyScopes?: string[]
    requestBody: unknown
    scope: string
  },
) => {
  const tenantScope = c.get('tenantScope')
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  const requestHash = toRequestHash(input.requestBody)

  if (!idempotencyKey) {
    const executed = await input.execute({
      idempotencyRecordId: null,
      recordProgress: () => {},
    })
    return c.json(successEnvelope(c, executed.data), executed.status)
  }

  if (idempotencyKey.length > 200) {
    throw new DomainErrorException({
      message: 'Idempotency-Key must be at most 200 characters',
      type: 'validation',
    })
  }

  if (!tenantScope) {
    throw new DomainErrorException({
      message: 'idempotent routes require tenant scope',
      type: 'conflict',
    })
  }

  const repository = createHttpIdempotencyKeyRepository(c.get('db'))
  const lookupRecordByScopes = (scopes: string[]): MatchedIdempotencyRecord | null => {
    for (const scope of scopes) {
      const existing = repository.getByKey(tenantScope, {
        idempotencyKey,
        scope,
      })

      if (!existing.ok) {
        throw new DomainErrorException(existing.error)
      }

      if (existing.value) {
        return {
          record: existing.value,
          scope,
        }
      }
    }

    return null
  }
  const completeOrReplay = (
    record: Pick<HttpIdempotencyKeyRecord, 'id' | 'scope'>,
    executed: IdempotentRouteSuccess<TData>,
  ) => {
    const completedAt = c.get('services').clock.nowIso()
    const completed = repository.complete(tenantScope, {
      completedAt,
      id: record.id,
      responseDataJson: executed.data,
      statusCode: executed.status,
      updatedAt: completedAt,
    })

    if (completed.ok) {
      return c.json(successEnvelope(c, executed.data), executed.status)
    }

    const existing = repository.getByKey(tenantScope, {
      idempotencyKey,
      scope: record.scope,
    })

    if (!existing.ok) {
      throw new DomainErrorException(existing.error)
    }

    if (
      !existing.value ||
      existing.value.status !== 'completed' ||
      existing.value.statusCode === null
    ) {
      throw new DomainErrorException(completed.error)
    }

    return c.json(
      successEnvelope(c, input.parseReplayData(existing.value.responseDataJson)),
      toReplayStatus<TData>(existing.value.statusCode),
    )
  }

  const now = c.get('services').clock.nowIso()
  const scopes = [
    input.scope,
    ...(input.legacyScopes ?? []).filter((scope) => scope !== input.scope),
  ]
  const existing = lookupRecordByScopes(scopes)

  if (existing) {
    if (existing.record.requestHash !== requestHash) {
      throw new DomainErrorException({
        message: `idempotency key "${idempotencyKey}" was already used with a different request payload`,
        type: 'conflict',
      })
    }

    if (existing.record.status === 'completed') {
      if (existing.record.statusCode === null) {
        throw new DomainErrorException({
          message: `cached idempotent response for "${idempotencyKey}" is missing a status code`,
          type: 'conflict',
        })
      }

      const replayStatus = toReplayStatus<TData>(existing.record.statusCode)

      return c.json(
        successEnvelope(c, input.parseReplayData(existing.record.responseDataJson)),
        replayStatus,
      )
    }

    if (input.recoverInProgress) {
      const recovered = await input.recoverInProgress({
        record: existing.record,
      })

      if (recovered) {
        return completeOrReplay(existing.record, recovered)
      }
    }

    if (!existing.record.expiresAt || existing.record.expiresAt > now) {
      throw new DomainErrorException({
        message: `idempotent request "${idempotencyKey}" is already in progress`,
        type: 'conflict',
      })
    }
  }

  const started = repository.begin(tenantScope, {
    expiresAt: addMilliseconds(now, IN_PROGRESS_TTL_MS),
    idempotencyKey,
    now,
    requestHash,
    scope: input.scope,
  })

  if (!started.ok) {
    throw new DomainErrorException(started.error)
  }

  if (started.value.kind === 'replay') {
    if (started.value.record.statusCode === null) {
      throw new DomainErrorException({
        message: `cached idempotent response for "${idempotencyKey}" is missing a status code`,
        type: 'conflict',
      })
    }

    const replayStatus = toReplayStatus<TData>(started.value.record.statusCode)

    return c.json(
      successEnvelope(c, input.parseReplayData(started.value.record.responseDataJson)),
      replayStatus,
    )
  }

  try {
    const executed = await input.execute({
      idempotencyRecordId: started.value.record.id,
      recordProgress: (value: unknown) => {
        const recorded = repository.recordProgress(tenantScope, {
          id: started.value.record.id,
          responseDataJson: value,
          updatedAt: c.get('services').clock.nowIso(),
        })

        if (!recorded.ok) {
          throw new DomainErrorException(recorded.error)
        }
      },
    })

    return completeOrReplay(started.value.record, executed)
  } catch (error) {
    repository.abandon(tenantScope, {
      id: started.value.record.id,
    })

    throw error
  }
}

export const buildRecordedProgressIdempotentRoute = <TData>(
  c: Context<AppEnv>,
  input: {
    execute: () => Promise<Result<TData, DomainError>> | Result<TData, DomainError>
    legacyScopes?: string[]
    parseReplayData: (value: unknown) => TData
    requestBody: unknown
    scope: string
    status: IdempotentRouteSuccess<TData>['status']
  },
) =>
  maybeHandleIdempotentJsonRoute(c, {
    execute: async (idempotency) => {
      const result = await input.execute()

      if (!result.ok) {
        throw new DomainErrorException(result.error)
      }

      idempotency?.recordProgress(result.value)

      return {
        data: result.value,
        status: input.status,
      }
    },
    legacyScopes: input.legacyScopes,
    parseReplayData: input.parseReplayData,
    recoverInProgress: ({ record }) =>
      recoverRecordedIdempotentProgress({
        parse: input.parseReplayData,
        record,
        status: input.status,
      }),
    requestBody: input.requestBody,
    scope: input.scope,
  })

export const buildSnapshotRecoveryIdempotentRoute = <TData, TSnapshot>(
  c: Context<AppEnv>,
  input: {
    execute: () => Promise<TSnapshot> | TSnapshot
    legacyScopes?: string[]
    parseReplayData: (value: unknown) => TData
    requestBody: unknown
    scope: string
    toSuccess: (snapshot: TSnapshot) => IdempotentRouteSuccess<TData>
    tryParseSnapshot: (value: unknown) => TSnapshot | null
  },
) =>
  maybeHandleIdempotentJsonRoute<TData>(c, {
    execute: async (idempotency) => {
      const snapshot = await input.execute()

      idempotency?.recordProgress(snapshot)
      return input.toSuccess(snapshot)
    },
    legacyScopes: input.legacyScopes,
    parseReplayData: input.parseReplayData,
    recoverInProgress: ({ record }) => {
      const snapshot = input.tryParseSnapshot(record.responseDataJson)

      return snapshot ? input.toSuccess(snapshot) : null
    },
    requestBody: input.requestBody,
    scope: input.scope,
  })

export const buildRecoverableCommandIdempotentRoute = <TData>(
  c: Context<AppEnv>,
  input: {
    execute: () => Promise<Result<TData, DomainError>> | Result<TData, DomainError>
    legacyScopes?: string[]
    parseReplayData: (value: unknown) => TData
    recoverConflict: () =>
      | Promise<IdempotentRouteSuccess<TData> | null>
      | IdempotentRouteSuccess<TData>
      | null
    requestBody: unknown
    scope: string
    toSuccess: (value: TData) => IdempotentRouteSuccess<TData>
  },
) =>
  maybeHandleIdempotentJsonRoute(c, {
    execute: async () => {
      const result = await input.execute()

      if (!result.ok) {
        if (result.error.type === 'conflict') {
          const recovered = await input.recoverConflict()

          if (recovered) {
            return recovered
          }
        }

        throw new DomainErrorException(result.error)
      }

      return input.toSuccess(result.value)
    },
    legacyScopes: input.legacyScopes,
    parseReplayData: input.parseReplayData,
    recoverInProgress: async () => input.recoverConflict(),
    requestBody: input.requestBody,
    scope: input.scope,
  })
