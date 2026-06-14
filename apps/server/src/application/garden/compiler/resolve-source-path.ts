import { realpath, stat } from 'node:fs/promises'
import { posix, resolve, sep } from 'node:path'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import type { GardenSourceScopeResolution } from './types'

const RESERVED_ROOT_NAMES = new Set(['_meta', 'attachments', 'public', 'system'])

const toInvalidPathError = (label: string, message: string): Result<never, DomainError> =>
  err({
    message: `${label} ${message}`,
    type: 'validation',
  })

const isPathWithinRoot = (rootRef: string, candidateRef: string): boolean =>
  candidateRef === rootRef || candidateRef.startsWith(`${rootRef}${sep}`)

export const normalizeGardenRelativePath = (
  value: string | null | undefined,
  label: string,
): Result<string, DomainError> => {
  const normalizedInput = (value ?? '.').trim().replace(/\\/g, '/')

  if (normalizedInput === '' || normalizedInput === '.') {
    return ok('.')
  }

  if (normalizedInput.startsWith('/')) {
    return toInvalidPathError(label, 'must not be absolute')
  }

  const normalizedPath = posix
    .normalize(normalizedInput)
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')

  if (
    normalizedPath === '' ||
    normalizedPath === '.' ||
    normalizedPath === '..' ||
    normalizedPath.startsWith('../')
  ) {
    return toInvalidPathError(label, 'must resolve inside the selected source scope')
  }

  return ok(normalizedPath)
}

export const getGardenTopLevelName = (relativePath: string): string => {
  const firstSegment = relativePath.split('/')[0] ?? relativePath

  return firstSegment.replace(/\.md$/i, '')
}

export const isGardenReservedRoot = (relativePath: string): boolean =>
  RESERVED_ROOT_NAMES.has(getGardenTopLevelName(relativePath))

export const resolveGardenSourceScope = async (input: {
  sourceScopePath?: string | null
  vaultRootRef: string
}): Promise<Result<GardenSourceScopeResolution, DomainError>> => {
  const normalizedSourceScopePath = normalizeGardenRelativePath(
    input.sourceScopePath,
    'source_scope_path',
  )

  if (!normalizedSourceScopePath.ok) {
    return normalizedSourceScopePath
  }

  const resolvedVaultRoot = resolve(input.vaultRootRef)

  let canonicalVaultRootRef: string
  try {
    canonicalVaultRootRef = await realpath(resolvedVaultRoot)
  } catch {
    return err({
      message: `vault root ${resolvedVaultRoot} was not found`,
      type: 'not_found',
    })
  }

  const candidateSourceScopeRef = resolve(
    canonicalVaultRootRef,
    normalizedSourceScopePath.value === '.' ? '' : normalizedSourceScopePath.value,
  )

  let sourceScopeStats: Awaited<ReturnType<typeof stat>>
  try {
    sourceScopeStats = await stat(candidateSourceScopeRef)
  } catch {
    return err({
      message: `source scope ${normalizedSourceScopePath.value} was not found under the selected vault`,
      type: 'not_found',
    })
  }

  if (!sourceScopeStats.isDirectory()) {
    return err({
      message: `source scope ${normalizedSourceScopePath.value} must resolve to a directory`,
      type: 'validation',
    })
  }

  let canonicalSourceScopeRef: string
  try {
    canonicalSourceScopeRef = await realpath(candidateSourceScopeRef)
  } catch {
    return err({
      message: `failed to resolve source scope ${normalizedSourceScopePath.value}`,
      type: 'conflict',
    })
  }

  if (!isPathWithinRoot(canonicalVaultRootRef, canonicalSourceScopeRef)) {
    return err({
      message: `source scope ${normalizedSourceScopePath.value} resolves outside the selected vault`,
      type: 'permission',
    })
  }

  return ok({
    configRef: resolve(canonicalSourceScopeRef, '_garden.yml'),
    publicAssetsRef: resolve(canonicalSourceScopeRef, 'public'),
    sourceScopePath: normalizedSourceScopePath.value,
    sourceScopeRef: canonicalSourceScopeRef,
    vaultRootRef: canonicalVaultRootRef,
  })
}
