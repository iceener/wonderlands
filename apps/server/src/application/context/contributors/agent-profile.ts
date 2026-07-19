import type { AiMessage } from '../../../domain/ai/types'
import { toTextContent } from '../../interactions/build-run-interaction-request'
import type { ContextContributor, ContextContributorInput } from '../contracts'

const toAgentProfileMessages = (input: ContextContributorInput): AiMessage[] => {
  const profile = input.context.agentProfile

  if (!profile) {
    return []
  }

  const sections: string[] = []
  const instructions = profile.instructionsMd.trim()

  if (instructions.length > 0) {
    sections.push(['Instructions:', instructions].join('\n'))
  }

  if (profile.subagents.length > 0) {
    const subagentBlocks = profile.subagents.map((subagent) => {
      const toolLine =
        subagent.tools.length > 0
          ? `  tools: ${subagent.tools.map((tool) => tool.name).join(', ')}`
          : '  tools: none configured'

      return [
        `- alias: ${subagent.alias}`,
        `  name: ${subagent.childName ?? 'unnamed'}`,
        ...(subagent.childDescription ? [`  description: ${subagent.childDescription}`] : []),
        toolLine,
      ].join('\n')
    })

    sections.push(
      [
        'Allowed subagents for this run. Use the alias value as agentAlias when calling delegate_to_agent.',
        'If a delegated child returns kind="suspended", this run stays responsible for orchestration. Gather the missing input yourself, then call resume_delegated_run with the returned childRunId and waitId.',
        subagentBlocks.join('\n\n'),
      ].join('\n\n'),
    )
  }

  if (sections.length === 0) {
    return []
  }

  return [
    {
      content: [toTextContent(sections.join('\n\n'))],
      role: 'developer',
    },
  ]
}

export const agentProfileContributor: ContextContributor = {
  build: (input) => [
    {
      kind: 'agent_profile',
      messages: toAgentProfileMessages(input),
      volatility: 'stable',
    },
  ],
  id: 'agent-profile',
  order: 2,
}
