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

test('TopKHeap retains the deterministic winner when tied candidates exceed capacity', () => {
  const heap = new TopKHeap(1)

  heap.push(scoredCandidate('z.ts', 10))
  heap.push(scoredCandidate('a.ts', 10))

  assert.deepEqual(
    heap.toSortedArray().map((candidate) => candidate.entry.relativePath),
    ['a.ts'],
  )
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

test('scoreEntry promotes filename matches over matches found only in directory names', () => {
  const filenameMatch = workspaceEntry('src/components/button-renderer.ts')
  const directoryMatch = workspaceEntry('src/button/renderer.ts')

  const filenameScore = scoreEntry(filenameMatch, 'button')
  const directoryScore = scoreEntry(directoryMatch, 'button')

  assert.ok(filenameScore)
  assert.ok(directoryScore)
  assert.ok((filenameScore?.score ?? 0) > (directoryScore?.score ?? 0))
})

test('scoreEntry strongly favors an explicitly entered path', () => {
  const intendedPath = workspaceEntry('apps/server/src/config.ts')
  const sameFilenameElsewhere = workspaceEntry('packages/config.ts')

  const intendedScore = scoreEntry(intendedPath, 'apps/server/config')
  const elsewhereScore = scoreEntry(sameFilenameElsewhere, 'apps/server/config')

  assert.ok(intendedScore)
  assert.equal(elsewhereScore, null)
})

test('scoreEntry accepts leading and Windows-style path separators', () => {
  const entry = workspaceEntry('apps/server/src/index.ts')

  assert.ok(scoreEntry(entry, '/apps/server/src'))
  assert.ok(scoreEntry(entry, String.raw`apps\server\src`))
})

test('scoreEntry uses the final path segment to rank filename matches', () => {
  const filenameMatch = workspaceEntry('apps/server/scoring.ts')
  const directoryOnlyMatch = workspaceEntry('apps/server/scoring/helpers.ts')

  const filenameScore = scoreEntry(filenameMatch, 'apps/server/scor')
  const directoryScore = scoreEntry(directoryOnlyMatch, 'apps/server/scor')

  assert.ok(filenameScore)
  assert.ok(directoryScore)
  assert.ok((filenameScore?.score ?? 0) > (directoryScore?.score ?? 0))
})

test('scoreEntry applies recency only as a secondary signal', () => {
  const nowMs = Date.UTC(2026, 6, 18)
  const recentPartial = workspaceEntry('src/button-helper.ts', { mtimeMs: nowMs })
  const staleExact = workspaceEntry('archive/button.ts', {
    mtimeMs: nowMs - 400 * 24 * 60 * 60 * 1000,
  })
  const recentSameMatch = workspaceEntry('deep/button.ts', { mtimeMs: nowMs })
  const staleSameMatch = workspaceEntry('deep/button.ts', {
    mtimeMs: nowMs - 90 * 24 * 60 * 60 * 1000,
  })

  const recentPartialScore = scoreEntry(recentPartial, 'button', nowMs)
  const staleExactScore = scoreEntry(staleExact, 'button', nowMs)
  const recentSameScore = scoreEntry(recentSameMatch, 'button', nowMs)
  const staleSameScore = scoreEntry(staleSameMatch, 'button', nowMs)

  assert.ok(recentPartialScore)
  assert.ok(staleExactScore)
  assert.ok(recentSameScore)
  assert.ok(staleSameScore)
  assert.ok((staleExactScore?.score ?? 0) > (recentPartialScore?.score ?? 0))
  assert.ok((recentSameScore?.score ?? 0) > (staleSameScore?.score ?? 0))
})
