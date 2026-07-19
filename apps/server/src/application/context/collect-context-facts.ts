import { ok } from '../../shared/result'
import type { CommandContext, CommandResult } from '../commands/command-context'
import { loadThreadAttachmentRefs } from '../files/attachment-ref-context'
import { loadVisibleFileContext } from '../files/file-context'
import { loadGardenAgentContext } from '../garden/garden-agent-context'
import { type ContextFacts, createContextFactsSnapshot } from './context-facts'
import { loadContextAgentProfile } from './facts/load-agent-profile'
import { loadScopedMemoryState } from './lifecycle/reflect-memory'
import type { PreparedContextState } from './prepare-context-state'

/**
 * Collects a detached snapshot using repository/blob reads only. Preparation owns projection,
 * compaction, observation and reflection; this function must run strictly after that boundary.
 */
export const collectContextFacts = async (
  context: CommandContext,
  preparedState: PreparedContextState,
): Promise<CommandResult<ContextFacts>> => {
  const visibleFiles = await loadVisibleFileContext(
    context,
    preparedState.visibleMessages,
    preparedState.run.id,
  )

  if (!visibleFiles.ok) {
    return visibleFiles
  }

  const attachmentRefs = loadThreadAttachmentRefs(context, {
    liveTailItems: preparedState.liveTailItems,
    visibleMessages: preparedState.visibleMessages,
  })

  if (!attachmentRefs.ok) {
    return attachmentRefs
  }

  const agentProfile = loadContextAgentProfile(context, preparedState.run)

  if (!agentProfile.ok) {
    return agentProfile
  }

  const gardenContext = loadGardenAgentContext(
    context.db,
    context.tenantScope,
    preparedState.run.agentRevisionId,
  )

  if (!gardenContext.ok) {
    return gardenContext
  }

  const scopedMemory = loadScopedMemoryState(context, preparedState.run)

  if (!scopedMemory.ok) {
    return scopedMemory
  }

  return ok(
    createContextFactsSnapshot({
      activeReflection: scopedMemory.value.activeReflection,
      agentProfile: agentProfile.value,
      attachmentRefs: attachmentRefs.value,
      // The prepared run is the durable capture boundary; collecting facts never reads a clock.
      capturedAt: preparedState.run.updatedAt,
      gardenContext: gardenContext.value.gardens.length > 0 ? gardenContext.value : null,
      items: preparedState.liveTailItems,
      observations: scopedMemory.value.observations,
      pendingWaits: preparedState.pendingWaits,
      readiness: preparedState.readiness,
      run: preparedState.run,
      summary: preparedState.latestSummary,
      visibleFiles: visibleFiles.value,
      visibleMessages: preparedState.visibleMessages,
    }),
  )
}
