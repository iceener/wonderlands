import type { AppConfig, ContextAssemblyMode } from '../../app/config'
import type { AccountId } from '../../shared/ids'

export interface ContextRolloutDecision {
  readonly mode: ContextAssemblyMode
  readonly persistManifest: boolean
}

/**
 * Resolves rollout behavior without selecting active v2 request semantics.
 *
 * An empty allowlist applies shadow persistence to every actor, including runs without an actor.
 * When the allowlist is nonempty, a null actor is denied because it cannot be matched safely.
 */
export const resolveContextRollout = (
  config: AppConfig['context'],
  actorAccountId: AccountId | null,
): ContextRolloutDecision => {
  const actorAllowed =
    config.v2AccountAllowlist.length === 0 ||
    (actorAccountId !== null && config.v2AccountAllowlist.includes(actorAccountId))

  return {
    mode: config.assemblyMode,
    persistManifest: config.assemblyMode === 'v2_shadow' && config.manifestPersist && actorAllowed,
  }
}
