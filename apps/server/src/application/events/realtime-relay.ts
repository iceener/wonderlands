import type { DomainEventCategory, DomainEventEnvelope } from '../../domain/events/domain-event'
import { matchesDomainEventStreamScope } from '../../domain/events/event-stream-filter'

export type DeliveredRealtimeEvent = DomainEventEnvelope<unknown> & { eventNo: number }

export interface RealtimeEventSubscription {
  close: () => void
  next: (timeoutMs?: number) => Promise<DeliveredRealtimeEvent | null>
}

export interface RealtimeEventRelay {
  publish: (event: DeliveredRealtimeEvent) => void
  subscribe: (input: {
    afterCursor: number
    category: DomainEventCategory | 'all'
    runId?: string | null
    sessionId?: string | null
    threadId?: string | null
  }) => RealtimeEventSubscription
}

interface InternalSubscription {
  afterCursor: number
  category: DomainEventCategory | 'all'
  closed: boolean
  pending: DeliveredRealtimeEvent[]
  pendingResolve: ((value: DeliveredRealtimeEvent | null) => void) | null
  runId: string | null
  sessionId: string | null
  threadId: string | null
  timer: ReturnType<typeof setTimeout> | null
}

const matchesCategory = (
  subscription: Pick<InternalSubscription, 'category'>,
  event: Pick<DeliveredRealtimeEvent, 'category'>,
): boolean => subscription.category === 'all' || subscription.category === event.category

const matchesScope = (
  subscription: Pick<InternalSubscription, 'runId' | 'sessionId' | 'threadId'>,
  event: Pick<DeliveredRealtimeEvent, 'aggregateId' | 'aggregateType' | 'payload'>,
): boolean =>
  matchesDomainEventStreamScope(event, {
    runId: subscription.runId,
    sessionId: subscription.sessionId,
    threadId: subscription.threadId,
  })

const clearPendingTimer = (subscription: InternalSubscription) => {
  if (subscription.timer) {
    clearTimeout(subscription.timer)
    subscription.timer = null
  }
}

export const createRealtimeEventRelay = (): RealtimeEventRelay => {
  const subscriptions = new Set<InternalSubscription>()

  return {
    publish: (event) => {
      for (const subscription of subscriptions) {
        if (
          subscription.closed ||
          event.eventNo <= subscription.afterCursor ||
          !matchesCategory(subscription, event) ||
          !matchesScope(subscription, event)
        ) {
          continue
        }

        subscription.afterCursor = event.eventNo

        if (subscription.pendingResolve) {
          const resolve = subscription.pendingResolve

          subscription.pendingResolve = null
          clearPendingTimer(subscription)
          resolve(event)
          continue
        }

        subscription.pending.push(event)
      }
    },
    subscribe: ({ afterCursor, category, runId, sessionId, threadId }) => {
      const subscription: InternalSubscription = {
        afterCursor,
        category,
        closed: false,
        pending: [],
        pendingResolve: null,
        runId: runId ?? null,
        sessionId: sessionId ?? null,
        threadId: threadId ?? null,
        timer: null,
      }
      subscriptions.add(subscription)

      return {
        close: () => {
          if (subscription.closed) {
            return
          }

          subscription.closed = true
          clearPendingTimer(subscription)
          subscriptions.delete(subscription)

          if (subscription.pendingResolve) {
            const resolve = subscription.pendingResolve

            subscription.pendingResolve = null
            resolve(null)
          }
        },
        next: async (timeoutMs = 0) => {
          if (subscription.closed) {
            return null
          }

          if (subscription.pending.length > 0) {
            return subscription.pending.shift() ?? null
          }

          return new Promise<DeliveredRealtimeEvent | null>((resolve) => {
            subscription.pendingResolve = resolve

            if (timeoutMs > 0) {
              subscription.timer = setTimeout(() => {
                if (subscription.pendingResolve !== resolve) {
                  return
                }

                subscription.pendingResolve = null
                subscription.timer = null
                resolve(null)
              }, timeoutMs)
            }
          })
        },
      }
    },
  }
}
