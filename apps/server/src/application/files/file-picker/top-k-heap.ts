import type { ScoredEntry } from './types'

/**
 * Bounded min-heap that retains only the top-K highest-scoring candidates
 * seen so far, avoiding a full sort of the entire indexed entry set.
 */
const compareQuality = (left: ScoredEntry, right: ScoredEntry): number =>
  left.score - right.score || right.entry.relativePath.localeCompare(left.entry.relativePath)

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

    if (this.values[0] && compareQuality(candidate, this.values[0]) <= 0) {
      return
    }

    this.values[0] = candidate
    this.bubbleDown(0)
  }

  toSortedArray(): ScoredEntry[] {
    return this.values.slice().sort((left, right) => compareQuality(right, left))
  }

  private bubbleUp(startIndex: number): void {
    let index = startIndex

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)

      if (compareQuality(this.values[parentIndex]!, this.values[index]!) <= 0) {
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
        compareQuality(this.values[leftIndex]!, this.values[smallestIndex]!) < 0
      ) {
        smallestIndex = leftIndex
      }

      if (
        rightIndex < this.values.length &&
        compareQuality(this.values[rightIndex]!, this.values[smallestIndex]!) < 0
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
