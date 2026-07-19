import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import type {
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

const contributor = (
  id: string,
  order: number,
  build: ContextContributor['build'] = () => [contribution(id)],
): ContextContributor => ({ build, id, order })

describe('static context contributor registry', () => {
  test('sorts deterministically by unique explicit order and ignores empty outputs', () => {
    const calls: string[] = []
    const definitions = [
      contributor('third', 30, () => {
        calls.push('third')
        return [contribution('third')]
      }),
      contributor('empty', 20, () => {
        calls.push('empty')
        return []
      }),
      contributor('first', 10, () => {
        calls.push('first')
        return [contribution('first')]
      }),
    ]
    const originalDefinitionOrder = definitions.map(({ id }) => id)
    const registry = defineContextContributors(definitions)
    const output = buildContextContributions(registry, createInput())

    assert.deepEqual(
      registry.map(({ id }) => id),
      ['first', 'empty', 'third'],
    )
    assert.deepEqual(
      definitions.map(({ id }) => id),
      originalDefinitionOrder,
    )
    assert.deepEqual(calls, ['first', 'empty', 'third'])
    assert.deepEqual(
      output.map((entry) => entry.messages[0]?.content[0]),
      [
        { text: 'first', type: 'text' },
        { text: 'third', type: 'text' },
      ],
    )
    assert.equal(Object.isFrozen(registry), true)
    assert.equal(Object.isFrozen(output), true)
  })

  test('rejects duplicate contributor ids and orders', () => {
    assert.throws(
      () => defineContextContributors([contributor('profile', 10), contributor('profile', 20)]),
      /Duplicate context contributor id: "profile"/,
    )
    assert.throws(
      () => defineContextContributors([contributor('profile', 10), contributor('garden', 10)]),
      /Duplicate context contributor order: 10/,
    )
  })

  test('passes the same immutable input snapshot without mutating it', () => {
    const input = createInput()
    const before = JSON.stringify(input)
    const seenInputs: ContextContributorInput[] = []
    const registry = defineContextContributors([
      contributor('reader-one', 1, (received) => {
        seenInputs.push(received)
        void received.context.run.task
        return []
      }),
      contributor('reader-two', 2, (received) => {
        seenInputs.push(received)
        void received.context.visibleMessages.length
        return []
      }),
    ])

    assert.deepEqual(buildContextContributions(registry, input), [])
    assert.deepEqual(seenInputs, [input, input])
    assert.equal(JSON.stringify(input), before)
  })

  test('keeps the initial explicit registry empty and behavior-neutral', () => {
    assert.deepEqual(contextContributors, [])
    assert.deepEqual(buildContextContributions(contextContributors, createInput()), [])
  })
})
