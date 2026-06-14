import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createResourceAccessService } from '../../../../application/access/resource-access'
import { DEFAULT_REPLAY_EVENT_CATEGORY } from '../../../../domain/events/committed-event-contract'
import type { DomainEventCategory } from '../../../../domain/events/domain-event'
import { createDomainEventRepository } from '../../../../domain/events/domain-event-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { asRunId, asSessionThreadId, asWorkSessionId } from '../../../../shared/ids'
import { writeDomainEventSse } from '../../sse'

const parseOptionalInteger = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new DomainErrorException({
      message: `${value} is not a valid non-negative integer`,
      type: 'validation',
    })
  }

  return parsed
}

const parseFollow = (value: string | undefined): boolean => {
  if (value === undefined || value === '') {
    return false
  }

  if (value === 'true' || value === '1') {
    return true
  }

  if (value === 'false' || value === '0') {
    return false
  }

  throw new DomainErrorException({
    message: `${value} is not a valid follow flag`,
    type: 'validation',
  })
}

const parseEventCategory = (value: string | undefined): DomainEventCategory | 'all' => {
  if (!value || value === DEFAULT_REPLAY_EVENT_CATEGORY) {
    return DEFAULT_REPLAY_EVENT_CATEGORY
  }

  if (value === 'telemetry' || value === 'all') {
    return value
  }

  throw new DomainErrorException({
    message: `${value} is not a valid event category`,
    type: 'validation',
  })
}

export const createEventRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/stream', async (c) => {
    const category = parseEventCategory(c.req.query('category'))
    const tenantScope = requireTenantScope(c)
    const follow = parseFollow(c.req.query('follow'))
    const limit = parseOptionalInteger(c.req.query('limit')) ?? 100
    let cursor = parseOptionalInteger(c.req.query('cursor')) ?? 0
    const sessionId = c.req.query('sessionId')
    const threadId = c.req.query('threadId')
    const runId = c.req.query('runId')
    const accessResult = createResourceAccessService(c.get('db')).authorizeEventStream(
      tenantScope,
      {
        runId: runId ? asRunId(runId) : null,
        sessionId: sessionId ? asWorkSessionId(sessionId) : null,
        threadId: threadId ? asSessionThreadId(threadId) : null,
      },
    )

    if (!accessResult.ok) {
      throw new DomainErrorException(accessResult.error)
    }

    return streamSSE(c, async (stream) => {
      const repository = createDomainEventRepository(c.get('db'))
      const followDeadline = Date.now() + c.get('config').server.eventStreamMaxFollowMs
      const subscription = follow
        ? c.get('services').events.realtime.subscribe({
            afterCursor: cursor,
            category,
            runId,
            sessionId,
            threadId,
          })
        : null

      try {
        while (!stream.aborted) {
          const events = repository.listAfterCursor(tenantScope, {
            category,
            cursor,
            limit,
            runId,
            sessionId,
            threadId,
          })

          if (!events.ok) {
            throw new DomainErrorException(events.error)
          }

          if (events.value.length === 0) {
            break
          }

          for (const event of events.value) {
            cursor = event.eventNo
            await writeDomainEventSse(stream, event)
          }
        }

        if (!follow || !subscription) {
          return
        }

        const events = repository.listAfterCursor(tenantScope, {
          category,
          cursor,
          limit,
          runId,
          sessionId,
          threadId,
        })

        if (!events.ok) {
          throw new DomainErrorException(events.error)
        }

        if (events.value.length > 0) {
          for (const event of events.value) {
            cursor = event.eventNo
            await writeDomainEventSse(stream, event)
          }
        }
        while (!stream.aborted) {
          if (Date.now() >= followDeadline) {
            break
          }

          const event = await subscription.next(30_000)

          if (!event) {
            continue
          }

          if (event.eventNo <= cursor) {
            continue
          }

          cursor = event.eventNo
          await writeDomainEventSse(stream, event)
        }
      } finally {
        subscription?.close()
      }
    })
  })

  return routes
}
