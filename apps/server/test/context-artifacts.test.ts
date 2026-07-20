import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildContextArtifacts,
  createDeterministicContextArtifactId,
  projectContextArtifactMessages,
} from '../src/application/context/artifacts'
import type {
  ContextArtifactMetadata,
  ContextContribution,
  ContextContributor,
  ContextContributorInput,
} from '../src/application/context/contracts'
import {
  buildContextContributions,
  contextContributors,
  defineContextContributors,
} from '../src/application/context/registry'
import { createContext } from './fixtures/context/context-assembly'

const createInput = (): ContextContributorInput => ({
  activeTools: [],
  context: createContext(),
  mcpCatalog: null,
  mcpMode: 'direct',
  nativeTools: [],
  overrides: {},
})

const contribution = (text: string): ContextContribution => ({
  kind: 'agent_profile',
  messages: [
    {
      content: [{ text, type: 'text' }],
      role: 'developer',
    },
  ],
  volatility: 'stable',
})

const declaredMetadata = (capturedAt: string): ContextArtifactMetadata => ({
  authority: 'agent_configuration',
  capturedAt,
  conflictKey: null,
  dedupeKey: 'agent-profile',
  dependencies: [],
  expiresAt: null,
  priority: 100,
  provenance: {
    createdByRunId: 'run_context_characterization',
    sourceIds: ['rev_context_characterization'],
    sourceType: 'agent_revision',
    sourceVersion: '7',
  },
  requirement: 'mandatory',
  sensitivity: 'private',
  supersedes: [],
  transformation: { kind: 'none' },
  visibility: 'model',
})

const contributor = (
  id: string,
  order: number,
  build: ContextContributor['build'] = () => [contribution(id)],
): ContextContributor => ({ build, id, order })

describe('context artifact shadow representation', () => {
  test('projects the complete static registry without changing provider-neutral messages', () => {
    const input = createInput()
    const contributions = buildContextContributions(contextContributors, input)
    const artifacts = buildContextArtifacts(contextContributors, input)

    assert.deepEqual(projectContextArtifactMessages(artifacts), contributions)
    assert.deepEqual(
      artifacts.map(({ layer, volatility }) => [layer, volatility]),
      contributions.map(({ kind, volatility }) => [kind, volatility]),
    )
  })

  test('uses stable content-addressed IDs and detects duplicate artifacts', () => {
    const input = createInput()
    const registry = defineContextContributors([contributor('profile', 10)])
    const first = buildContextArtifacts(registry, input)
    const second = buildContextArtifacts(registry, input)

    assert.equal(first[0]?.id, second[0]?.id)
    assert.match(first[0]?.id ?? '', /^ctxa_[a-f0-9]{64}$/)
    assert.equal(
      createDeterministicContextArtifactId({ b: 2, a: { y: 2, x: 1 } }),
      createDeterministicContextArtifactId({ a: { x: 1, y: 2 }, b: 2 }),
    )

    const duplicateRegistry = defineContextContributors([
      contributor('duplicate', 10, () => [contribution('same'), contribution('same')]),
    ])
    assert.throws(
      () => buildContextArtifacts(duplicateRegistry, input),
      /Duplicate context artifact id .* from contributor "duplicate"/,
    )
  })

  test('rejects missing contributor metadata in strict mode and accepts declared metadata', () => {
    const input = createInput()
    const legacyRegistry = defineContextContributors([contributor('legacy', 10)])

    assert.throws(
      () => buildContextArtifacts(legacyRegistry, input, { validationMode: 'strict' }),
      /Context contributor "legacy" is missing artifact metadata in strict mode/,
    )

    const declaredContributor: ContextContributor = {
      ...contributor('declared', 10),
      describe: ({ input: received }) => declaredMetadata(received.context.run.createdAt),
    }
    const [artifact] = buildContextArtifacts(
      defineContextContributors([declaredContributor]),
      input,
      { validationMode: 'strict' },
    )

    assert.equal(artifact?.metadataStatus, 'declared')
    assert.equal(artifact?.provenance.sourceType, 'agent_revision')
    assert.equal(artifact?.capturedAt, input.context.run.createdAt)
  })
})
