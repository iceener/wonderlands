import type { AiWebReference, AiWebSearchActivity } from '../../domain/ai/types'

export const toDomainFromUrl = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname.trim()
    return hostname.length > 0 ? hostname : null
  } catch {
    return null
  }
}

export const dedupeStrings = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

export const dedupeWebReferences = (references: AiWebReference[]): AiWebReference[] => {
  const byUrl = new Map<string, AiWebReference>()

  for (const reference of references) {
    const existing = byUrl.get(reference.url)

    if (!existing) {
      byUrl.set(reference.url, reference)
      continue
    }

    byUrl.set(reference.url, {
      domain: existing.domain ?? reference.domain,
      title: existing.title ?? reference.title,
      url: reference.url,
    })
  }

  return [...byUrl.values()]
}

export const mergeWebSearchStatus = (
  current: AiWebSearchActivity['status'],
  next: AiWebSearchActivity['status'],
): AiWebSearchActivity['status'] => {
  const rank: Record<AiWebSearchActivity['status'], number> = {
    in_progress: 0,
    searching: 1,
    completed: 2,
    failed: 3,
  }

  return rank[next] >= rank[current] ? next : current
}
