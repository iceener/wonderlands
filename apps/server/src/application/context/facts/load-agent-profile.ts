import type { RunRecord } from '../../../domain/runtime/run-repository'
import { ok } from '../../../shared/result'
import { getAgentDescription, listAgentCapabilities } from '../../agents/agent-capabilities'
import type { CommandContext, CommandResult } from '../../commands/command-context'
import type { AgentProfileContext } from '../../interactions/context-bundle'
import {
  createAgentRepository,
  createAgentRevisionRepository,
  createAgentSubagentLinkRepository,
} from '../../persistence/repositories'

/** Read-only projection of the run-bound agent revision and its active delegated agents. */
export const loadContextAgentProfile = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<AgentProfileContext | null> => {
  if (!run.agentRevisionId) {
    return ok(null)
  }

  const revisionRepository = createAgentRevisionRepository(context.db)
  const revision = revisionRepository.getById(context.tenantScope, run.agentRevisionId)

  if (!revision.ok) {
    return revision
  }

  const subagentLinks = createAgentSubagentLinkRepository(context.db).listByParentRevisionId(
    context.tenantScope,
    revision.value.id,
  )

  if (!subagentLinks.ok) {
    return subagentLinks
  }

  const agentRepository = createAgentRepository(context.db)
  const subagents: AgentProfileContext['subagents'] = []

  // Repository order is the configured subagent position order and is intentionally preserved.
  for (const link of subagentLinks.value) {
    const childAgent = agentRepository.getById(context.tenantScope, link.childAgentId)

    if (!childAgent.ok) {
      return childAgent
    }

    if (childAgent.value.status !== 'active') {
      continue
    }

    let childDescription: string | null = null
    let tools: AgentProfileContext['subagents'][number]['tools'] = []

    if (childAgent.value.activeRevisionId) {
      const childRevision = revisionRepository.getById(
        context.tenantScope,
        childAgent.value.activeRevisionId,
      )

      if (!childRevision.ok) {
        return childRevision
      }

      const description = getAgentDescription(childRevision.value)

      if (!description.ok) {
        return description
      }

      childDescription = description.value

      const capabilities = listAgentCapabilities({
        db: context.db,
        revision: childRevision.value,
        scope: context.tenantScope,
        toolRegistry: context.services.tools,
      })

      if (!capabilities.ok) {
        return capabilities
      }

      tools = capabilities.value
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
