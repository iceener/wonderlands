import type { MessageAttachment } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import {
  cloneAttachments,
  extractAttachmentsFromMetadata,
  isMessageAttachment,
  mergeAttachments,
} from './normalize'

const attachment = (overrides: Partial<MessageAttachment> = {}): MessageAttachment => ({
  id: 'att_1',
  kind: 'file',
  mime: 'text/plain',
  name: 'notes.txt',
  size: 10,
  url: 'https://example.test/att_1',
  ...overrides,
})

describe('attachment normalization', () => {
  test('clones attachment objects without aliasing the source', () => {
    const source = [attachment()]
    const cloned = cloneAttachments(source)

    expect(cloned).toEqual(source)
    expect(cloned[0]).not.toBe(source[0])
    expect(cloneAttachments([])).toEqual([])
  })

  test('merges new ids while preserving the first attachment for duplicate ids', () => {
    const existing = [attachment({ name: 'original.txt' })]
    const merged = mergeAttachments(existing, [
      attachment({ name: 'renamed.txt' }),
      attachment({ id: 'att_2', name: 'image.png' }),
    ])

    expect(merged.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'att_1', name: 'original.txt' },
      { id: 'att_2', name: 'image.png' },
    ])
    expect(merged[0]).not.toBe(existing[0])
  })

  test('validates required fields and the optional thumbnail URL', () => {
    const cases: Array<[unknown, boolean]> = [
      [attachment(), true],
      [attachment({ thumbnailUrl: 'https://example.test/thumb' }), true],
      [null, false],
      ['att_1', false],
      [{ ...attachment(), size: '10' }, false],
      [{ ...attachment(), kind: 'video' }, false],
      [{ ...attachment(), thumbnailUrl: 42 }, false],
    ]
    const { name: _name, ...withoutName } = attachment()
    cases.push([withoutName, false])

    for (const [value, expected] of cases) {
      expect(isMessageAttachment(value)).toBe(expected)
    }
  })

  test('extracts only valid metadata attachments and returns independent objects', () => {
    const source = attachment()
    const extracted = extractAttachmentsFromMetadata({
      attachments: [source, { id: 'bad' }, null, 42],
    })

    expect(extracted).toEqual([source])
    expect(extracted[0]).not.toBe(source)
    expect(extractAttachmentsFromMetadata(null)).toEqual([])
    expect(extractAttachmentsFromMetadata({ attachments: 'nope' })).toEqual([])
  })
})
