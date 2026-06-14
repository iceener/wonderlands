import { describe, expect, test } from 'vitest'

import { normalizeSandboxText, shouldShowSandboxPreview } from './tool-block-sandbox'

describe('tool-block-sandbox', () => {
  test('normalizes blank sandbox text to null', () => {
    expect(normalizeSandboxText(null)).toBeNull()
    expect(normalizeSandboxText(undefined)).toBeNull()
    expect(normalizeSandboxText('')).toBeNull()
    expect(normalizeSandboxText('   \n\t  ')).toBeNull()
    expect(normalizeSandboxText('  stderr text  ')).toBe('stderr text')
  })

  test('shows the preview only when the full sandbox output is absent', () => {
    expect(shouldShowSandboxPreview('preview text', null)).toBe(true)
    expect(shouldShowSandboxPreview('preview text', undefined)).toBe(true)
    expect(shouldShowSandboxPreview('preview text', 'full stderr text')).toBe(false)
    expect(shouldShowSandboxPreview('preview text', '  full stderr text  ')).toBe(false)
    expect(shouldShowSandboxPreview(null, null)).toBe(false)
    expect(shouldShowSandboxPreview('   ', null)).toBe(false)
  })
})
