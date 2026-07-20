import { describe, expect, test } from 'vitest'
import { collectTransferFiles, hasTransferFiles, toFileArray } from './intake'

const createFile = (name: string, type: string, contents = 'demo'): File =>
  new File([contents], name, { type })

describe('attachment intake helpers', () => {
  test('flattens file sequences into arrays', () => {
    const first = createFile('first.txt', 'text/plain')
    const second = createFile('second.txt', 'text/plain')

    expect(toFileArray([first, second])).toEqual([first, second])
    expect(
      toFileArray({
        0: first,
        1: second,
        length: 2,
      }),
    ).toEqual([first, second])
    expect(toFileArray(null)).toEqual([])
  })

  test('prefers file transfer items and falls back to the files collection', () => {
    const pasted = createFile('pasted.png', 'image/png')
    const fallback = createFile('fallback.txt', 'text/plain')

    expect(
      collectTransferFiles({
        items: [
          { kind: 'string', getAsFile: () => null },
          { kind: 'file', getAsFile: () => pasted },
        ],
        files: [fallback],
      }),
    ).toEqual([pasted])
    expect(collectTransferFiles({ files: [fallback] })).toEqual([fallback])
  })

  test('detects file drags from transfer types', () => {
    expect(hasTransferFiles({ types: ['Files', 'text/plain'] })).toBe(true)
    expect(hasTransferFiles({ types: ['text/plain'] })).toBe(false)
    expect(hasTransferFiles(null)).toBe(false)
  })
})
