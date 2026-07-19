import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import { createContextPlanningBudget } from '../src/application/context/budget'
import type { ContextArtifact } from '../src/application/context/contracts'
import { planContextArtifacts } from '../src/application/context/planner'

const candidate = (
  id: string,
  estimatedTokens: number,
  requirement: ContextArtifact['requirement'] = 'preferred',
  priority = 0,
): ContextArtifact => ({
  authority: 'conversation',
  capturedAt: '2026-07-19T12:00:00.000Z',
  conflictKey: null,
  dedupeKey: null,
  dependencies: [],
  estimatedTokens,
  expiresAt: null,
  id,
  layer: 'run_transcript',
  metadataStatus: 'declared',
  payload: { kind: 'messages', messages: [] },
  priority,
  provenance: {
    createdByRunId: 'run_1',
    sourceIds: [id],
    sourceType: 'runtime',
    sourceVersion: 'test/v1',
  },
  requirement,
  sensitivity: 'private',
  supersedes: [],
  transformation: { kind: 'none' },
  visibility: 'model',
  volatility: 'volatile',
})

const NOW = '2026-07-19T13:00:00.000Z'

describe('context planning budget', () => {
  test('reserves output and wrapper overhead without double-counting artifacts', () => {
    assert.deepEqual(
      createContextPlanningBudget({
        inputTokenLimit: 100,
        providerOverheadTokens: 10,
        reservedOutputTokens: 20,
      }),
      {
        availableInputTokens: 70,
        inputTokenLimit: 100,
        providerOverheadTokens: 10,
        reservedOutputTokens: 20,
      },
    )
  })

  test('rejects invalid budgets', () => {
    assert.throws(() => createContextPlanningBudget({ inputTokenLimit: -1 }), /non-negative/)
  })
})

describe('planContextArtifacts', () => {
  test('always selects mandatory context and reports capacity instead of dropping it', () => {
    const required = candidate('required', 60, 'mandatory')
    const tooSmall = planContextArtifacts(
      [required],
      createContextPlanningBudget({ inputTokenLimit: 50 }),
      { now: NOW },
    )
    assert.equal(tooSmall.outcome, 'capacity_error')
    if (tooSmall.outcome === 'capacity_error') {
      assert.equal(tooSmall.requiredTokens, 60)
      assert.equal(tooSmall.availableTokens, 50)
    }
  })

  test('selects all artifacts under an abundant or exact budget', () => {
    const artifacts = [candidate('a', 10, 'mandatory'), candidate('b', 20)]
    for (const limit of [30, 100]) {
      const result = planContextArtifacts(
        artifacts,
        createContextPlanningBudget({ inputTokenLimit: limit }),
        { now: NOW },
      )
      assert.equal(result.outcome, 'planned')
      if (result.outcome === 'planned') {
        assert.deepEqual(
          result.selected.map(({ id }) => id),
          ['a', 'b'],
        )
        assert.equal(result.dropped.length, 0)
      }
    }
  })

  test('uses deterministic utility and returns selected in canonical input order', () => {
    const low = candidate('low', 20, 'optional', 0)
    const preferred = candidate('preferred', 20, 'preferred', 0)
    const high = candidate('high', 20, 'preferred', 100)
    const result = planContextArtifacts(
      [low, preferred, high],
      createContextPlanningBudget({ inputTokenLimit: 40 }),
      { now: NOW },
    )
    assert.equal(result.outcome, 'planned')
    if (result.outcome === 'planned') {
      assert.deepEqual(
        result.selected.map(({ id }) => id),
        ['preferred', 'high'],
      )
      assert.deepEqual(
        result.dropped.map(({ artifact: { id } }) => id),
        ['low'],
      )
    }
  })

  test('uses artifact id as final tie-break while preserving supplied output order', () => {
    const b = candidate('b', 10)
    const a = candidate('a', 10)
    const first = planContextArtifacts(
      [b, a],
      createContextPlanningBudget({ inputTokenLimit: 10 }),
      { now: NOW },
    )
    assert.equal(first.outcome, 'planned')
    if (first.outcome === 'planned')
      assert.deepEqual(
        first.selected.map(({ id }) => id),
        ['a'],
      )
  })

  test('handles zero-token candidates and validates duplicates/timestamps', () => {
    const zero = candidate('zero', 0, 'optional')
    const result = planContextArtifacts(
      [zero],
      createContextPlanningBudget({ inputTokenLimit: 0 }),
      { now: NOW },
    )
    assert.equal(result.outcome, 'planned')
    if (result.outcome === 'planned')
      assert.deepEqual(
        result.selected.map(({ id }) => id),
        ['zero'],
      )

    assert.throws(
      () =>
        planContextArtifacts(
          [candidate('same', 1), candidate('same', 1)],
          createContextPlanningBudget({ inputTokenLimit: 10 }),
          { now: NOW },
        ),
      /Duplicate context planning artifact/,
    )
    assert.throws(
      () =>
        planContextArtifacts([zero], createContextPlanningBudget({ inputTokenLimit: 1 }), {
          now: 'bad',
        }),
      /valid ISO/,
    )
  })

  test('shuffled candidates produce the same selected set', () => {
    const a = candidate('a', 10, 'preferred', 10)
    const b = candidate('b', 10, 'preferred', 20)
    const c = candidate('c', 10, 'optional', 100)
    const budget = createContextPlanningBudget({ inputTokenLimit: 20 })
    const one = planContextArtifacts([a, b, c], budget, { now: NOW })
    const two = planContextArtifacts([c, b, a], budget, { now: NOW })
    assert.equal(one.outcome, 'planned')
    assert.equal(two.outcome, 'planned')
    if (one.outcome === 'planned' && two.outcome === 'planned') {
      assert.deepEqual(new Set(one.selected.map(({ id }) => id)), new Set(['a', 'b']))
      assert.deepEqual(new Set(two.selected.map(({ id }) => id)), new Set(['a', 'b']))
    }
  })
})
