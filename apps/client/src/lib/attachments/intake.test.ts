import { describe, expect, test } from 'vitest'
import {
  ATTACHMENT_ACCEPT_HINT,
  collectTransferFiles,
  hasTransferFiles,
  toFileArray,
} from './intake'

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

  test('prefers transfer items when available and filters non-file items', () => {
    const pasted = createFile('pasted.png', 'image/png')
    const fallback = createFile('fallback.txt', 'text/plain')

    expect(
      collectTransferFiles({
        items: [
          {
            kind: 'string',
            getAsFile: () => null,
          },
          {
            kind: 'file',
            getAsFile: () => pasted,
          },
        ],
        files: [fallback],
      }),
    ).toEqual([pasted])
  })

  test('falls back to transfer files when no file items are present', () => {
    const dropped = createFile('report.csv', 'text/csv')

    expect(
      collectTransferFiles({
        files: [dropped],
      }),
    ).toEqual([dropped])
  })

  test('detects file drags from transfer types', () => {
    expect(hasTransferFiles({ types: ['Files', 'text/plain'] })).toBe(true)
    expect(hasTransferFiles({ types: ['text/plain'] })).toBe(false)
    expect(hasTransferFiles(null)).toBe(false)
  })

  test('exposes a broad attachment accept hint for the file picker', () => {
    expect(ATTACHMENT_ACCEPT_HINT).toContain('image/*')
    expect(ATTACHMENT_ACCEPT_HINT).toContain('.pdf')
    expect(ATTACHMENT_ACCEPT_HINT).toContain('.md')
    expect(ATTACHMENT_ACCEPT_HINT).toContain('.tsx')
  })
})
