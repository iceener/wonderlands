import type { AppRuntime } from '../../app/runtime'
import type { EventOutboxRecord } from '../../domain/events/event-outbox-repository'
import type { DomainError } from '../../shared/errors'
import { err, type Result } from '../../shared/result'
import { createInternalCommandContext } from '../commands/internal-command-context'
import { threadNamingRequestedPayloadSchema } from '../naming/thread-title-events'
import { processThreadNamingRequest } from '../naming/thread-title-service'

export interface BackgroundDispatchRuntime extends Pick<AppRuntime, 'config' | 'db' | 'services'> {}

const toInternalTenantScope = (
  entry: EventOutboxRecord,
): Result<
  {
    accountId: NonNullable<EventOutboxRecord['event']['actorAccountId']>
    role: 'service'
    tenantId: NonNullable<EventOutboxRecord['tenantId']>
  },
  DomainError
> => {
  if (!entry.tenantId) {
    return err({
      message: `background event ${entry.event.id} is missing a tenant scope`,
      type: 'conflict',
    })
  }

  if (!entry.event.actorAccountId) {
    return err({
      message: `background event ${entry.event.id} is missing an actor account id`,
      type: 'conflict',
    })
  }

  return {
    ok: true,
    value: {
      accountId: entry.event.actorAccountId,
      role: 'service',
      tenantId: entry.tenantId,
    },
  }
}

export const dispatchBackgroundEvent = async (
  runtime: BackgroundDispatchRuntime,
  entry: EventOutboxRecord,
): Promise<Result<null, DomainError>> => {
  const tenantScope = toInternalTenantScope(entry)

  if (!tenantScope.ok) {
    return tenantScope
  }

  const context = createInternalCommandContext(runtime, tenantScope.value)

  switch (entry.event.type) {
    case 'thread.naming.requested': {
      const parsedPayload = threadNamingRequestedPayloadSchema.safeParse(entry.event.payload)

      if (!parsedPayload.success) {
        return err({
          message: parsedPayload.error.issues.map((issue) => issue.message).join('; '),
          type: 'validation',
        })
      }

      return await processThreadNamingRequest(context, {
        causationId: entry.event.id,
        request: parsedPayload.data,
      })
    }
    default:
      return err({
        message: `background dispatcher does not handle event type "${entry.event.type}"`,
        type: 'conflict',
      })
  }
}
