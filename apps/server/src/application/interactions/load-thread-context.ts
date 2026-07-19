import type { RunRecord } from '../../domain/runtime/run-repository'
import { err, ok } from '../../shared/result'
import { getAgentDescription, listAgentCapabilities } from '../agents/agent-capabilities'
import type { CommandContext, CommandResult } from '../commands/command-context'
import { loadScopedMemoryState } from '../context/lifecycle/reflect-memory'
import {
  type PrepareContextStateOptions,
  prepareContextState,
} from '../context/prepare-context-state'
import { loadThreadAttachmentRefs } from '../files/attachment-ref-context'
import { loadVisibleFileContext } from '../files/file-context'
import { loadGardenAgentContext } from '../garden/garden-agent-context'
import {
  createAgentRepository,
  createAgentRevisionRepository,
  createAgentSubagentLinkRepository,
} from '../persistence/repositories'
import { listVisibleMessages } from '../runtime/projection/run-projection'
import type { ThreadContextData } from './context-bundle'

const loadAgentProfile = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<ThreadContextData['agentProfile']> => {
  if (!run.agentRevisionId) {
    return ok(null)
  }

  const revisionRepository = createAgentRevisionRepository(context.db)
  const revision = revisionRepository.getById(context.tenantScope, run.agentRevisionId)

  if (!revision.ok) {
    return revision
  }

  const subagentLinkRepository = createAgentSubagentLinkRepository(context.db)
  const subagentLinks = subagentLinkRepository.listByParentRevisionId(
    context.tenantScope,
    revision.value.id,
  )

  if (!subagentLinks.ok) {
    return subagentLinks
  }

  const agentRepository = createAgentRepository(context.db)
  const subagents: NonNullable<ThreadContextData['agentProfile']>['subagents'] = []

  for (const link of subagentLinks.value) {
    const childAgent = agentRepository.getById(context.tenantScope, link.childAgentId)

    if (!childAgent.ok) {
      return childAgent
    }

    if (childAgent.value.status !== 'active') {
      continue
    }

    let childDescription: string | null = null
    let tools: NonNullable<ThreadContextData['agentProfile']>['subagents'][number]['tools'] = []

    if (childAgent.value.activeRevisionId) {
      const childRevision = revisionRepository.getById(
        context.tenantScope,
        childAgent.value.activeRevisionId,
      )

      if (!childRevision.ok) {
        return childRevision
      }

      const parsedChildDescription = getAgentDescription(childRevision.value)

      if (!parsedChildDescription.ok) {
        return parsedChildDescription
      }

      childDescription = parsedChildDescription.value

      const childCapabilities = listAgentCapabilities({
        db: context.db,
        revision: childRevision.value,
        scope: context.tenantScope,
        toolRegistry: context.services.tools,
      })

      if (!childCapabilities.ok) {
        return childCapabilities
      }

      tools = childCapabilities.value
    }

    subagents.push({
      alias: link.alias,
      childAgentId: link.childAgentId,
      childDescription,
      childName: childAgent.value.name,
      childSlug: childAgent.value.slug,
      delegationMode: link.delegationMode,
      tools,
    })
  }

  return ok({
    instructionsMd: revision.value.instructionsMd,
    revisionId: revision.value.id,
    subagents,
  })
}

interface CompatibilityFacts {
  agentProfile: ThreadContextData['agentProfile']
  attachmentRefs: ThreadContextData['attachmentRefs']
  gardenContext: ThreadContextData['gardenContext']
}

/**
 * Compatibility wrapper preserving the legacy read and lifecycle order. New integrations should
 * call prepareContextState(), then a read-only facts collector, instead.
 */
export const loadThreadContext = async (
  context: CommandContext,
  run: RunRecord,
  options: PrepareContextStateOptions = {},
): Promise<CommandResult<ThreadContextData>> => {
  const visibleMessages = listVisibleMessages(context, run)

  if (!visibleMessages.ok) {
    return visibleMessages
  }

  const visibleFiles = await loadVisibleFileContext(context, visibleMessages.value, run.id)

  if (!visibleFiles.ok) {
    return visibleFiles
  }

  const compatibility = { facts: null as CompatibilityFacts | null }
  const prepared = await prepareContextState(context, run, options, {
    beforeMemoryLifecycle: (boundaries) => {
      const attachmentRefs = loadThreadAttachmentRefs(context, {
        liveTailItems: boundaries.liveTailItems,
        visibleMessages: boundaries.visibleMessages,
      })

      if (!attachmentRefs.ok) {
        return attachmentRefs
      }

      const agentProfile = loadAgentProfile(context, run)

      if (!agentProfile.ok) {
        return agentProfile
      }

      const gardenContext = loadGardenAgentContext(
        context.db,
        context.tenantScope,
        run.agentRevisionId,
      )

      if (!gardenContext.ok) {
        return gardenContext
      }

      compatibility.facts = {
        agentProfile: agentProfile.value,
        attachmentRefs: attachmentRefs.value,
        gardenContext: gardenContext.value.gardens.length > 0 ? gardenContext.value : null,
      }

      return ok(null)
    },
    visibleMessages: visibleMessages.value,
  })

  if (!prepared.ok) {
    return prepared
  }

  const compatibilityFacts = compatibility.facts

  if (!compatibilityFacts) {
    return err({
      message: 'context preparation completed without compatibility facts',
      type: 'conflict',
    })
  }

  const scopedMemory = loadScopedMemoryState(context, run)

  if (!scopedMemory.ok) {
    return scopedMemory
  }

  return ok({
    attachmentRefs: compatibilityFacts.attachmentRefs,
    agentProfile: compatibilityFacts.agentProfile,
    activeReflection: scopedMemory.value.activeReflection,
    gardenContext: compatibilityFacts.gardenContext,
    items: prepared.value.liveTailItems,
    observations: scopedMemory.value.observations,
    pendingWaits: prepared.value.pendingWaits,
    run,
    summary: prepared.value.latestSummary,
    visibleFiles: visibleFiles.value,
    visibleMessages: prepared.value.visibleMessages,
  })
}
