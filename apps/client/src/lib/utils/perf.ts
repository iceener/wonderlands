/**
 * Dev-only performance tracker.
 *
 * Usage:
 *   import { track, perfStats, resetPerfStats } from '../utils/perf'
 *   const result = track('myLabel', () => expensiveWork())
 *
 * In the browser console:
 *   __perf()        — prints a table with avg/min/max/total for every label
 *   __perfReset()   — clears all accumulated stats
 *
 * All marks also appear in the browser Performance timeline under the
 * "User Timing" section. Filter by the label name to isolate them.
 */

const IS_DEV = import.meta.env.DEV

interface Bucket {
  count: number
  totalMs: number
  minMs: number
  maxMs: number
  /** Populated only for labels that explicitly pass cacheHit */
  cacheHits: number
  cacheMisses: number
}

const buckets = new Map<string, Bucket>()

const getBucket = (label: string): Bucket => {
  const existing = buckets.get(label)
  if (existing) {
    return existing
  }

  const fresh: Bucket = {
    count: 0,
    totalMs: 0,
    minMs: Number.POSITIVE_INFINITY,
    maxMs: Number.NEGATIVE_INFINITY,
    cacheHits: 0,
    cacheMisses: 0,
  }
  buckets.set(label, fresh)
  return fresh
}

/**
 * Synchronously times `fn`, records stats, and emits a Performance timeline
 * mark. Returns whatever `fn` returns.
 *
 * @param label    — name shown in the Performance timeline and stats table
 * @param fn       — function to measure
 * @param cacheHit — optional: pass `true` / `false` to track cache efficiency
 */
export const track = <T>(label: string, fn: () => T, cacheHit?: boolean): T => {
  if (!IS_DEV) {
    return fn()
  }

  // Use performance.now() directly — avoids the O(n) getEntriesByName scan
  // that would turn N tracked calls into O(n²) total work.
  const start = performance.now()
  const result = fn()
  const elapsed = performance.now() - start

  // Emit a single mark visible in the Performance timeline. We skip
  // performance.measure() to avoid accumulating entries over time.
  performance.mark(`${label} (${elapsed.toFixed(2)}ms)`)

  const bucket = getBucket(label)
  bucket.count += 1
  bucket.totalMs += elapsed
  bucket.minMs = Math.min(bucket.minMs, elapsed)
  bucket.maxMs = Math.max(bucket.maxMs, elapsed)

  if (cacheHit === true) {
    bucket.cacheHits += 1
  } else if (cacheHit === false) {
    bucket.cacheMisses += 1
  }

  return result
}

/** Returns a snapshot of the current stats, sorted by total time descending. */
export const perfStats = (): Record<string, object> => {
  const rows: Record<string, object> = {}

  const sorted = [...buckets.entries()].sort(([, a], [, b]) => b.totalMs - a.totalMs)

  for (const [label, b] of sorted) {
    const row: Record<string, string | number> = {
      calls: b.count,
      'avg ms': Number((b.totalMs / b.count).toFixed(3)),
      'min ms': Number(b.minMs.toFixed(3)),
      'max ms': Number(b.maxMs.toFixed(3)),
      'total ms': Number(b.totalMs.toFixed(2)),
    }

    if (b.cacheHits + b.cacheMisses > 0) {
      const hitRate = ((b.cacheHits / (b.cacheHits + b.cacheMisses)) * 100).toFixed(1)
      row['cache hit %'] = `${hitRate}%`
    }

    rows[label] = row
  }

  return rows
}

/** Clears all accumulated stat buckets. */
export const resetPerfStats = (): void => {
  buckets.clear()
  performance.clearMarks()
}

// Expose on window so the browser console can call them without imports
if (IS_DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__perf = () => {
    console.table(perfStats())
  }
  ;(window as unknown as Record<string, unknown>).__perfReset = () => {
    resetPerfStats()
    console.log('[perf] stats reset')
  }

  console.log(
    '%c[perf] tracking active%c  call %c__perf()%c for a stats table, %c__perfReset()%c to clear',
    'color:#7c6ef0;font-weight:600',
    'color:inherit',
    'color:#b4a9f8;font-family:monospace',
    'color:inherit',
    'color:#b4a9f8;font-family:monospace',
    'color:inherit',
  )
}
