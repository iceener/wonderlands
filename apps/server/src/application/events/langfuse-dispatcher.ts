import type { LangfuseExporter } from '../../adapters/observability/langfuse/exporter'
import type { EventOutboxRecord } from '../../domain/events/event-outbox-repository'
import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'

export const dispatchLangfuseEvent = (
  langfuse: LangfuseExporter,
  entry: EventOutboxRecord,
): Promise<Result<null, DomainError>> => langfuse.exportOutboxEntry(entry)
