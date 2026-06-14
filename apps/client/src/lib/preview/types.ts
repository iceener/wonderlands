export interface ImagePreviewItem {
  kind: 'image'
  sourceUrl: string
  alt: string
  caption?: string | null
}

export interface TextPreviewItem {
  kind: 'text'
  name: string
  content: string
  mime: string
  size: number
  editable: boolean
  attachmentId?: string
  attachmentUrl?: string
  messageId?: string
  /** Custom save handler — when provided, PreviewHost uses this instead of the default re-upload flow. */
  saveHandler?: (content: string) => void | Promise<void>
}

export type PreviewItem = ImagePreviewItem | TextPreviewItem

export const isImagePreviewItem = (item: PreviewItem): item is ImagePreviewItem =>
  item.kind === 'image'

export const isTextPreviewItem = (item: PreviewItem): item is TextPreviewItem =>
  item.kind === 'text'
