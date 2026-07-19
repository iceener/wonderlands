import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildContextArtifacts,
  projectContextArtifactMessages,
} from '../src/application/context/artifacts'
import type { ContextContributorInput } from '../src/application/context/contracts'
import { observationMemoryContributor } from '../src/application/context/contributors/observation-memory'
import { reflectionMemoryContributor } from '../src/application/context/contributors/reflection-memory'
import {
  pendingWaitsContributor,
  sessionMetadataContributor,
  systemPromptContributor,
} from '../src/application/context/contributors/reserved-layers'
import { runTranscriptContributor } from '../src/application/context/contributors/run-transcript'
import { summaryMemoryContributor } from '../src/application/context/contributors/summary-memory'
import { visibleHistoryFallbackContributor } from '../src/application/context/contributors/visible-history-fallback'
import {
  buildContextContributions,
  defineContextContributors,
} from '../src/application/context/registry'
import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import type { ThreadContextData } from '../src/application/interactions/context-bundle'
import type { ItemRecord } from '../src/domain/runtime/item-repository'
import {
  createContext,
  createMessageItem,
  createObservation,
  createReflection,
  createVisibleMessage,
  summaryFixture,
  textAndImageFilesFixture,
} from './fixtures/context/context-assembly'

const contributors = defineContextContributors([
  systemPromptContributor,
  sessionMetadataContributor,
  summaryMemoryContributor,
  reflectionMemoryContributor,
  observationMemoryContributor,
  runTranscriptContributor,
  visibleHistoryFallbackContributor,
  pendingWaitsContributor,
])

const createInput = (
  context: ThreadContextData,
  overrides: ContextContributorInput['overrides'] = {},
): ContextContributorInput => ({
  activeTools: [],
  context,
  mcpCatalog: null,
  mcpMode: 'direct',
  nativeTools: [],
  overrides,
})

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }

    Object.freeze(value)
  }

  return value
}

const toLegacyContribution = (
  context: ThreadContextData,
  overrides: ContextContributorInput['overrides'] = {},
) => {
  const selectedIndexes = [0, 6, 7, 8, 9, 10, 11, 14]
  const layers = assembleThreadInteractionRequest({
    activeTools: [],
    context,
    nativeTools: [],
    overrides: { ...overrides },
  }).bundle.layers

  return selectedIndexes.map((index) => {
    const layer = layers[index]

    assert.ok(layer)

    return {
      kind: layer.kind,
      messages: layer.messages,
      volatility: layer.volatility,
    }
  })
}

const createReasoningItem = (): ItemRecord => ({
  ...createMessageItem({
    id: 'itm_contributor_reasoning',
    role: 'assistant',
    sequence: 1,
    text: 'unused',
  }),
  content: null,
  providerPayload: {
    encryptedContent: 'opaque-reasoning',
    provider: 'openai',
    providerItemId: 'rs_contributor_reasoning',
  },
  role: null,
  summary: [{ text: 'Preserve provider-specific reasoning.', type: 'summary_text' }],
  type: 'reasoning',
})

describe('memory, transcript, fallback, and reserved context contributors', () => {
  test('publishes the reserved empty layers at their exact order and volatility', () => {
    assert.deepEqual(
      [systemPromptContributor, sessionMetadataContributor, pendingWaitsContributor].map(
        ({ id, order }) => ({ id, order }),
      ),
      [
        { id: 'system-prompt', order: 1 },
        { id: 'session-metadata', order: 7 },
        { id: 'pending-waits', order: 15 },
      ],
    )
    assert.deepEqual(systemPromptContributor.build(createInput(createContext())), [
      { kind: 'system_prompt', messages: [], volatility: 'stable' },
    ])
    assert.deepEqual(sessionMetadataContributor.build(createInput(createContext())), [
      { kind: 'session_metadata', messages: [], volatility: 'stable' },
    ])
    assert.deepEqual(pendingWaitsContributor.build(createInput(createContext())), [
      { kind: 'pending_waits', messages: [], volatility: 'volatile' },
    ])
  })

  test('declares complete metadata for reserved and empty memory/transcript layers', () => {
    const input = deepFreeze(createInput(createContext()))
    const contributions = buildContextContributions(contributors, input)
    const artifacts = buildContextArtifacts(contributors, input, { validationMode: 'strict' })

    assert.deepEqual(projectContextArtifactMessages(artifacts), contributions)
    assert.deepEqual(
      artifacts.map((artifact) => ({
        authority: artifact.authority,
        dedupeKey: artifact.dedupeKey,
        metadataStatus: artifact.metadataStatus,
        requirement: artifact.requirement,
        sensitivity: artifact.sensitivity,
        sourceIds: artifact.provenance.sourceIds,
        sourceType: artifact.provenance.sourceType,
        visibility: artifact.visibility,
      })),
      [
        {
          authority: 'conversation',
          dedupeKey: 'system-prompt',
          metadataStatus: 'declared',
          requirement: 'optional',
          sensitivity: 'private',
          sourceIds: ['run_context_characterization'],
          sourceType: 'runtime',
          visibility: 'model',
        },
        {
          authority: 'conversation',
          dedupeKey: 'session-metadata',
          metadataStatus: 'declared',
          requirement: 'optional',
          sensitivity: 'private',
          sourceIds: ['run_context_characterization'],
          sourceType: 'runtime',
          visibility: 'model',
        },
        {
          authority: 'summary',
          dedupeKey: 'summary-memory',
          metadataStatus: 'declared',
          requirement: 'preferred',
          sensitivity: 'private',
          sourceIds: [],
          sourceType: 'memory_summary',
          visibility: 'model',
        },
        {
          authority: 'reflection',
          dedupeKey: 'reflection-memory',
          metadataStatus: 'declared',
          requirement: 'preferred',
          sensitivity: 'private',
          sourceIds: [],
          sourceType: 'memory_reflection',
          visibility: 'model',
        },
        {
          authority: 'observation',
          dedupeKey: 'observation-memory',
          metadataStatus: 'declared',
          requirement: 'preferred',
          sensitivity: 'private',
          sourceIds: [],
          sourceType: 'memory_observation',
          visibility: 'model',
        },
        {
          authority: 'conversation',
          dedupeKey: 'run-transcript',
          metadataStatus: 'declared',
          requirement: 'preferred',
          sensitivity: 'restricted',
          sourceIds: [],
          sourceType: 'runtime',
          visibility: 'model',
        },
        {
          authority: 'conversation',
          dedupeKey: 'visible-history-fallback',
          metadataStatus: 'declared',
          requirement: 'preferred',
          sensitivity: 'restricted',
          sourceIds: [],
          sourceType: 'runtime',
          visibility: 'model',
        },
        {
          authority: 'conversation',
          dedupeKey: 'pending-waits',
          metadataStatus: 'declared',
          requirement: 'optional',
          sensitivity: 'private',
          sourceIds: ['run_context_characterization'],
          sourceType: 'runtime',
          visibility: 'model',
        },
      ],
    )
    assert.ok(
      artifacts.every(
        (artifact) =>
          artifact.capturedAt === input.context.run.createdAt &&
          artifact.expiresAt === null &&
          artifact.priority === 0 &&
          artifact.conflictKey === null &&
          artifact.dependencies.length === 0 &&
          artifact.supersedes.length === 0 &&
          artifact.transformation.kind === 'none',
      ),
    )
    assert.deepEqual(
      buildContextArtifacts(contributors, input, { validationMode: 'strict' }).map(
        (artifact) => artifact.id,
      ),
      artifacts.map((artifact) => artifact.id),
    )
  })

  test('declares durable, sorted provenance without changing strict artifact projection', () => {
    const secondObservation = {
      ...createObservation(),
      id: 'mem_observation_alpha',
    }
    const input = deepFreeze(
      createInput(
        createContext({
          activeReflection: createReflection(),
          items: [
            createMessageItem({
              id: 'itm_transcript_zulu',
              role: 'assistant',
              sequence: 2,
              text: 'Second item.',
            }),
            createMessageItem({
              id: 'itm_transcript_alpha',
              role: 'user',
              sequence: 1,
              text: 'First item.',
            }),
          ],
          observations: [createObservation(), secondObservation],
          summary: summaryFixture,
          visibleFiles: [...textAndImageFilesFixture].reverse(),
          visibleMessages: [
            createVisibleMessage({ id: 'msg_visible_zulu', sequence: 2, text: 'Second visible.' }),
            createVisibleMessage({ id: 'msg_visible_alpha', sequence: 1, text: 'First visible.' }),
          ],
        }),
      ),
    )
    const before = JSON.stringify(input.context)
    const contributions = buildContextContributions(contributors, input)
    const artifacts = buildContextArtifacts(contributors, input, { validationMode: 'strict' })
    const [system, session, summary, reflection, observations, transcript, visible, waits] =
      artifacts

    assert.deepEqual(projectContextArtifactMessages(artifacts), contributions)
    assert.deepEqual(summary?.provenance, {
      createdByRunId: 'run_context_characterization',
      sourceIds: ['sum_context_characterization'],
      sourceType: 'memory_summary',
      sourceVersion: null,
    })
    assert.deepEqual(reflection?.provenance, {
      createdByRunId: 'run_context_characterization',
      sourceIds: ['mem_reflection_characterization'],
      sourceType: 'memory_reflection',
      sourceVersion: '1',
    })
    assert.deepEqual(observations?.provenance, {
      createdByRunId: 'run_context_characterization',
      sourceIds: ['mem_observation_alpha', 'mem_observation_characterization'],
      sourceType: 'memory_observation',
      sourceVersion: null,
    })
    assert.deepEqual(transcript?.provenance, {
      createdByRunId: 'run_context_characterization',
      sourceIds: ['itm_transcript_alpha', 'itm_transcript_zulu'],
      sourceType: 'runtime',
      sourceVersion: '1',
    })
    assert.deepEqual(visible?.provenance, {
      createdByRunId: null,
      sourceIds: [
        'fil_characterization_diagram',
        'fil_characterization_notes',
        'msg_visible_alpha',
        'msg_visible_zulu',
      ],
      sourceType: 'runtime',
      sourceVersion: null,
    })
    assert.deepEqual(
      [system, session, waits].map((artifact) => artifact?.provenance),
      [system, session, waits].map(() => ({
        createdByRunId: 'run_context_characterization',
        sourceIds: ['run_context_characterization'],
        sourceType: 'runtime',
        sourceVersion: '1',
      })),
    )
    assert.equal(summary?.transformation.kind, 'none')
    assert.deepEqual(
      artifacts.map((artifact) => artifact.authority),
      [
        'conversation',
        'conversation',
        'summary',
        'reflection',
        'observation',
        'conversation',
        'conversation',
        'conversation',
      ],
    )
    assert.equal(JSON.stringify(input.context), before)
  })

  test('preserves summary, reflection, and observation roles, text, and source order', () => {
    const secondObservation = {
      ...createObservation(),
      id: 'mem_observation_second',
      content: {
        observations: [{ text: 'Keep the second record after the first.' }],
        source: 'observer_v1' as const,
      },
    }
    const input = deepFreeze(
      createInput(
        createContext({
          activeReflection: createReflection(),
          observations: [createObservation(), secondObservation],
          summary: summaryFixture,
        }),
      ),
    )
    const before = JSON.stringify(input)
    const output = buildContextContributions(
      [summaryMemoryContributor, reflectionMemoryContributor, observationMemoryContributor],
      input,
    )

    assert.deepEqual(output, [
      {
        kind: 'summary_memory',
        messages: [
          {
            content: [
              {
                text: 'Earlier conversation established a behavior-preserving migration plan.',
                type: 'text',
              },
            ],
            role: 'developer',
          },
        ],
        volatility: 'stable',
      },
      {
        kind: 'run_local_memory',
        messages: [
          {
            content: [
              {
                text:
                  'Compressed reflection from earlier run-local observations:\n\n' +
                  'Keep the migration behavior-first and preserve request ordering.',
                type: 'text',
              },
            ],
            role: 'developer',
          },
        ],
        volatility: 'stable',
      },
      {
        kind: 'run_local_memory',
        messages: [
          {
            content: [
              {
                text:
                  'Durable observations from earlier sealed main-thread context:\n\n' +
                  'Observation 1:\nThe caller expects deterministic layer order.\n\n' +
                  'Observation 2:\nVolatile transcript changes must not invalidate the stable prefix.',
                type: 'text',
              },
            ],
            role: 'developer',
          },
          {
            content: [
              {
                text:
                  'Durable observations from earlier sealed main-thread context:\n\n' +
                  'Observation 1:\nKeep the second record after the first.',
                type: 'text',
              },
            ],
            role: 'developer',
          },
        ],
        volatility: 'stable',
      },
    ])
    assert.equal(JSON.stringify(input), before)
  })

  test('uses override-first provider resolution and falls back only for an empty transcript without summary', () => {
    const base = createContext()
    const context = createContext({
      items: [createReasoningItem()],
      run: {
        ...base.run,
        configSnapshot: { provider: 'google' },
      },
      visibleMessages: [createVisibleMessage({ text: 'Visible fallback text.' })],
    })
    const googleInput = deepFreeze(createInput(context))
    const before = JSON.stringify(googleInput)

    assert.deepEqual(runTranscriptContributor.build(googleInput), [
      { kind: 'run_transcript', messages: [], volatility: 'volatile' },
    ])
    assert.deepEqual(visibleHistoryFallbackContributor.build(googleInput), [
      {
        kind: 'visible_message_history',
        messages: [
          {
            content: [{ text: 'Visible fallback text.', type: 'text' }],
            role: 'user',
          },
        ],
        volatility: 'volatile',
      },
    ])

    const overrideInput = deepFreeze(createInput(context, { provider: 'openai' }))

    assert.deepEqual(runTranscriptContributor.build(overrideInput), [
      {
        kind: 'run_transcript',
        messages: [
          {
            content: [
              {
                encryptedContent: 'opaque-reasoning',
                id: 'rs_contributor_reasoning',
                summary: [{ text: 'Preserve provider-specific reasoning.', type: 'summary_text' }],
                type: 'reasoning',
              },
            ],
            role: 'assistant',
          },
        ],
        volatility: 'volatile',
      },
    ])
    assert.deepEqual(visibleHistoryFallbackContributor.build(overrideInput), [
      { kind: 'visible_message_history', messages: [], volatility: 'volatile' },
    ])
    assert.deepEqual(
      visibleHistoryFallbackContributor.build(
        createInput(
          createContext({ summary: summaryFixture, visibleMessages: context.visibleMessages }),
        ),
      ),
      [{ kind: 'visible_message_history', messages: [], volatility: 'volatile' }],
    )
    assert.equal(JSON.stringify(googleInput), before)
  })

  test('matches the owned legacy layers for memory plus transcript and visible fallback scenarios', () => {
    const memoryAndTranscript = createContext({
      activeReflection: createReflection(),
      items: [
        createMessageItem({
          id: 'itm_contributor_live_tail',
          role: 'user',
          sequence: 9,
          text: 'Current live tail.',
        }),
      ],
      observations: [createObservation()],
      summary: summaryFixture,
      visibleMessages: [createVisibleMessage({ text: 'Already summarized.' })],
    })
    const visibleFallback = createContext({
      visibleMessages: [
        createVisibleMessage({ sequence: 1, text: 'Fallback user message.' }),
        createVisibleMessage({
          authorKind: 'assistant',
          id: 'msg_contributor_fallback_assistant',
          sequence: 2,
          text: 'Fallback assistant message.',
        }),
      ],
    })

    assert.deepEqual(
      buildContextContributions(contributors, deepFreeze(createInput(memoryAndTranscript))),
      toLegacyContribution(memoryAndTranscript),
    )
    assert.deepEqual(
      buildContextContributions(contributors, deepFreeze(createInput(visibleFallback))),
      toLegacyContribution(visibleFallback),
    )
  })
})
