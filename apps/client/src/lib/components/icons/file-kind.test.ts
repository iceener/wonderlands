import { describe, expect, test } from 'vitest'
import { getFileKindIconKey } from './file-kind'

describe('getFileKindIconKey', () => {
  test('classifies common attachment kinds for bespoke icons', () => {
    expect(getFileKindIconKey('image/png', 'png')).toBe('image')
    expect(getFileKindIconKey('application/pdf', 'pdf')).toBe('document')
    expect(getFileKindIconKey('text/csv', 'csv')).toBe('spreadsheet')
    expect(getFileKindIconKey('application/json', 'json')).toBe('code')
    expect(getFileKindIconKey('application/zip', 'zip')).toBe('archive')
    expect(getFileKindIconKey('application/octet-stream', 'bin')).toBe('file')
  })
})
