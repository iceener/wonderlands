import type { MessageAttachmentKind } from '@wonderlands/contracts/chat'

export const ATTACHMENT_GRID_GAP = 8
export const ATTACHMENT_IMAGE_MIN_WIDTH = 132
export const ATTACHMENT_IMAGE_MAX_WIDTH = 168
export const ATTACHMENT_IMAGE_ASPECT_RATIO = 4 / 3
export const ATTACHMENT_CHIP_HEIGHT = 72
export const ATTACHMENT_SECTION_GAP = 10

/** Matches user bubble `max-w-[85%]` in MessageCard. */
export const USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO = 0.85
/**
 * Total horizontal inset of the user bubble: `px-3` padding (12px × 2) plus
 * `border` (1px × 2).  With Tailwind's `box-sizing: border-box` the CSS
 * `width` includes both, so the content area is `width − 26`.
 */
export const USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING = 26

export interface AttachmentImageGridMetrics {
  columns: number
  gap: number
  imageCount: number
  rows: number
  tileHeight: number
  tileWidth: number
  totalHeight: number
  totalWidth: number
}

export interface AttachmentLike {
  kind: MessageAttachmentKind
}

export const partitionAttachments = <T extends AttachmentLike>(attachments: readonly T[]) => {
  const images: T[] = []
  const files: T[] = []

  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      images.push(attachment)
    } else {
      files.push(attachment)
    }
  }

  return { images, files }
}

const stripTrailingZero = (value: string): string => value.replace(/\.0$/, '')

export const formatAttachmentSize = (size: number): string => {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B'
  }

  if (size < 1024) {
    return `${Math.round(size)} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let unitIndex = -1
  let value = size

  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)

  const digits = value >= 10 ? 0 : 1
  return `${stripTrailingZero(value.toFixed(digits))} ${units[unitIndex]}`
}

export const getAttachmentExtension = (name: string): string | null => {
  const trimmedName = name.trim()
  const lastDotIndex = trimmedName.lastIndexOf('.')

  if (lastDotIndex <= 0 || lastDotIndex === trimmedName.length - 1) {
    return null
  }

  return trimmedName.slice(lastDotIndex + 1).toLowerCase()
}

export const getAttachmentImageColumnCount = (
  imageCount: number,
  availableWidth: number,
): number => {
  if (imageCount <= 0) {
    return 0
  }

  const clampedWidth = Math.max(ATTACHMENT_IMAGE_MIN_WIDTH, Math.floor(availableWidth))
  const maxColumnsThatFit = Math.max(
    1,
    Math.floor(
      (clampedWidth + ATTACHMENT_GRID_GAP) / (ATTACHMENT_IMAGE_MIN_WIDTH + ATTACHMENT_GRID_GAP),
    ),
  )

  return Math.min(imageCount, maxColumnsThatFit, 3)
}

/**
 * Single source of truth for user attachment image tile geometry (virtual list estimator + MessageCard).
 */
export const getAttachmentImageGridMetrics = (
  imageCount: number,
  availableWidth: number,
): AttachmentImageGridMetrics | null => {
  if (imageCount <= 0) {
    return null
  }

  const gap = ATTACHMENT_GRID_GAP
  const columns = getAttachmentImageColumnCount(imageCount, availableWidth)
  const rows = Math.ceil(imageCount / columns)
  const gapsWidth = gap * Math.max(0, columns - 1)
  const tileWidth = Math.min(
    ATTACHMENT_IMAGE_MAX_WIDTH,
    Math.max(
      ATTACHMENT_IMAGE_MIN_WIDTH,
      Math.floor((Math.max(ATTACHMENT_IMAGE_MIN_WIDTH, availableWidth) - gapsWidth) / columns),
    ),
  )
  const tileHeight = Math.round(tileWidth / ATTACHMENT_IMAGE_ASPECT_RATIO)
  const totalWidth = columns * tileWidth + gapsWidth
  const totalHeight = rows * tileHeight + gap * Math.max(0, rows - 1)

  return {
    imageCount,
    columns,
    gap,
    rows,
    tileWidth,
    tileHeight,
    totalWidth,
    totalHeight,
  }
}

export const estimateAttachmentImageGridHeight = (
  imageCount: number,
  availableWidth: number,
): number => getAttachmentImageGridMetrics(imageCount, availableWidth)?.totalHeight ?? 0

export const estimateAttachmentFileStackHeight = (fileCount: number): number => {
  if (fileCount <= 0) {
    return 0
  }

  return fileCount * ATTACHMENT_CHIP_HEIGHT + ATTACHMENT_GRID_GAP * Math.max(0, fileCount - 1)
}
