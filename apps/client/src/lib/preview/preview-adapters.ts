import type { MessageAttachment } from '@wonderlands/contracts/chat'
import { apiFetch, toApiUrl } from '../services/backend'
import type { AttachmentDraft } from '../stores/attachment-drafts.svelte'
import type { ImagePreviewItem, PreviewItem, TextPreviewItem } from './types'

/** Image drafts in tray order → preview items (skips non-images). */
export const imageDraftsToPreviewItems = (drafts: readonly AttachmentDraft[]): ImagePreviewItem[] =>
  drafts
    .filter((d) => d.kind === 'image')
    .map((draft) => {
      const sourceUrl = draft.remoteUrl?.trim() || draft.previewUrl?.trim() || draft.objectUrl || ''
      return {
        kind: 'image' as const,
        sourceUrl,
        alt: draft.name || 'Attachment',
        caption: draft.name,
      }
    })
    .filter((item) => item.sourceUrl.length > 0)

/** Message image attachments → preview items (canonical URLs for authenticated assets). */
export const imageAttachmentsToPreviewItems = (
  attachments: readonly MessageAttachment[],
): ImagePreviewItem[] =>
  attachments
    .filter((a) => a.kind === 'image')
    .map((attachment) => ({
      kind: 'image' as const,
      sourceUrl: attachment.url,
      alt: attachment.name || 'Image',
      caption: attachment.name,
    }))

export const isLightboxableImageSrc = (raw: string): boolean => {
  const t = raw.trim()
  if (!t) {
    return false
  }
  if (t.startsWith('blob:') || t.startsWith('data:')) {
    return false
  }
  return true
}

export const collectLightboxableImages = (
  root: HTMLElement | null,
): { items: ImagePreviewItem[]; elements: HTMLImageElement[] } => {
  if (!root) {
    return { items: [], elements: [] }
  }

  const elements: HTMLImageElement[] = []
  const items: ImagePreviewItem[] = []

  for (const img of root.querySelectorAll('img')) {
    const raw = (img.currentSrc || img.getAttribute('src') || '').trim()

    // Auth-resolved images have their src rewritten to blob: URLs.
    // Recover the original API path from the wrapper's data-image-src.
    let sourceUrl = raw
    if (!isLightboxableImageSrc(raw)) {
      const wrapper = img.closest<HTMLElement>('[data-message-image]')
      const original = wrapper?.dataset.imageSrc?.trim() ?? ''
      if (!isLightboxableImageSrc(original)) {
        continue
      }
      sourceUrl = original
    }

    elements.push(img)
    items.push({
      kind: 'image',
      sourceUrl,
      alt: (img.getAttribute('alt') || 'Image').trim() || 'Image',
    })
  }

  return { items, elements }
}

/**
 * Maps `<img>` elements under `root` to preview items using `currentSrc`/`src` attributes
 * (backend paths survive virtualization; blob URLs are skipped).
 */
export const imageElementsToPreviewItems = (root: HTMLElement | null): PreviewItem[] =>
  collectLightboxableImages(root).items

const TEXT_MIME_PREFIXES = ['text/']
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/x-sh',
  'application/x-httpd-php',
])

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'sh',
  'bash',
  'zsh',
  'fish',
  'sql',
  'graphql',
  'gql',
  'env',
  'ini',
  'cfg',
  'conf',
  'log',
  'csv',
  'tsv',
  'svg',
  'vue',
  'svelte',
  'astro',
  'php',
])

const isTextMime = (mime: string, name?: string): boolean => {
  if (TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true
  if (TEXT_MIME_EXACT.has(mime)) return true
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (TEXT_EXTENSIONS.has(ext)) return true
  }
  return false
}

/** Resolve a file attachment to a text preview item. Returns null if content can't be loaded. */
export const resolveTextPreviewItem = async (
  attachment: MessageAttachment,
  options: { editable?: boolean; messageId?: string } = {},
): Promise<TextPreviewItem | null> => {
  if (!isTextMime(attachment.mime, attachment.name)) {
    return null
  }

  try {
    const contentUrl =
      attachment.url || (attachment.id ? `/v1/files/${attachment.id}/content` : null)

    if (!contentUrl) return null

    const response = await apiFetch(toApiUrl(contentUrl))
    if (!response.ok) {
      return {
        kind: 'text',
        name: attachment.name,
        content: `[Could not load file content — server returned ${response.status}]`,
        mime: attachment.mime,
        size: attachment.size,
        editable: false,
        attachmentId: attachment.id,
        attachmentUrl: attachment.url,
        messageId: options.messageId,
      }
    }

    const text = await response.text()

    return {
      kind: 'text',
      name: attachment.name,
      content: text,
      mime: attachment.mime,
      size: attachment.size,
      editable: options.editable ?? false,
      attachmentId: attachment.id,
      attachmentUrl: attachment.url,
      messageId: options.messageId,
    }
  } catch {
    return null
  }
}

/** Resolve a composer file draft to a text preview item. */
export const fileDraftToPreviewItem = async (
  draft: AttachmentDraft,
  options: { saveHandler?: (content: string) => void | Promise<void> } = {},
): Promise<TextPreviewItem | null> => {
  if (!isTextMime(draft.mime, draft.name)) {
    return null
  }

  try {
    const text = await draft.file.text()
    return {
      kind: 'text',
      name: draft.name,
      content: text,
      mime: draft.mime,
      size: draft.size,
      editable: Boolean(options.saveHandler),
      saveHandler: options.saveHandler,
    }
  } catch {
    return null
  }
}
