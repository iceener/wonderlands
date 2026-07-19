import assert from 'node:assert/strict'
import { test } from 'vitest'

import { scoreEntry } from '../src/application/files/file-picker/scoring'
import { TopKHeap } from '../src/application/files/file-picker/top-k-heap'
import type { ScoredEntry, WorkspaceIndexedEntry } from '../src/application/files/file-picker/types'

const workspaceEntry = (
  relativePath: string,
  overrides: Partial<WorkspaceIndexedEntry> = {},
): WorkspaceIndexedEntry => {
  const fileName = relativePath.split('/').at(-1) ?? relativePath
  const depth = (relativePath.match(/\//g) ?? []).length
  const extension = fileName.includes('.') ? (fileName.split('.').at(-1) ?? '') : ''

  return {
    depth,
    extension,
    fileName,
    mtimeMs: 0,
    nameLower: fileName.toLowerCase(),
    pathLower: relativePath.toLowerCase(),
    relativePath,
    source: 'workspace',
    ...overrides,
  }
}

const scoredCandidate = (relativePath: string, score: number): ScoredEntry => ({
  entry: workspaceEntry(relativePath),
  matchIndices: [],
  score,
})

test('TopKHeap keeps only the highest-scoring candidates once at capacity', () => {
  const heap = new TopKHeap(2)

  heap.push(scoredCandidate('low.ts', 10))
  heap.push(scoredCandidate('high.ts', 90))
  heap.push(scoredCandidate('mid.ts', 50))

  const sorted = heap.toSortedArray().map((candidate) => candidate.entry.relativePath)

  assert.deepEqual(sorted, ['high.ts', 'mid.ts'])
})

test('TopKHeap breaks score ties by relativePath for deterministic ordering', () => {
  const heap = new TopKHeap(5)

  heap.push(scoredCandidate('b.ts', 10))
  heap.push(scoredCandidate('a.ts', 10))

  const sorted = heap.toSortedArray().map((candidate) => candidate.entry.relativePath)

  assert.deepEqual(sorted, ['a.ts', 'b.ts'])
})

test('TopKHeap with a zero max size never retains candidates', () => {
  const heap = new TopKHeap(0)

  heap.push(scoredCandidate('a.ts', 100))

  assert.deepEqual(heap.toSortedArray(), [])
})

test('scoreEntry returns a recency/extension-based score when the query is empty', () => {
  const entry = workspaceEntry('src/index.ts')
  const scored = scoreEntry(entry, '')

  assert.ok(scored)
  assert.deepEqual(scored?.matchIndices, [])
})

test('scoreEntry rejects entries that do not fuzzy-match the query', () => {
  const entry = workspaceEntry('src/index.ts')

  assert.equal(scoreEntry(entry, 'zzz'), null)
})

test('scoreEntry ranks exact filename matches above fuzzy path matches', () => {
  const exactEntry = workspaceEntry('src/widgets/button.ts')
  const fuzzyEntry = workspaceEntry('src/button-variants/other.ts')

  const exactScore = scoreEntry(exactEntry, 'button')
  const fuzzyScore = scoreEntry(fuzzyEntry, 'button')

  assert.ok(exactScore)
  assert.ok(fuzzyScore)
  assert.ok((exactScore?.score ?? 0) > (fuzzyScore?.score ?? 0))
})

test('scoreEntry supports space-separated multi-term queries matched against the full path', () => {
  const entry = workspaceEntry('src/agents/agent-management-service.ts')

  const matched = scoreEntry(entry, 'agents management')
  const unmatched = scoreEntry(entry, 'agents missing')

  assert.ok(matched)
  assert.equal(unmatched, null)
})

test('scoreEntry penalizes deeper paths relative to shallower ones for the same match quality', () => {
  const shallow = workspaceEntry('button.ts')
  const deep = workspaceEntry('a/b/c/d/button.ts')

  const shallowScore = scoreEntry(shallow, 'button')
  const deepScore = scoreEntry(deep, 'button')

  assert.ok(shallowScore)
  assert.ok(deepScore)
  assert.ok((shallowScore?.score ?? 0) > (deepScore?.score ?? 0))
})
