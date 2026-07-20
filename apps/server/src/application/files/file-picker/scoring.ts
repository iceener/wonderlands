import type { IndexedEntry } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

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

const normalizeQuery = (query: string): string => {
  const normalizedSeparators = query
    .trim()
    .toLowerCase()
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')

  return normalizedSeparators.replace(/^\.\//u, '').replace(/^\/+/, '')
}

const recencyBoost = (mtimeMs: number, nowMs: number): number => {
  if (mtimeMs <= 0) {
    return 0
  }

  const ageDays = Math.max(0, nowMs - mtimeMs) / DAY_MS

  if (ageDays > 365) {
    return 0
  }

  // Recency breaks close matches without overpowering filename/path relevance.
  return Math.round(600 * 0.5 ** (ageDays / 30))
}

const pathCost = (entry: IndexedEntry, query: string): number => {
  const unmatchedPathLength = Math.max(0, entry.pathLower.length - query.length)

  return entry.depth * 100 + unmatchedPathLength * 3
}

const fileStem = (fileName: string): string => {
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
}

const hasBoundaryAt = (target: string, index: number): boolean =>
  index === 0 || '/-_. '.includes(target[index - 1] ?? '')

const scoreFilenameMatch = (
  entry: IndexedEntry,
  query: string,
): { indices: number[]; score: number } | null => {
  if (!query) {
    return null
  }

  const fuzzyMatch = fuzzyIndices(entry.nameLower, query)
  if (!fuzzyMatch) {
    return null
  }

  let score = 120_000 + fuzzyMatch.score * 3
  const substringIndex = entry.nameLower.indexOf(query)

  if (entry.nameLower === query) {
    score += 500_000
  } else if (fileStem(entry.nameLower) === query) {
    score += 450_000
  } else if (entry.nameLower.startsWith(query)) {
    score += 250_000
  } else if (substringIndex >= 0 && hasBoundaryAt(entry.nameLower, substringIndex)) {
    score += 180_000
  } else if (substringIndex >= 0) {
    score += 100_000
  }

  return {
    indices: mapNameIndicesToPathIndices(entry, fuzzyMatch.indices),
    score,
  }
}

const matchesPathComponents = (path: string, query: string): boolean => {
  const pathParts = path.split('/').filter(Boolean)
  const queryParts = query.split('/').filter(Boolean)
  let pathIndex = 0

  for (const queryPart of queryParts) {
    let matched = false

    while (pathIndex < pathParts.length) {
      const pathPart = pathParts[pathIndex] ?? ''
      pathIndex += 1

      if (fuzzyIndices(pathPart, queryPart)) {
        matched = true
        break
      }
    }

    if (!matched) {
      return false
    }
  }

  return queryParts.length > 0
}

const scorePathMatch = (
  entry: IndexedEntry,
  query: string,
  pathIntent: boolean,
): { indices: number[]; score: number } | null => {
  if (pathIntent && !matchesPathComponents(entry.pathLower, query)) {
    return null
  }

  const fuzzyMatch = fuzzyIndices(entry.pathLower, query)
  if (!fuzzyMatch) {
    return null
  }

  let score = fuzzyMatch.score
  const substringIndex = entry.pathLower.indexOf(query)

  if (entry.pathLower === query) {
    score += 700_000
  } else if (entry.pathLower.endsWith(`/${query}`)) {
    score += 500_000
  } else if (entry.pathLower.startsWith(query)) {
    score += pathIntent ? 300_000 : 80_000
  } else if (substringIndex >= 0 && hasBoundaryAt(entry.pathLower, substringIndex)) {
    score += pathIntent ? 160_000 : 70_000
  } else if (substringIndex >= 0) {
    score += pathIntent ? 100_000 : 40_000
  } else if (pathIntent) {
    score += 20_000
  }

  return {
    indices: fuzzyMatch.indices,
    score,
  }
}

const scoreSingleQuery = (
  entry: IndexedEntry,
  query: string,
  nowMs: number,
): { matchIndices: number[]; score: number } | null => {
  const pathIntent = query.includes('/')
  const filenameQuery = pathIntent ? (query.split('/').at(-1) ?? '') : query
  const filenameMatch = scoreFilenameMatch(entry, filenameQuery)
  const pathMatch = scorePathMatch(entry, query, pathIntent)

  if ((pathIntent && !pathMatch) || (!filenameMatch && !pathMatch)) {
    return null
  }

  return {
    matchIndices: dedupeSortedIndices([
      ...(pathMatch?.indices ?? []),
      ...(filenameMatch?.indices ?? []),
    ]),
    score:
      (pathMatch?.score ?? 0) +
      (filenameMatch?.score ?? 0) +
      recencyBoost(entry.mtimeMs, nowMs) +
      extensionBoost(entry.extension) -
      pathCost(entry, query),
  }
}

const scoreMultiTermQuery = (
  entry: IndexedEntry,
  query: string,
  nowMs: number,
): { matchIndices: number[]; score: number } | null => {
  const parts = query.split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return null
  }

  let score = 0
  const collectedIndices: number[] = []

  for (const part of parts) {
    const pathMatch = scorePathMatch(entry, part, part.includes('/'))
    if (!pathMatch) {
      return null
    }

    score += pathMatch.score
    collectedIndices.push(...pathMatch.indices)
  }

  const finalPart = parts.at(-1) ?? ''
  const filenameQuery = finalPart.split('/').at(-1) ?? ''
  const filenameMatch = scoreFilenameMatch(entry, filenameQuery)

  if (filenameMatch) {
    score += filenameMatch.score
    collectedIndices.push(...filenameMatch.indices)
  }

  return {
    matchIndices: dedupeSortedIndices(collectedIndices),
    score:
      score +
      recencyBoost(entry.mtimeMs, nowMs) +
      extensionBoost(entry.extension) -
      pathCost(entry, query),
  }
}

export const scoreEntry = (
  entry: IndexedEntry,
  normalizedQuery: string,
  nowMs: number = Date.now(),
): { matchIndices: number[]; score: number } | null => {
  const query = normalizeQuery(normalizedQuery)

  if (!query) {
    return {
      matchIndices: [],
      score:
        recencyBoost(entry.mtimeMs, nowMs) + extensionBoost(entry.extension) - pathCost(entry, ''),
    }
  }

  return query.includes(' ')
    ? scoreMultiTermQuery(entry, query, nowMs)
    : scoreSingleQuery(entry, query, nowMs)
}
