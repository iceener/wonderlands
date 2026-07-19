import type {
  ContextManifestMode,
  ContextManifestRecord,
  RedactedContextManifest,
} from '../../domain/context/context-manifest-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import { ok } from '../../shared/result'
import type { CommandContext, CommandResult } from '../commands/command-context'
import type { ContextManifest } from './manifest'

export interface PersistContextManifestAttemptInput {
  readonly manifest: ContextManifest
  readonly mode: ContextManifestMode
  readonly run: RunRecord
  readonly turn: number
}

/**
 * Allocates the next provider-attempt sequence from durable manifests. This remains monotonic when
 * a waiting run resumes without incrementing its persisted model-turn count.
 */
export const resolveNextContextManifestAttemptTurn = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<number> => {
  const existing = context.repositories.contextManifest.list(context.tenantScope, {
    limit: 100,
    runId: run.id,
  })

  if (!existing.ok) {
    return existing
  }

  return ok(existing.value.reduce((highest, record) => Math.max(highest, record.turn), 0) + 1)
}

/** Persists the already-redacted manifest immediately before a provider attempt. */
export const persistContextManifestAttempt = (
  context: CommandContext,
  input: PersistContextManifestAttemptInput,
): CommandResult<ContextManifestRecord> => {
  const id = context.services.ids.create('ctxm')
  const createdAt = context.services.clock.nowIso()
  const manifest: RedactedContextManifest = Object.freeze({
    ...input.manifest,
    persistenceId: id,
  })

  return context.repositories.contextManifest.create(context.tenantScope, {
    assemblerVersion: manifest.assemblerVersion,
    createdAt,
    generatedAt: manifest.generatedAt,
    id,
    manifest,
    mode: input.mode,
    model: manifest.model,
    provider: manifest.provider,
    replayHash: manifest.replayHash,
    runId: input.run.id,
    threadId: input.run.threadId,
    turn: input.turn,
  })
}
