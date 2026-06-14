import type { CommandItem, MatchRange, ScoredCommandItem } from './types'

const SCORE_EXACT_START = 100
const SCORE_WORD_BOUNDARY = 60
const SCORE_CONTIGUOUS = 40
const SCORE_SUBSTRING = 20
const SCORE_KEYWORD = 10

const findContiguousMatch = (
  haystack: string,
  needle: string,
): { index: number; score: number } | null => {
  const lower = haystack.toLowerCase()
  const index = lower.indexOf(needle)

  if (index < 0) {
    return null
  }

  if (index === 0) {
    return { index, score: SCORE_EXACT_START }
  }

  const charBefore = haystack[index - 1]
  const isWordBoundary = charBefore === ' ' || charBefore === '-' || charBefore === '_'

  return { index, score: isWordBoundary ? SCORE_WORD_BOUNDARY : SCORE_SUBSTRING }
}

const scoreLabel = (
  label: string,
  query: string,
): { score: number; matchRanges: MatchRange[] } | null => {
  // Try contiguous match first (highest quality)
  const match = findContiguousMatch(label, query)
  if (match) {
    return {
      score: match.score + (query.length / label.length) * SCORE_CONTIGUOUS,
      matchRanges: [{ start: match.index, end: match.index + query.length }],
    }
  }

  // Fall back to multi-word matching: every word must appear in the label
  const words = query.split(/\s+/).filter((w) => w.length > 0)
  if (words.length < 2) {
    return null
  }

  const _lower = label.toLowerCase()
  const matchRanges: MatchRange[] = []
  let totalScore = 0

  for (const word of words) {
    const wordMatch = findContiguousMatch(label, word)
    if (!wordMatch) {
      return null
    }
    matchRanges.push({ start: wordMatch.index, end: wordMatch.index + word.length })
    totalScore += wordMatch.score
  }

  // Average the per-word scores and scale down slightly vs contiguous
  const avgScore = totalScore / words.length
  const lengthBonus = (query.length / label.length) * SCORE_CONTIGUOUS
  return {
    score: avgScore * 0.8 + lengthBonus,
    matchRanges: matchRanges.sort((a, b) => a.start - b.start),
  }
}

const scoreKeywords = (keywords: string[], query: string): number => {
  // Single contiguous match against any keyword
  for (const keyword of keywords) {
    if (keyword.toLowerCase().includes(query)) {
      return SCORE_KEYWORD
    }
  }

  // Multi-word: every query word must appear in at least one keyword
  const words = query.split(/\s+/).filter((w) => w.length > 0)
  if (words.length < 2) {
    return 0
  }

  const lowerKeywords = keywords.map((k) => k.toLowerCase())
  for (const word of words) {
    if (!lowerKeywords.some((k) => k.includes(word))) {
      return 0
    }
  }

  return SCORE_KEYWORD
}

export const searchCommands = (
  query: string,
  items: readonly CommandItem[],
): ScoredCommandItem[] => {
  const trimmed = query.trim().toLowerCase()

  if (trimmed === '') {
    return items
      .filter((item) => item.enabled())
      .map((item) => ({ item, score: 0, matchRanges: [] }))
  }

  const results: ScoredCommandItem[] = []

  for (const item of items) {
    if (!item.enabled()) {
      continue
    }

    const labelResult = scoreLabel(item.label, trimmed)
    if (labelResult) {
      results.push({ item, score: labelResult.score, matchRanges: labelResult.matchRanges })
      continue
    }

    const keywordScore = item.keywords ? scoreKeywords(item.keywords, trimmed) : 0
    if (keywordScore > 0) {
      results.push({ item, score: keywordScore, matchRanges: [] })
    }
  }

  results.sort((a, b) => b.score - a.score)

  return results
}
