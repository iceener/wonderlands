import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildContextArtifacts,
  projectContextArtifactMessages,
} from '../src/application/context/artifacts'
import type { ContextContributorInput } from '../src/application/context/contracts'
import { agentProfileContributor } from '../src/application/context/contributors/agent-profile'
import type { AgentProfileContext } from '../src/application/interactions/context-bundle'
import { asAgentRevisionId } from '../src/shared/ids'
import { createContext } from './fixtures/context/context-assembly'

const createInput = (agentProfile: AgentProfileContext | null): ContextContributorInput => ({
  activeTools: [],
  context: createContext({ agentProfile }),
  mcpCatalog: null,
  mcpMode: 'direct',
  nativeTools: [],
  overrides: {},
})

describe('agent profile context contributor', () => {
  test('uses the current agent-profile layer identity, order, and empty behavior', () => {
    assert.equal(agentProfileContributor.id, 'agent-profile')
    assert.equal(agentProfileContributor.order, 2)
    assert.deepEqual(agentProfileContributor.build(createInput(null)), [
      {
        kind: 'agent_profile',
        messages: [],
        volatility: 'stable',
      },
    ])

    assert.deepEqual(
      agentProfileContributor.build(
        createInput({
          instructionsMd: ' \n ',
          revisionId: asAgentRevisionId('agr_empty_profile'),
          subagents: [],
        }),
      ),
      [
        {
          kind: 'agent_profile',
          messages: [],
          volatility: 'stable',
        },
      ],
    )
  })

  test('declares deterministic restricted provenance for the active agent revision and run', () => {
    const revisionId = asAgentRevisionId('agr_metadata_profile')
    const input = createInput({
      instructionsMd: 'Follow the configured profile.',
      revisionId,
      subagents: [],
    })
    const first = buildContextArtifacts([agentProfileContributor], input, {
      validationMode: 'strict',
    })
    const second = buildContextArtifacts([agentProfileContributor], input, {
      validationMode: 'strict',
    })
    const artifact = first[0]

    assert.ok(artifact)
    assert.equal(artifact.id, second[0]?.id)
    assert.equal(artifact.metadataStatus, 'declared')
    assert.equal(artifact.authority, 'agent_configuration')
    assert.equal(artifact.capturedAt, input.context.run.createdAt)
    assert.equal(artifact.conflictKey, null)
    assert.equal(artifact.dedupeKey, 'agent-profile')
    assert.equal(artifact.requirement, 'mandatory')
    assert.equal(artifact.sensitivity, 'restricted')
    assert.equal(artifact.visibility, 'model')
    assert.equal(artifact.volatility, 'stable')
    assert.deepEqual(artifact.provenance, {
      createdByRunId: String(input.context.run.id),
      sourceIds: [String(revisionId), String(input.context.run.id)],
      sourceType: 'agent_revision',
      sourceVersion: String(revisionId),
    })
    assert.deepEqual(projectContextArtifactMessages(first), agentProfileContributor.build(input))
  })

  test('declares valid runtime provenance for an empty profile layer', () => {
    const input = createInput(null)
    const [artifact] = buildContextArtifacts([agentProfileContributor], input, {
      validationMode: 'strict',
    })

    assert.ok(artifact)
    assert.equal(artifact.metadataStatus, 'declared')
    assert.deepEqual(artifact.provenance.sourceIds, [String(input.context.run.id)])
    assert.equal(artifact.provenance.sourceType, 'runtime')
    assert.deepEqual(
      projectContextArtifactMessages([artifact]),
      agentProfileContributor.build(input),
    )
  })

  test('preserves exact instruction and subagent guidance without mutating the profile', () => {
    const profile: AgentProfileContext = {
      instructionsMd: '  Route work to the best specialist.  \n',
      revisionId: asAgentRevisionId('agr_dispatcher_v1'),
      subagents: [
        {
          alias: 'tony',
          childAgentId: 'agt_tony',
          childDescription: 'API researcher focused on runtime behavior and tool wiring.',
          childName: 'Tony',
          childSlug: 'tony',
          delegationMode: 'async_join',
          tools: [
            {
              description: 'Search the web for public information.',
              kind: 'provider',
              name: 'web_search',
              title: null,
            },
            {
              description: 'Search the project repository.',
              kind: 'mcp',
              name: 'repo_search',
              title: 'Repo Search',
            },
          ],
        },
        {
          alias: 'quiet',
          childAgentId: 'agt_quiet',
          childDescription: '',
          childName: null,
          childSlug: 'quiet',
          delegationMode: 'async_join',
          tools: [],
        },
      ],
    }
    const input = createInput(profile)
    const before = JSON.stringify(input.context.agentProfile)

    assert.deepEqual(agentProfileContributor.build(input), [
      {
        kind: 'agent_profile',
        messages: [
          {
            content: [
              {
                text:
                  'Instructions:\n' +
                  'Route work to the best specialist.\n\n' +
                  'Allowed subagents for this run. Use the alias value as agentAlias when calling delegate_to_agent.\n\n' +
                  'If a delegated child returns kind="suspended", this run stays responsible for orchestration. Gather the missing input yourself, then call resume_delegated_run with the returned childRunId and waitId.\n\n' +
                  '- alias: tony\n' +
                  '  name: Tony\n' +
                  '  description: API researcher focused on runtime behavior and tool wiring.\n' +
                  '  tools: web_search, repo_search\n\n' +
                  '- alias: quiet\n' +
                  '  name: unnamed\n' +
                  '  tools: none configured',
                type: 'text',
              },
            ],
            role: 'developer',
          },
        ],
        volatility: 'stable',
      },
    ])
    assert.equal(JSON.stringify(input.context.agentProfile), before)
  })
})
