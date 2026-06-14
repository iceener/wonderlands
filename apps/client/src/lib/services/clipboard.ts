import { isAuthenticatedAssetUrl } from './authenticated-asset'
import { apiFetch } from './backend'

const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//iu
const FILE_EXTENSION_PATTERN = /\.[a-z0-9]{1,8}$/iu

const extensionForMimeType = (mimeType: string | null | undefined): string | null => {
  const normalized = mimeType?.split(';', 1)[0]?.trim().toLowerCase()

  switch (normalized) {
    case 'image/apng':
      return 'apng'
    case 'image/avif':
      return 'avif'
    case 'image/gif':
      return 'gif'
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/svg+xml':
      return 'svg'
    case 'image/webp':
      return 'webp'
    default:
      return null
  }
}

const sanitizeFileName = (value: string | null | undefined): string => {
  const withoutControlCharacters = Array.from(value ?? '', (char) =>
    char.charCodeAt(0) < 32 ? ' ' : char,
  ).join('')

  const sanitized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\s+\./gu, '.')
    .replace(/\.+$/u, '')

  return sanitized
}

const readPathname = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('/')) {
    return trimmed
  }

  if (!ABSOLUTE_HTTP_URL_PATTERN.test(trimmed) || typeof URL === 'undefined') {
    return null
  }

  try {
    return new URL(trimmed).pathname
  } catch {
    return null
  }
}

const filenameFromPathname = (value: string): string | null => {
  const pathname = readPathname(value)
  if (!pathname) {
    return null
  }

  const candidate = pathname.split('/').filter(Boolean).pop()
  if (!candidate) {
    return null
  }

  try {
    const decoded = decodeURIComponent(candidate)
    const normalized = decoded.toLowerCase()

    if (
      normalized === 'content' ||
      normalized === 'download' ||
      normalized === 'preview' ||
      normalized === 'thumbnail' ||
      normalized === 'thumb'
    ) {
      return null
    }

    return decoded
  } catch {
    return candidate
  }
}

const isSameOriginUrl = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  if (trimmed.startsWith('/')) {
    return true
  }

  if (!ABSOLUTE_HTTP_URL_PATTERN.test(trimmed) || typeof window === 'undefined') {
    return false
  }

  try {
    return new URL(trimmed).origin === window.location.origin
  } catch {
    return false
  }
}

const shouldUseApiFetch = (sourceUrl: string): boolean =>
  isAuthenticatedAssetUrl(sourceUrl) || isSameOriginUrl(sourceUrl)

const triggerDownload = (href: string, filename: string) => {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noreferrer'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

const downloadBlob = (blob: Blob, filename: string) => {
  const href = URL.createObjectURL(blob)

  try {
    triggerDownload(href, filename)
  } finally {
    URL.revokeObjectURL(href)
  }
}

const fetchImageBlob = async (sourceUrl: string, signal?: AbortSignal): Promise<Blob> => {
  const response = shouldUseApiFetch(sourceUrl)
    ? await apiFetch(sourceUrl, { signal })
    : await fetch(sourceUrl, { signal })

  if (!response.ok) {
    throw new Error(`Failed to load image: ${response.status}`)
  }

  return response.blob()
}

export const resolveDownloadFileName = (
  sourceUrl: string,
  preferredName?: string | null,
  mimeType?: string | null,
): string => {
  const preferred = sanitizeFileName(preferredName)
  const fromPath = sanitizeFileName(filenameFromPathname(sourceUrl))
  const extension =
    extensionForMimeType(mimeType) ??
    [preferred, fromPath]
      .find((value) => FILE_EXTENSION_PATTERN.test(value ?? ''))
      ?.split('.')
      .pop() ??
    null

  if (preferred) {
    if (FILE_EXTENSION_PATTERN.test(preferred) || !extension) {
      return preferred
    }

    return `${preferred}.${extension}`
  }

  if (fromPath) {
    return fromPath
  }

  return extension ? `image.${extension}` : 'image'
}

export const copyTextToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

const convertToPngBlob = (source: Blob): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(source)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob failed'))
      }, 'image/png')
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for conversion'))
    }

    img.src = url
  })

export const copyImageToClipboard = async (sourceUrl: string, signal?: AbortSignal) => {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image copy is not supported in this browser')
  }

  const blob = await fetchImageBlob(sourceUrl, signal)
  const pngBlob = blob.type === 'image/png' ? blob : await convertToPngBlob(blob)

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
}

export const downloadImage = async (
  sourceUrl: string,
  preferredName?: string | null,
  signal?: AbortSignal,
) => {
  try {
    const blob = await fetchImageBlob(sourceUrl, signal)
    downloadBlob(blob, resolveDownloadFileName(sourceUrl, preferredName, blob.type))
  } catch (error) {
    triggerDownload(sourceUrl, resolveDownloadFileName(sourceUrl, preferredName))
    if (!(error instanceof Error)) {
      throw error
    }
  }
}
