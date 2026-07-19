import type { IndexedEntry } from './types'

const extensionBoost = (extension: string): number => {
  switch (extension) {
    case 'rs':
    case 'ts':
    case 'tsx':
    case 'svelte':
    case 'js':
    case 'jsx':
    case 'vue':
      return 50
    case 'py':
    case 'go':
    case 'java':
    case 'kt':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'cs':
      return 40
    case 'rb':
    case 'php':
    case 'swift':
    case 'scala':
    case 'clj':
      return 35
    case 'html':
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 30
    case 'json':
    case 'toml':
    case 'yaml':
    case 'yml':
      return 20
    case 'md':
    case 'txt':
    case 'rst':
      return 10
    default:
      return 0
  }
}

const fuzzyIndices = (
  target: string,
  query: string,
): { indices: number[]; score: number } | null => {
  if (!query) {
    return {
      indices: [],
      score: 0,
    }
  }

  const indices: number[] = []
  let queryIndex = 0

  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    if (target[targetIndex] !== query[queryIndex]) {
      continue
    }

    indices.push(targetIndex)
    queryIndex += 1

    if (queryIndex === query.length) {
      break
    }
  }

  if (queryIndex !== query.length) {
    return null
  }

  let score = query.length * 100

  for (let index = 0; index < indices.length; index += 1) {
    const matchedIndex = indices[index]
    const previousCharacter = matchedIndex > 0 ? target[matchedIndex - 1] : ''

    if (
      matchedIndex === 0 ||
      previousCharacter === '/' ||
      previousCharacter === '-' ||
      previousCharacter === '_' ||
      previousCharacter === '.' ||
      previousCharacter === ' '
    ) {
      score += 15
    }

    if (index > 0 && matchedIndex === indices[index - 1] + 1) {
      score += 25
    }
  }

  const exactIndex = target.indexOf(query)
  if (exactIndex >= 0) {
    score += 200

    if (exactIndex === 0) {
      score += 200
    }
  }

  return {
    indices,
    score,
  }
}

const dedupeSortedIndices = (indices: readonly number[]): number[] =>
  [...new Set(indices)].sort((left, right) => left - right)

const mapNameIndicesToPathIndices = (entry: IndexedEntry, indices: readonly number[]): number[] => {
  const startIndex = entry.relativePath.length - entry.fileName.length
  return indices.map((index) => startIndex + index)
}

const recencyBoost = (mtimeMs: number, nowMs: number): number => {
  if (mtimeMs <= 0) {
    return 0
  }

  const ageHours = Math.max(0, nowMs - mtimeMs) / (1000 * 60 * 60)

  return Math.round(500 * 0.97 ** ageHours)
}

export const scoreEntry = (
  entry: IndexedEntry,
  normalizedQuery: string,
  nowMs: number = Date.now(),
): { matchIndices: number[]; score: number } | null => {
  if (!normalizedQuery) {
    return {
      matchIndices: [],
      score: recencyBoost(entry.mtimeMs, nowMs) + extensionBoost(entry.extension) - entry.depth * 5,
    }
  }

  if (normalizedQuery.includes(' ')) {
    const parts = normalizedQuery.split(/\s+/).filter(Boolean)

    if (parts.length === 0) {
      return {
        matchIndices: [],
        score:
          recencyBoost(entry.mtimeMs, nowMs) + extensionBoost(entry.extension) - entry.depth * 5,
      }
    }

    let score = 0
    const collectedIndices: number[] = []

    for (const part of parts) {
      const match = fuzzyIndices(entry.pathLower, part)

      if (!match) {
        return null
      }

      score += match.score
      collectedIndices.push(...match.indices)
    }

    const lastPart = parts.at(-1) ?? ''
    if (lastPart) {
      if (entry.nameLower.includes(lastPart)) {
        score += 5_000
      }

      if (entry.nameLower.startsWith(lastPart)) {
        score += 10_000
      }
    }

    score += extensionBoost(entry.extension)
    score -= entry.depth * 10

    return {
      matchIndices: dedupeSortedIndices(collectedIndices),
      score,
    }
  }

  const queryIsFilenameLike = normalizedQuery.includes('.') || !normalizedQuery.includes('/')
  const nameMatch = fuzzyIndices(entry.nameLower, normalizedQuery)
  const pathMatch = fuzzyIndices(entry.pathLower, normalizedQuery)

  if (!nameMatch && !pathMatch) {
    return null
  }

  if (!nameMatch && pathMatch && queryIsFilenameLike) {
    if (!entry.pathLower.includes(normalizedQuery)) {
      return null
    }
  }

  let score = 0
  const collectedIndices: number[] = []

  if (nameMatch && pathMatch) {
    score += nameMatch.score * 2 + pathMatch.score
    collectedIndices.push(
      ...pathMatch.indices,
      ...mapNameIndicesToPathIndices(entry, nameMatch.indices),
    )
  } else if (nameMatch) {
    score += nameMatch.score * 2
    collectedIndices.push(...mapNameIndicesToPathIndices(entry, nameMatch.indices))
  } else if (pathMatch) {
    score += pathMatch.score
    collectedIndices.push(...pathMatch.indices)
  }

  if (entry.nameLower === normalizedQuery) {
    score += 100_000
  }

  if (entry.nameLower.startsWith(normalizedQuery)) {
    score += 10_000
  }

  if (entry.nameLower.includes(normalizedQuery)) {
    score += 1_000
  }

  score += extensionBoost(entry.extension)
  score -= entry.depth * 10

  return {
    matchIndices: dedupeSortedIndices(collectedIndices),
    score,
  }
}
