export interface ParsedDataUrl {
  isBase64: boolean
  mimeType: string | null
  payload: string
}

export interface DecodedDataUrl {
  body: Buffer
  isBase64: boolean
  mimeType: string | null
}

export const parseDataUrl = (value: string): ParsedDataUrl | null => {
  if (!value.startsWith('data:')) {
    return null
  }

  const separatorIndex = value.indexOf(',')

  if (separatorIndex < 0) {
    return null
  }

  const header = value.slice(5, separatorIndex)
  const payload = value.slice(separatorIndex + 1)
  const headerParts = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const mimeType =
    headerParts.length > 0 && !headerParts[0]!.includes('=') ? (headerParts.shift() ?? null) : null

  return {
    isBase64: headerParts.some((part) => part.toLowerCase() === 'base64'),
    mimeType,
    payload,
  }
}

export const estimateDataUrlBytes = (value: string): number | null => {
  const parsed = parseDataUrl(value)

  if (!parsed) {
    return null
  }

  if (parsed.isBase64) {
    const normalizedPayload = parsed.payload.replace(/\s+/g, '')
    const paddingLength = normalizedPayload.endsWith('==')
      ? 2
      : normalizedPayload.endsWith('=')
        ? 1
        : 0

    return Math.max(0, Math.floor((normalizedPayload.length * 3) / 4) - paddingLength)
  }

  try {
    return Buffer.byteLength(decodeURIComponent(parsed.payload), 'utf8')
  } catch {
    return null
  }
}

export const decodeDataUrl = (value: string): DecodedDataUrl | null => {
  const parsed = parseDataUrl(value)

  if (!parsed) {
    return null
  }

  try {
    if (parsed.isBase64) {
      return {
        body: Buffer.from(parsed.payload.replace(/\s+/g, ''), 'base64'),
        isBase64: true,
        mimeType: parsed.mimeType,
      }
    }

    return {
      body: Buffer.from(decodeURIComponent(parsed.payload), 'utf8'),
      isBase64: false,
      mimeType: parsed.mimeType,
    }
  } catch {
    return null
  }
}
