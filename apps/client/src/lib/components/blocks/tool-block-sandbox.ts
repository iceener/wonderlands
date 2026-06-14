export const normalizeSandboxText = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const shouldShowSandboxPreview = (
  preview: string | null | undefined,
  fullText: string | null | undefined,
): boolean => normalizeSandboxText(preview) !== null && normalizeSandboxText(fullText) === null
