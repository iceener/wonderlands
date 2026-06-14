import { describe, expect, test } from 'vitest'
import {
  ATTACHMENT_GRID_GAP,
  ATTACHMENT_IMAGE_ASPECT_RATIO,
  estimateAttachmentFileStackHeight,
  estimateAttachmentImageGridHeight,
  formatAttachmentSize,
  getAttachmentExtension,
  getAttachmentImageColumnCount,
  getAttachmentImageGridMetrics,
  partitionAttachments,
} from './presentation'

describe('attachment presentation helpers', () => {
  test('formats attachment sizes into readable units', () => {
    expect(formatAttachmentSize(0)).toBe('0 B')
    expect(formatAttachmentSize(999)).toBe('999 B')
    expect(formatAttachmentSize(1_536)).toBe('1.5 KB')
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe('5 MB')
  })

  test('extracts lowercase file extensions without treating dotfiles as extensions', () => {
    expect(getAttachmentExtension('report.final.PDF')).toBe('pdf')
    expect(getAttachmentExtension('archive')).toBeNull()
    expect(getAttachmentExtension('.gitignore')).toBeNull()
    expect(getAttachmentExtension('notes.')).toBeNull()
  })

  test('partitions image and file attachments while preserving order', () => {
    const attachments = [
      { id: '1', kind: 'image' as const },
      { id: '2', kind: 'file' as const },
      { id: '3', kind: 'image' as const },
    ]

    expect(partitionAttachments(attachments)).toEqual({
      images: [attachments[0], attachments[2]],
      files: [attachments[1]],
    })
  })

  test('estimates image grids as taller on narrower widths', () => {
    expect(getAttachmentImageColumnCount(4, 520)).toBe(3)
    expect(getAttachmentImageColumnCount(4, 260)).toBe(1)
    expect(estimateAttachmentImageGridHeight(4, 260)).toBeGreaterThan(
      estimateAttachmentImageGridHeight(4, 520),
    )
  })

  test('getAttachmentImageGridMetrics matches estimateAttachmentImageGridHeight and row geometry', () => {
    expect(getAttachmentImageGridMetrics(0, 400)).toBeNull()

    const wide = getAttachmentImageGridMetrics(4, 520)
    expect(wide).not.toBeNull()
    expect(wide!.totalHeight).toBe(estimateAttachmentImageGridHeight(4, 520))
    expect(wide!.gap).toBe(ATTACHMENT_GRID_GAP)
    expect(wide!.totalWidth).toBe(
      wide!.columns * wide!.tileWidth + ATTACHMENT_GRID_GAP * Math.max(0, wide!.columns - 1),
    )
    expect(wide!.tileHeight).toBe(Math.round(wide!.tileWidth / ATTACHMENT_IMAGE_ASPECT_RATIO))
    expect(wide!.rows).toBe(Math.ceil(4 / wide!.columns))

    const narrow = getAttachmentImageGridMetrics(2, 200)
    expect(narrow!.columns).toBe(1)
    expect(narrow!.totalWidth).toBe(narrow!.tileWidth)
  })

  test('stacks file chip heights linearly with consistent gaps', () => {
    expect(estimateAttachmentFileStackHeight(0)).toBe(0)
    expect(estimateAttachmentFileStackHeight(2)).toBeGreaterThan(
      estimateAttachmentFileStackHeight(1),
    )
  })
})
