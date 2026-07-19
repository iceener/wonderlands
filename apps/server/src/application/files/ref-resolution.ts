import { TextDecoder } from 'node:util'
import type { AttachmentRefResolutionPolicy } from '../../application/tooling/tool-registry'
import type { AppDatabase } from '../../db/client'
import type { BlobStore } from '../../domain/files/blob-store'
import { createFileRepository } from '../../domain/files/file-repository'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { AttachmentRefDescriptor } from './attachment-ref-context'

export type AttachmentRefResolutionMode =
  | 'file_id'
  | 'metadata'
  | 'markdown'
  | 'path'
  | 'text'
  | 'url'

interface ResolveAttachmentRefsInValueInput {
  blobStore: BlobStore
  db: AppDatabase
  descriptors: AttachmentRefDescriptor[]
  mode: AttachmentRefResolutionMode
  scope: TenantScope
  targetKeys?: string[]
  value: unknown
}

const textDecoder = new TextDecoder()
const REF_TOKEN_PATTERN = /\{\{attachment:msg_[A-Za-z0-9_]+:kind:(?:image|file):index:\d+}}/g
const REF_ALIAS_PATTERN = /^(attachment|file|image)\[(\d+)]$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTextLikeMimeType = (mimeType: string | null): boolean => {
  if (!mimeType) {
    return false
  }

  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript'
  )
}

const toModeFromPolicy = (
  policy: AttachmentRefResolutionPolicy,
): AttachmentRefResolutionMode | null => {
  switch (policy) {
    case 'file_id_only':
      return 'file_id'
    case 'path_only':
      return 'path'
    case 'path_inline':
      return 'path'
    case 'smart_default':
      return null
    case 'text_only':
      return 'text'
    case 'url_only':
      return 'url'
    case 'markdown_only':
      return 'markdown'
    case 'metadata_only':
      return 'metadata'
    case 'none':
      return null
  }
}

const toMetadataValue = (descriptor: AttachmentRefDescriptor) => ({
  fileId: descriptor.fileId,
  indexInMessageAll: descriptor.indexInMessageAll,
  indexInMessageByKind: descriptor.indexInMessageByKind,
  internalPath: descriptor.internalPath,
  kind: descriptor.kind,
  messageId: descriptor.messageId,
  mimeType: descriptor.mimeType,
  name: descriptor.name,
  ref: descriptor.ref,
  renderUrl: descriptor.renderUrl,
})

const toMarkdownValue = (descriptor: AttachmentRefDescriptor): string => {
  const label = descriptor.name ?? descriptor.fileId

  return descriptor.kind === 'image'
    ? `![${label}](${descriptor.renderUrl})`
    : `[${label}](${descriptor.renderUrl})`
}

const toMetadataOnlyText = (descriptor: AttachmentRefDescriptor): string => {
  const parts = [`Attached file: ${descriptor.name ?? descriptor.fileId}`]

  if (descriptor.mimeType) {
    parts.push(`MIME: ${descriptor.mimeType}`)
  }

  return parts.join('\n')
}

const resolveDescriptorValue = async (
  input: Pick<ResolveAttachmentRefsInValueInput, 'blobStore' | 'db' | 'mode' | 'scope'>,
  descriptor: AttachmentRefDescriptor,
): Promise<Result<unknown, DomainError>> => {
  switch (input.mode) {
    case 'file_id':
      return ok(descriptor.fileId)
    case 'path':
      return ok(descriptor.internalPath)
    case 'url':
      return ok(descriptor.renderUrl)
    case 'markdown':
      return ok(toMarkdownValue(descriptor))
    case 'metadata':
      return ok(toMetadataValue(descriptor))
    case 'text': {
      const file = createFileRepository(input.db).getById(input.scope, descriptor.fileId)

      if (!file.ok) {
        return file
      }

      if (!isTextLikeMimeType(file.value.mimeType)) {
        return ok(toMetadataOnlyText(descriptor))
      }

      const blob = await input.blobStore.get(file.value.storageKey)

      if (!blob.ok) {
        return blob
      }

      return ok(textDecoder.decode(blob.value.body))
    }
  }
}

const resolveExactStringValue = async (
  input: ResolveAttachmentRefsInValueInput,
  value: string,
): Promise<Result<unknown, DomainError> | null> => {
  const descriptor = input.descriptors.find((candidate) => candidate.ref === value)

  if (!descriptor) {
    return null
  }

  return resolveDescriptorValue(input, descriptor)
}

const toAliasResolutionError = (
  value: string,
  descriptors: AttachmentRefDescriptor[],
): Result<never, DomainError> | null => {
  if (descriptors.length === 0 || !REF_ALIAS_PATTERN.test(value.trim())) {
    return null
  }

  return err({
    message: `Attachment shorthand "${value.trim()}" is only a prompt alias. Use the full {{attachment:...}} token shown in attachment refs, or a real fil_* id where the tool accepts file ids.`,
    type: 'validation',
  })
}

const replaceAsync = async (
  value: string,
  pattern: RegExp,
  replacer: (match: string) => Promise<Result<string, DomainError>>,
): Promise<Result<string, DomainError>> => {
  let next = ''
  let lastIndex = 0

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    next += value.slice(lastIndex, index)
    const replaced = await replacer(match[0])

    if (!replaced.ok) {
      return replaced
    }

    next += replaced.value
    lastIndex = index + match[0].length
  }

  next += value.slice(lastIndex)
  return ok(next)
}

const resolveInlineTextValue = async (
  input: ResolveAttachmentRefsInValueInput,
  value: string,
  policy: 'path_inline' | 'smart_default',
): Promise<Result<string, DomainError>> => {
  const descriptorByRef = new Map(
    input.descriptors.map((descriptor) => [descriptor.ref, descriptor]),
  )

  const nextValue = await replaceAsync(value, REF_TOKEN_PATTERN, async (match) => {
    const descriptor = descriptorByRef.get(match)

    if (!descriptor) {
      return ok(match)
    }

    if (policy === 'path_inline') {
      return ok(descriptor.internalPath)
    }

    if (descriptor.kind === 'image') {
      return ok(toMarkdownValue(descriptor))
    }

    const resolved = await resolveDescriptorValue(
      {
        blobStore: input.blobStore,
        db: input.db,
        mode: 'text',
        scope: input.scope,
      },
      descriptor,
    )

    return resolved.ok ? ok(String(resolved.value ?? '')) : resolved
  })

  return nextValue
}

const resolveNestedValue = async (
  input: ResolveAttachmentRefsInValueInput,
  value: unknown,
  activeKey?: string,
): Promise<Result<unknown, DomainError>> => {
  const allowResolution =
    !input.targetKeys ||
    input.targetKeys.length === 0 ||
    Boolean(activeKey && input.targetKeys.includes(activeKey))

  if (typeof value === 'string') {
    const exact = allowResolution ? await resolveExactStringValue(input, value) : null

    if (exact) {
      return exact
    }

    if (allowResolution) {
      const aliasError = toAliasResolutionError(value, input.descriptors)

      if (aliasError) {
        return aliasError
      }
    }

    return ok(value)
  }

  if (Array.isArray(value)) {
    const resolved: unknown[] = []

    for (const entry of value) {
      const next = await resolveNestedValue(input, entry, activeKey)

      if (!next.ok) {
        return next
      }

      resolved.push(next.value)
    }

    return ok(resolved)
  }

  if (isRecord(value)) {
    const resolvedEntries = await Promise.all(
      Object.entries(value).map(async ([key, entry]) => {
        const next = await resolveNestedValue(input, entry, key)

        return [key, next] as const
      }),
    )

    const nextValue: Record<string, unknown> = {}

    for (const [key, entry] of resolvedEntries) {
      if (!entry.ok) {
        return entry
      }

      nextValue[key] = entry.value
    }

    return ok(nextValue)
  }

  return ok(value)
}

export const resolveAttachmentRefsInValue = async (
  input: ResolveAttachmentRefsInValueInput,
): Promise<Result<unknown, DomainError>> => resolveNestedValue(input, input.value)

export const resolveAttachmentRefsForToolPolicy = async (
  input: Omit<ResolveAttachmentRefsInValueInput, 'mode'> & {
    policy: AttachmentRefResolutionPolicy | undefined
  },
): Promise<Result<unknown, DomainError>> => {
  const effectivePolicy = input.policy ?? 'smart_default'

  if (effectivePolicy === 'smart_default' || effectivePolicy === 'path_inline') {
    const resolveSmartNestedValue = async (
      value: unknown,
      activeKey?: string,
    ): Promise<Result<unknown, DomainError>> => {
      const allowResolution =
        !input.targetKeys ||
        input.targetKeys.length === 0 ||
        Boolean(activeKey && input.targetKeys.includes(activeKey))

      if (typeof value === 'string') {
        if (!allowResolution) {
          return ok(value)
        }

        if (effectivePolicy === 'smart_default') {
          const exact = await resolveExactStringValue(
            {
              ...input,
              mode: 'url',
            },
            value,
          )

          if (exact) {
            return exact
          }

          const aliasError = toAliasResolutionError(value, input.descriptors)

          if (aliasError) {
            return aliasError
          }

          return resolveInlineTextValue(
            {
              ...input,
              mode: 'text',
            },
            value,
            'smart_default',
          )
        }

        const exact = await resolveExactStringValue(
          {
            ...input,
            mode: 'path',
          },
          value,
        )

        if (exact) {
          return exact
        }

        const aliasError = toAliasResolutionError(value, input.descriptors)

        if (aliasError) {
          return aliasError
        }

        return resolveInlineTextValue(
          {
            ...input,
            mode: 'path',
          },
          value,
          'path_inline',
        )
      }

      if (Array.isArray(value)) {
        const resolved: unknown[] = []

        for (const entry of value) {
          const next = await resolveSmartNestedValue(entry, activeKey)

          if (!next.ok) {
            return next
          }

          resolved.push(next.value)
        }

        return ok(resolved)
      }

      if (isRecord(value)) {
        const nextValue: Record<string, unknown> = {}

        for (const [key, entry] of Object.entries(value)) {
          const next = await resolveSmartNestedValue(entry, key)

          if (!next.ok) {
            return next
          }

          nextValue[key] = next.value
        }

        return ok(nextValue)
      }

      return ok(value)
    }

    if (input.descriptors.length === 0) {
      return ok(input.value)
    }

    return resolveSmartNestedValue(input.value)
  }

  const mode = toModeFromPolicy(effectivePolicy)

  if (!mode || input.descriptors.length === 0) {
    return ok(input.value)
  }

  if (typeof input.value === 'string') {
    const aliasError = toAliasResolutionError(input.value, input.descriptors)

    if (aliasError) {
      return aliasError
    }
  }

  return resolveAttachmentRefsInValue({
    ...input,
    mode,
  })
}

export const resolveAttachmentRefsInText = (
  descriptors: AttachmentRefDescriptor[],
  text: string,
  mode: Extract<AttachmentRefResolutionMode, 'markdown' | 'url'>,
): string => {
  if (text.length === 0 || descriptors.length === 0) {
    return text
  }

  const descriptorByRef = new Map(descriptors.map((descriptor) => [descriptor.ref, descriptor]))

  return text.replace(REF_TOKEN_PATTERN, (match) => {
    const descriptor = descriptorByRef.get(match)

    if (!descriptor) {
      return match
    }

    return mode === 'markdown' ? toMarkdownValue(descriptor) : descriptor.renderUrl
  })
}
