import type { ScoredEntry } from './types'

/**
 * Bounded min-heap that retains only the top-K highest-scoring candidates
 * seen so far, avoiding a full sort of the entire indexed entry set.
 */
export class TopKHeap {
  private readonly values: ScoredEntry[] = []

  constructor(private readonly maxSize: number) {}

  push(candidate: ScoredEntry): void {
    if (this.maxSize <= 0) {
      return
    }

    if (this.values.length < this.maxSize) {
      this.values.push(candidate)
      this.bubbleUp(this.values.length - 1)
      return
    }

    if (this.values[0] && candidate.score <= this.values[0].score) {
      return
    }

    this.values[0] = candidate
    this.bubbleDown(0)
  }

  toSortedArray(): ScoredEntry[] {
    return this.values
      .slice()
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.entry.relativePath.localeCompare(right.entry.relativePath),
      )
  }

  private bubbleUp(startIndex: number): void {
    let index = startIndex

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)

      if (this.values[parentIndex]!.score <= this.values[index]!.score) {
        break
      }

      ;[this.values[parentIndex], this.values[index]] = [
        this.values[index]!,
        this.values[parentIndex]!,
      ]
      index = parentIndex
    }
  }

  private bubbleDown(startIndex: number): void {
    let index = startIndex

    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = index * 2 + 2
      let smallestIndex = index

      if (
        leftIndex < this.values.length &&
        this.values[leftIndex]!.score < this.values[smallestIndex]!.score
      ) {
        smallestIndex = leftIndex
      }

      if (
        rightIndex < this.values.length &&
        this.values[rightIndex]!.score < this.values[smallestIndex]!.score
      ) {
        smallestIndex = rightIndex
      }

      if (smallestIndex === index) {
        break
      }

      ;[this.values[index], this.values[smallestIndex]] = [
        this.values[smallestIndex]!,
        this.values[index]!,
      ]
      index = smallestIndex
    }
  }
}
