import { createHash } from 'node:crypto'

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = canonicalize((value as Record<string, unknown>)[key])
        return accumulator
      }, {})
  }

  return value
}

export const createMcpToolFingerprint = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
