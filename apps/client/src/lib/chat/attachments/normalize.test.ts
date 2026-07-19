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

describe('cloneAttachments', () => {
  test('returns a deep-enough copy that does not alias the source objects', () => {
    const source = [attachment()]
    const cloned = cloneAttachments(source)

    expect(cloned).toEqual(source)
    expect(cloned[0]).not.toBe(source[0])
  })

  test('returns an empty array for an empty input', () => {
    expect(cloneAttachments([])).toEqual([])
  })
})

describe('mergeAttachments', () => {
  test('returns a clone of existing attachments when incoming is empty', () => {
    const existing = [attachment()]
    const merged = mergeAttachments(existing, [])

    expect(merged).toEqual(existing)
    expect(merged[0]).not.toBe(existing[0])
  })

  test('appends new incoming attachments not already present by id', () => {
    const existing = [attachment({ id: 'att_1' })]
    const incoming = [attachment({ id: 'att_2', name: 'image.png' })]

    const merged = mergeAttachments(existing, incoming)

    expect(merged.map((item) => item.id)).toEqual(['att_1', 'att_2'])
  })

  test('does not duplicate attachments that already exist by id', () => {
    const existing = [attachment({ id: 'att_1', name: 'original.txt' })]
    const incoming = [attachment({ id: 'att_1', name: 'renamed.txt' })]

    const merged = mergeAttachments(existing, incoming)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.name).toBe('original.txt')
  })
})

describe('isMessageAttachment', () => {
  test('accepts a well-formed attachment', () => {
    expect(isMessageAttachment(attachment())).toBe(true)
  })

  test('accepts an optional thumbnailUrl string', () => {
    expect(isMessageAttachment(attachment({ thumbnailUrl: 'https://example.test/thumb' }))).toBe(
      true,
    )
  })

  test('rejects non-object values', () => {
    expect(isMessageAttachment(null)).toBe(false)
    expect(isMessageAttachment('att_1')).toBe(false)
    expect(isMessageAttachment(undefined)).toBe(false)
  })

  test('rejects an object missing required fields or with wrong field types', () => {
    expect(isMessageAttachment({ ...attachment(), size: '10' })).toBe(false)
    expect(isMessageAttachment({ ...attachment(), kind: 'video' })).toBe(false)
    const { name: _name, ...withoutName } = attachment()
    expect(isMessageAttachment(withoutName)).toBe(false)
  })

  test('rejects a non-string thumbnailUrl', () => {
    expect(isMessageAttachment({ ...attachment(), thumbnailUrl: 42 })).toBe(false)
  })
})

describe('extractAttachmentsFromMetadata', () => {
  test('extracts and clones valid attachments from metadata.attachments', () => {
    const source = attachment()
    const extracted = extractAttachmentsFromMetadata({ attachments: [source] })

    expect(extracted).toEqual([source])
    expect(extracted[0]).not.toBe(source)
  })

  test('filters out malformed entries while keeping valid ones', () => {
    const valid = attachment()
    const extracted = extractAttachmentsFromMetadata({
      attachments: [valid, { id: 'bad' }, null, 42],
    })

    expect(extracted).toEqual([valid])
  })

  test('returns an empty array when metadata is not an object or has no attachments array', () => {
    expect(extractAttachmentsFromMetadata(null)).toEqual([])
    expect(extractAttachmentsFromMetadata('nope')).toEqual([])
    expect(extractAttachmentsFromMetadata({})).toEqual([])
    expect(extractAttachmentsFromMetadata({ attachments: 'nope' })).toEqual([])
  })
})
