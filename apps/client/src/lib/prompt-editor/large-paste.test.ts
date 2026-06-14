import { describe, expect, test } from 'vitest'
import {
  appendLargeTextPasteHiddenMetadata,
  buildLargeTextPasteHiddenMetadata,
  createLargeTextPasteAttachment,
  LARGE_TEXT_PASTE_THRESHOLD,
  shouldUploadLargeTextPaste,
  stripLargeTextPasteHiddenMetadata,
} from './large-paste'

describe('large text paste helpers', () => {
  test('flags pasted text once it crosses the configured threshold', () => {
    expect(shouldUploadLargeTextPaste('a'.repeat(LARGE_TEXT_PASTE_THRESHOLD - 1))).toBe(false)
    expect(shouldUploadLargeTextPaste('a'.repeat(LARGE_TEXT_PASTE_THRESHOLD))).toBe(true)
  })

  test('creates a markdown attachment for oversized paste payloads', async () => {
    const attachment = createLargeTextPasteAttachment('# Heading\r\n\r\nBody', {
      format: 'markdown',
      now: new Date('2026-03-30T12:34:56.789Z'),
      threshold: 100,
    })

    expect(attachment.fileName).toBe('pasted-text-20260330-123456789.md')
    expect(attachment.file.name).toBe('pasted-text-20260330-123456789.md')
    expect(attachment.file.type).toBe('text/markdown')
    expect(attachment.threshold).toBe(100)
    expect(await attachment.file.text()).toBe('# Heading\n\nBody')
  })

  test('builds a hidden metadata fragment and strips it back out of user-visible text', () => {
    const metadata = buildLargeTextPasteHiddenMetadata(
      [
        {
          characterCount: 220_940,
          fileId: 'fil_large_1',
          fileName: 'pasted-text-20260330-171506000.txt',
        },
      ],
      12_000,
    )

    expect(metadata).toContain('<!-- large-paste:metadata:start -->')
    expect(metadata).toContain('<metadata>')
    expect(metadata).toContain('file id "fil_large_1"')
    expect(metadata).toContain('</metadata>')
    expect(metadata).toContain('<!-- large-paste:metadata:end -->')

    const submittedPrompt = appendLargeTextPasteHiddenMetadata('Please summarize this.', [
      {
        characterCount: 220_940,
        fileId: 'fil_large_1',
        fileName: 'pasted-text-20260330-171506000.txt',
      },
    ])

    expect(stripLargeTextPasteHiddenMetadata(submittedPrompt)).toBe('Please summarize this.')
    expect(stripLargeTextPasteHiddenMetadata(metadata)).toBe('')
  })
})
