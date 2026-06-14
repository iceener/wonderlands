import type { DomainEventEnvelope } from '../../domain/events/domain-event'

export const writeDomainEventSse = async (
  stream: {
    writeSSE: (input: { data: string; event: string; id: string }) => Promise<void>
  },
  event: DomainEventEnvelope<unknown> & { eventNo: number },
): Promise<void> =>
  stream.writeSSE({
    data: JSON.stringify({
      ...event,
      eventNo: event.eventNo,
    }),
    event: event.type,
    id: String(event.eventNo),
  })
