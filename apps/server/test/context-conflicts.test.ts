import assert from 'node:assert/strict'
import { describe, test } from 'vitest'

import { resolveContextArtifactConflicts } from '../src/application/context/conflicts'
import type {
  ContextArtifact,
  ContextArtifactMetadata,
  ContextAuthority,
} from '../src/application/context/contracts'

const artifact = (
  id: string,
  input: Partial<ContextArtifactMetadata> & {
    authority?: ContextAuthority
    conflictKey?: string | null
    dedupeKey?: string | null
    supersedes?: readonly string[]
  } = {},
): ContextArtifact => ({
  authority: input.authority ?? 'conversation',
  capturedAt: input.capturedAt ?? '2026-07-19T12:00:00.000Z',
  conflictKey: input.conflictKey ?? null,
  dedupeKey: input.dedupeKey ?? null,
  dependencies: input.dependencies ?? [],
  estimatedTokens: 10,
  expiresAt: input.expiresAt ?? null,
  id,
  layer: 'run_transcript',
  metadataStatus: 'declared',
  payload: { kind: 'messages', messages: [] },
  priority: input.priority ?? 50,
  provenance:
    input.provenance ??
    ({
      createdByRunId: 'run_1',
      sourceIds: [id],
      sourceType: 'runtime',
      sourceVersion: 'test/v1',
    } as const),
  requirement: input.requirement ?? 'preferred',
  sensitivity: input.sensitivity ?? 'private',
  supersedes: input.supersedes ?? [],
  transformation: input.transformation ?? { kind: 'none' },
  visibility: input.visibility ?? 'model',
  volatility: 'volatile',
})

describe('resolveContextArtifactConflicts', () => {
  test('uses authority only inside the same conflict key', () => {
    const summary = artifact('summary', { authority: 'summary', conflictKey: 'user.location' })
    const current = artifact('current', {
      authority: 'authoritative_integration',
      conflictKey: 'user.location',
    })
    const unrelated = artifact('unrelated', { authority: 'inferred', conflictKey: null })

    const result = resolveContextArtifactConflicts([summary, unrelated, current])

    assert.deepEqual(
      result.selected.map(({ id }) => id),
      ['unrelated', 'current'],
    )
    assert.deepEqual(
      result.dropped.map(({ artifact: { id }, reasonCodes }) => [id, reasonCodes]),
      [['summary', ['conflict_lower_authority']]],
    )
    assert.deepEqual(
      result.conflicts[0]?.winners.map(({ id }) => id),
      ['current'],
    )
  })

  test('keeps equal-authority conflicts instead of silently choosing', () => {
    const left = artifact('left', { conflictKey: 'project.status' })
    const right = artifact('right', { conflictKey: 'project.status' })

    const result = resolveContextArtifactConflicts([left, right])

    assert.deepEqual(
      result.selected.map(({ id }) => id),
      ['left', 'right'],
    )
    assert.equal(result.conflicts.length, 0)
  })

  test('resolves duplicates by authority, freshness, priority, token cost, then id', () => {
    const lowerAuthority = artifact('lower', {
      authority: 'observation',
      dedupeKey: 'fact:1',
    })
    const older = artifact('older', {
      authority: 'conversation',
      capturedAt: '2026-07-18T12:00:00.000Z',
      dedupeKey: 'fact:1',
      priority: 100,
    })
    const winner = artifact('winner', {
      authority: 'conversation',
      capturedAt: '2026-07-19T12:00:00.000Z',
      dedupeKey: 'fact:1',
    })

    const result = resolveContextArtifactConflicts([lowerAuthority, older, winner])

    assert.deepEqual(
      result.selected.map(({ id }) => id),
      ['winner'],
    )
    assert.ok(result.dropped.every(({ reasonCodes }) => reasonCodes.includes('duplicate')))
  })

  test('honors valid explicit supersession and rejects malformed graphs', () => {
    const old = artifact('old')
    const replacement = artifact('replacement', { supersedes: ['old'] })
    const result = resolveContextArtifactConflicts([old, replacement])

    assert.deepEqual(
      result.selected.map(({ id }) => id),
      ['replacement'],
    )
    assert.deepEqual(result.dropped[0]?.reasonCodes, ['superseded'])
    assert.throws(
      () => resolveContextArtifactConflicts([artifact('bad', { supersedes: ['missing'] })]),
      /missing artifact/,
    )
    assert.throws(
      () =>
        resolveContextArtifactConflicts([
          artifact('a', { supersedes: ['b'] }),
          artifact('b', { supersedes: ['a'] }),
        ]),
      /cycle/,
    )
  })

  test('is semantically deterministic and preserves supplied canonical order', () => {
    const a = artifact('a', { dedupeKey: 'same', priority: 10 })
    const b = artifact('b', { dedupeKey: 'same', priority: 20 })
    const c = artifact('c')

    const first = resolveContextArtifactConflicts([a, c, b])
    const second = resolveContextArtifactConflicts([c, b, a])

    assert.deepEqual(new Set(first.selected.map(({ id }) => id)), new Set(['b', 'c']))
    assert.deepEqual(new Set(second.selected.map(({ id }) => id)), new Set(['b', 'c']))
    assert.deepEqual(
      first.selected.map(({ id }) => id),
      ['c', 'b'],
    )
    assert.deepEqual(
      second.selected.map(({ id }) => id),
      ['c', 'b'],
    )
  })

  test('rejects duplicate candidate IDs', () => {
    assert.throws(
      () => resolveContextArtifactConflicts([artifact('same'), artifact('same')]),
      /Duplicate context resolution candidate/,
    )
  })
})
