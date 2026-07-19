import type { z } from 'zod'

import type { SandboxPolicy } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

const sandboxPathPattern = /^\/[A-Za-z0-9._/-]*$/
const reservedSandboxEnvKeys = new Set([
  'HOME',
  'INIT_CWD',
  'NODE_NO_WARNINGS',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'PWD',
  'SANDBOX_HOST_ROOT',
  'SANDBOX_INPUT_DIR',
  'SANDBOX_OUTPUT_DIR',
  'SANDBOX_WORK_DIR',
  'TMPDIR',
])

export const toValidationResult = <TValue>(
  parsed: ReturnType<z.ZodType<TValue>['safeParse']>,
): Result<TValue, DomainError> =>
  parsed.success
    ? ok(parsed.data)
    : err({
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })

export const defaultSandboxPolicy = (): SandboxPolicy => ({
  enabled: false,
  network: {
    mode: 'off',
  },
  packages: {
    mode: 'disabled',
  },
  runtime: {
    allowAutomaticCompatFallback: false,
    allowedEngines: ['lo'],
    allowWorkspaceScripts: false,
    defaultEngine: 'lo',
    maxDurationSec: 120,
    maxInputBytes: 25_000_000,
    maxMemoryMb: 512,
    maxOutputBytes: 25_000_000,
    nodeVersion: '22',
  },
  vault: {
    mode: 'none',
    requireApprovalForDelete: true,
    requireApprovalForMove: true,
    requireApprovalForWorkspaceScript: true,
    requireApprovalForWrite: true,
  },
})

export const normalizeList = (values: string[] | undefined): string[] | undefined => {
  if (!values || values.length === 0) {
    return undefined
  }

  const normalized = Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  )

  return normalized.length > 0 ? normalized : undefined
}

export const normalizeSandboxPath = (value: string, label: string): Result<string, DomainError> => {
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim()

  if (!sandboxPathPattern.test(normalized)) {
    return err({
      message: `${label} must be an absolute sandbox path`,
      type: 'validation',
    })
  }

  const segments = normalized.split('/').filter(Boolean)

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return err({
      message: `${label} cannot contain relative path traversal`,
      type: 'validation',
    })
  }

  return ok(normalized === '/' ? normalized : normalized.replace(/\/+$/, '') || '/')
}

export const normalizeInlineScriptFilename = (value: string): Result<string, DomainError> => {
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim()

  if (normalized.length === 0 || normalized.startsWith('/') || normalized.endsWith('/')) {
    return err({
      message: 'source.filename must be a relative path inside /work',
      type: 'validation',
    })
  }

  const segments = normalized.split('/').filter(Boolean)

  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    return err({
      message: 'source.filename cannot contain relative path traversal',
      type: 'validation',
    })
  }

  return ok(normalized)
}

export const normalizeVaultPath = (value: string, label: string): Result<string, DomainError> => {
  let normalized = value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim()

  if (normalized === 'vault') {
    normalized = '/vault'
  } else if (normalized.startsWith('vault/')) {
    normalized = `/${normalized}`
  }

  if (normalized !== '/vault' && !normalized.startsWith('/vault/')) {
    return err({
      message: `${label} must use a /vault path`,
      type: 'validation',
    })
  }

  const segments = normalized.split('/').filter(Boolean)

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return err({
      message: `${label} cannot contain relative path traversal`,
      type: 'validation',
    })
  }

  return ok(normalized === '/vault' ? normalized : normalized.replace(/\/+$/, ''))
}

export const normalizeHostList = (values: string[] | undefined): string[] | undefined => {
  if (!values || values.length === 0) {
    return undefined
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
        .map((value) => value.replace(/^https?:\/\//, '').replace(/\/+$/, '')),
    ),
  )

  return normalized.length > 0 ? normalized : undefined
}

const normalizeRegistryHost = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')

const isReservedSandboxEnvKey = (value: string): boolean => {
  const normalized = value.trim().toUpperCase()

  return (
    reservedSandboxEnvKeys.has(normalized) ||
    normalized.startsWith('NPM_CONFIG_') ||
    normalized.startsWith('SANDBOX_')
  )
}

export const normalizeSandboxEnv = (
  env: Record<string, string> | undefined,
): Result<Record<string, string> | undefined, DomainError> => {
  if (!env) {
    return ok(undefined)
  }

  const normalizedEnv: Record<string, string> = {}

  for (const [rawKey, rawValue] of Object.entries(env)) {
    const key = rawKey.trim()

    if (key.length === 0) {
      return err({
        message: 'env keys must not be empty',
        type: 'validation',
      })
    }

    if (isReservedSandboxEnvKey(key)) {
      return err({
        message: `env.${key} uses a reserved sandbox environment variable`,
        type: 'validation',
      })
    }

    normalizedEnv[key] = rawValue
  }

  return Object.keys(normalizedEnv).length > 0 ? ok(normalizedEnv) : ok(undefined)
}

export const normalizeRegistryHostList = (values: string[] | undefined): string[] | undefined => {
  if (!values || values.length === 0) {
    return undefined
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map(normalizeRegistryHost),
    ),
  )

  return normalized.length > 0 ? normalized : undefined
}

export const isVaultPathWithinAllowedRoots = (path: string, allowedRoots?: string[]): boolean => {
  if (!allowedRoots || allowedRoots.length === 0) {
    return true
  }

  return allowedRoots.some((root) => path === root || path.startsWith(`${root}/`))
}
