import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import {
  buildContextArtifacts,
  projectContextArtifactMessages,
} from '../src/application/context/artifacts'
import type {
  ContextArtifactMetadata,
  ContextContributor,
  ContextContributorInput,
} from '../src/application/context/contracts'
import {
  buildContextContributions,
  contextContributors,
  defineContextContributors,
} from '../src/application/context/registry'
import {
  buildThreadInteractionRequestFields,
  toFallbackTaskMessages,
} from '../src/application/context/request-fields'
import { assembleThreadInteractionRequest } from '../src/application/interactions/assemble-thread-interaction-request'
import {
  createContextBudgetReport,
  createContextLayer,
  type ThreadContextData,
} from '../src/application/interactions/context-bundle'
import type { ToolSpec } from '../src/application/tooling/tool-registry'
import type { AiMessage } from '../src/domain/ai/types'
import {
  createContext,
  createDelegatedItems,
  createMessageItem,
  createObservation,
  createReflection,
  createTool,
  createVisibleMessage,
  gardenContextFixture,
  mcpCatalogFixture,
  summaryFixture,
  textAndImageFilesFixture,
} from './fixtures/context/context-assembly'

const layerContract = [
  ['system_prompt', 'stable'],
  ['agent_profile', 'stable'],
  ['capability_guidance', 'stable'],
  ['garden_context', 'stable'],
  ['attachment_ref_rules', 'stable'],
  ['tool_context', 'stable'],
  ['session_metadata', 'stable'],
  ['summary_memory', 'stable'],
  ['run_local_memory', 'stable'],
  ['run_local_memory', 'stable'],
  ['run_transcript', 'volatile'],
  ['visible_message_history', 'volatile'],
  ['attachment_ref_context', 'volatile'],
  ['file_context', 'volatile'],
  ['pending_waits', 'volatile'],
] as const

interface AssemblyFixture {
  activeTools: ToolSpec[]
  context: ThreadContextData
  mcpCatalog: ContextContributorInput['mcpCatalog']
  mcpMode: ContextContributorInput['mcpMode']
  nativeTools: ContextContributorInput['nativeTools']
  overrides: ContextContributorInput['overrides']
}

const createFixture = (
  context = createContext(),
  overrides: Partial<AssemblyFixture> = {},
): AssemblyFixture => ({
  activeTools: [],
  context,
  mcpCatalog: null,
  mcpMode: 'direct',
  nativeTools: [],
  overrides: {},
  ...overrides,
})

const toContributorInput = (fixture: AssemblyFixture): ContextContributorInput => ({
  activeTools: fixture.activeTools,
  context: fixture.context,
  mcpCatalog: fixture.mcpCatalog,
  mcpMode: fixture.mcpMode,
  nativeTools: fixture.nativeTools,
  overrides: fixture.overrides,
})

const assembleFromArtifactProjection = (fixture: AssemblyFixture) => {
  const input = toContributorInput(fixture)
  const artifacts = buildContextArtifacts(contextContributors, input, {
    validationMode: 'strict',
  })
  const contributions = projectContextArtifactMessages(artifacts)
  const layers = contributions.map(({ kind, messages, volatility }) =>
    createContextLayer(kind, volatility, messages as AiMessage[]),
  )
  const requestFields = buildThreadInteractionRequestFields(fixture)
  const assembledMessages = layers.flatMap((layer) => layer.messages)
  const request = {
    ...requestFields,
    messages:
      assembledMessages.length > 0 ? assembledMessages : toFallbackTaskMessages(fixture.context),
  }
  const budget = createContextBudgetReport(layers, requestFields.maxOutputTokens ?? null, request)

  return { artifacts, budget, layers, request }
}

const representativeFixtures: ReadonlyArray<readonly [string, () => AssemblyFixture]> = [
  ['reserved empty layers and task fallback', () => createFixture()],
  [
    'visible history',
    () =>
      createFixture(
        createContext({
          visibleMessages: [
            createVisibleMessage({ sequence: 1, text: 'Hello, Quinn.' }),
            createVisibleMessage({
              authorKind: 'assistant',
              id: 'msg_parity_visible_2',
              sequence: 2,
              text: 'Ready to compare artifacts.',
            }),
          ],
        }),
      ),
  ],
  [
    'summary and transcript tail',
    () =>
      createFixture(
        createContext({
          items: [
            createMessageItem({
              id: 'itm_parity_tail',
              role: 'user',
              sequence: 9,
              text: 'Compare the live tail.',
            }),
          ],
          summary: summaryFixture,
        }),
      ),
  ],
  [
    'reflection and observation memory',
    () =>
      createFixture(
        createContext({
          activeReflection: createReflection(),
          observations: [createObservation()],
        }),
      ),
  ],
  [
    'text and image files',
    () => createFixture(createContext({ visibleFiles: textAndImageFilesFixture })),
  ],
  [
    'Garden and code-mode MCP context',
    () =>
      createFixture(createContext({ gardenContext: gardenContextFixture }), {
        activeTools: [
          createTool('get_garden_context'),
          createTool('search_tools'),
          createTool('get_tools'),
          createTool('execute'),
          createTool('docs__search', 'mcp'),
        ],
        mcpCatalog: mcpCatalogFixture,
        mcpMode: 'code',
        overrides: { maxOutputTokens: 777 },
      }),
  ],
  [
    'delegated call and result',
    () => createFixture(createContext({ items: createDelegatedItems() })),
  ],
]

describe('complete context artifact parity', () => {
  test.each(
    representativeFixtures,
  )('strictly declares all 15 artifacts and preserves the legacy assembly for %s', (_name, fixtureFactory) => {
    const fixture = fixtureFactory()
    const input = toContributorInput(fixture)
    const projected = assembleFromArtifactProjection(fixture)
    const legacy = assembleThreadInteractionRequest(fixture)

    assert.equal(projected.artifacts.length, 15)
    assert.ok(projected.artifacts.every((artifact) => artifact.metadataStatus === 'declared'))
    assert.deepEqual(
      projected.artifacts.map(({ layer, volatility }) => [layer, volatility]),
      layerContract,
    )
    assert.deepEqual(
      projectContextArtifactMessages(projected.artifacts),
      buildContextContributions(contextContributors, input),
    )
    assert.deepEqual(projected.layers, legacy.bundle.layers)
    assert.deepEqual(projected.request, legacy.request)
    assert.deepEqual(projected.budget, legacy.bundle.budget)
    assert.equal(projected.budget.stablePrefixHash, legacy.bundle.budget.stablePrefixHash)
  })

  test('keeps reflection and observation provenance distinct despite their shared legacy layer kind', () => {
    const fixture = createFixture(
      createContext({
        activeReflection: createReflection(),
        observations: [createObservation()],
      }),
    )
    const artifacts = buildContextArtifacts(contextContributors, toContributorInput(fixture), {
      validationMode: 'strict',
    })
    const memoryIdentities = [8, 9].map((index) => {
      const artifact = artifacts[index]
      const contributor = contextContributors[index]

      assert.ok(artifact)
      assert.ok(contributor)

      return {
        authority: artifact.authority,
        contributorId: contributor.id,
        dedupeKey: artifact.dedupeKey,
        layer: artifact.layer,
        sourceIds: artifact.provenance.sourceIds,
        sourceType: artifact.provenance.sourceType,
      }
    })

    assert.deepEqual(memoryIdentities, [
      {
        authority: 'reflection',
        contributorId: 'reflection-memory',
        dedupeKey: 'reflection-memory',
        layer: 'run_local_memory',
        sourceIds: ['mem_reflection_characterization'],
        sourceType: 'memory_reflection',
      },
      {
        authority: 'observation',
        contributorId: 'observation-memory',
        dedupeKey: 'observation-memory',
        layer: 'run_local_memory',
        sourceIds: ['mem_observation_characterization'],
        sourceType: 'memory_observation',
      },
    ])
  })

  test('keeps artifact IDs and order deterministic for normalized registry and tool inputs', () => {
    const tools = [createTool('execute'), createTool('generate_image')]
    const fixture = createFixture(createContext({ visibleFiles: textAndImageFilesFixture }), {
      activeTools: tools,
    })
    const shuffledFixture = createFixture(
      createContext({ visibleFiles: textAndImageFilesFixture }),
      { activeTools: [...tools].reverse() },
    )
    const normalizedShuffledRegistry = defineContextContributors([...contextContributors].reverse())
    const first = buildContextArtifacts(contextContributors, toContributorInput(fixture), {
      validationMode: 'strict',
    })
    const repeated = buildContextArtifacts(contextContributors, toContributorInput(fixture), {
      validationMode: 'strict',
    })
    const shuffledTools = buildContextArtifacts(
      contextContributors,
      toContributorInput(shuffledFixture),
      { validationMode: 'strict' },
    )
    const shuffledRegistry = buildContextArtifacts(
      normalizedShuffledRegistry,
      toContributorInput(fixture),
      { validationMode: 'strict' },
    )
    const ids = first.map((artifact) => artifact.id)

    assert.deepEqual(
      repeated.map((artifact) => artifact.id),
      ids,
    )
    assert.deepEqual(
      shuffledTools.map((artifact) => artifact.id),
      ids,
    )
    assert.deepEqual(
      shuffledRegistry.map((artifact) => artifact.id),
      ids,
    )
    assert.deepEqual(
      normalizedShuffledRegistry.map((contributor) => contributor.id),
      contextContributors.map((contributor) => contributor.id),
    )
  })

  // TODO(request-artifacts): extend parity to request-control artifacts and manifests once merged.
})

const cloneContributorWithMetadata = (
  id: string,
  update: (metadata: ContextArtifactMetadata) => ContextArtifactMetadata,
): ContextContributor => {
  const source = contextContributors[0]

  assert.ok(source?.describe)

  return {
    build: source.build,
    describe: (input) => update(source.describe!(input)),
    id,
    order: 1,
  }
}

describe('context artifact integration failures', () => {
  test('reports duplicate artifact identity with the responsible contributor', () => {
    const source = contextContributors[0]

    assert.ok(source?.describe)

    const duplicateContributor: ContextContributor = {
      build: (input) => {
        const contribution = source.build(input)[0]

        assert.ok(contribution)
        return [contribution, contribution]
      },
      describe: source.describe,
      id: 'duplicate-parity-artifact',
      order: 1,
    }

    assert.throws(
      () =>
        buildContextArtifacts([duplicateContributor], toContributorInput(createFixture()), {
          validationMode: 'strict',
        }),
      /Duplicate context artifact id "ctxa_[a-f0-9]{64}" from contributor "duplicate-parity-artifact"/,
    )
  })

  test.each([
    {
      contributor: cloneContributorWithMetadata('invalid-captured-at', (metadata) => ({
        ...metadata,
        capturedAt: 'not-a-timestamp',
      })),
      expected:
        /Context contributor "invalid-captured-at" has invalid capturedAt: "not-a-timestamp"/,
    },
    {
      contributor: cloneContributorWithMetadata('invalid-priority', (metadata) => ({
        ...metadata,
        priority: Number.POSITIVE_INFINITY,
      })),
      expected: /Context contributor "invalid-priority" priority must be finite/,
    },
    {
      contributor: cloneContributorWithMetadata('invalid-dependency', (metadata) => ({
        ...metadata,
        dependencies: [''],
      })),
      expected: /Context contributor "invalid-dependency" has an empty dependency reference/,
    },
    {
      contributor: cloneContributorWithMetadata('invalid-truncation', (metadata) => ({
        ...metadata,
        transformation: { includedBytes: 2, kind: 'truncated', originalBytes: 1 },
      })),
      expected: /Context contributor "invalid-truncation" has invalid truncation metadata/,
    },
  ])('reports explicit invalid metadata errors for $contributor.id', ({
    contributor,
    expected,
  }) => {
    assert.throws(
      () =>
        buildContextArtifacts([contributor], toContributorInput(createFixture()), {
          validationMode: 'strict',
        }),
      expected,
    )
  })

  test('reports an explicit strict-mode failure for an undeclared contributor', () => {
    const source = contextContributors[0]

    assert.ok(source)

    assert.throws(
      () =>
        buildContextArtifacts(
          [{ build: source.build, id: 'undeclared-parity-artifact', order: 1 }],
          toContributorInput(createFixture()),
          { validationMode: 'strict' },
        ),
      /Context contributor "undeclared-parity-artifact" is missing artifact metadata in strict mode/,
    )
  })
})
