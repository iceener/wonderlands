import { z } from 'zod'

import type {
  SandboxExecutionMode,
  SandboxExecutionRequest,
  SandboxNetworkMode,
  SandboxPolicy,
  SandboxRequestedPackage,
  SandboxRuntime,
  SandboxVaultAccessMode,
  SandboxWritebackRequest,
} from '../../domain/sandbox/types'
import {
  sandboxExecutionModeValues,
  sandboxNetworkModeValues,
  sandboxRuntimeValues,
  sandboxVaultAccessModeValues,
} from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import { selectSandboxRuntime } from './sandbox-runtime-selector'

const exactPackageVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
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

const packagePolicyInputSchema = z
  .object({
    allowedPackages: z
      .array(
        z
          .object({
            allowInstallScripts: z.boolean().optional(),
            name: z.string().trim().min(1).max(200),
            runtimes: z.array(z.enum(sandboxRuntimeValues)).min(1).optional(),
            versionRange: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .optional(),
    allowedRegistries: z.array(z.string().trim().min(1).max(500)).optional(),
    mode: z.enum(['disabled', 'allow_list', 'open']).optional(),
  })
  .strict()

const networkPolicyInputSchema = z
  .object({
    allowedHosts: z.array(z.string().trim().min(1).max(500)).optional(),
    mode: z.enum(sandboxNetworkModeValues).optional(),
  })
  .strict()

const vaultAccessPolicyInputSchema = z
  .object({
    allowedRoots: z.array(z.string().trim().min(1).max(500)).optional(),
    mode: z.enum(sandboxVaultAccessModeValues).optional(),
    requireApprovalForDelete: z.boolean().optional(),
    requireApprovalForMove: z.boolean().optional(),
    requireApprovalForWorkspaceScript: z.boolean().optional(),
    requireApprovalForWrite: z.boolean().optional(),
  })
  .strict()

const runtimePolicyInputSchema = z
  .object({
    allowAutomaticCompatFallback: z.boolean().optional(),
    allowedEngines: z.array(z.enum(sandboxRuntimeValues)).min(1).optional(),
    allowWorkspaceScripts: z.boolean().optional(),
    defaultEngine: z.enum(sandboxRuntimeValues).optional(),
    maxDurationSec: z.number().int().positive().max(3600).optional(),
    maxInputBytes: z.number().int().positive().max(500_000_000).optional(),
    maxMemoryMb: z.number().int().positive().max(32_768).optional(),
    maxOutputBytes: z.number().int().positive().max(500_000_000).optional(),
    nodeVersion: z.string().trim().min(1).max(50).optional(),
  })
  .strict()

const shellPolicyInputSchema = z
  .object({
    allowedCommands: z.array(z.string().trim().min(1).max(200)).optional(),
  })
  .strict()

export const sandboxPolicyInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    network: networkPolicyInputSchema.optional(),
    packages: packagePolicyInputSchema.optional(),
    runtime: runtimePolicyInputSchema.optional(),
    shell: shellPolicyInputSchema.optional(),
    vault: vaultAccessPolicyInputSchema.optional(),
  })
  .strict()

const sandboxAttachmentInputSchema = z
  .object({
    fileId: z.string().trim().min(1).max(200),
    mountPath: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

const sandboxNetworkRequestSchema = z
  .object({
    hosts: z.array(z.string().trim().min(1).max(500)).optional(),
    mode: z.enum(['off', 'on']),
  })
  .strict()
  .optional()

const sandboxOutputRequestSchema = z
  .object({
    attachGlobs: z.array(z.string().trim().min(1).max(500)).optional(),
    writeBack: z
      .array(
        z.discriminatedUnion('mode', [
          z
            .object({
              mode: z.enum(['write', 'copy', 'move']),
              fromPath: z.string().trim().min(1).max(500),
              toVaultPath: z.string().trim().min(1).max(500),
            })
            .strict(),
          z
            .object({
              mode: z.literal('delete'),
              toVaultPath: z.string().trim().min(1).max(500),
            })
            .strict(),
        ]),
      )
      .optional(),
  })
  .strict()
  .optional()

const executeSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      filename: z.string().trim().min(1).max(200).optional(),
      kind: z.literal('inline'),
      script: z.string().trim().min(1).max(100_000),
    })
    .strict(),
  z
    .object({
      filename: z.string().trim().min(1).max(200).optional(),
      kind: z.literal('inline_script'),
      script: z.string().trim().min(1).max(100_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('workspace'),
      vaultPath: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal('workspace_script'),
      vaultPath: z.string().trim().min(1).max(500),
    })
    .strict(),
])

const executeSourceInputSchema = z
  .object({
    filename: z.string().trim().min(1).max(200).optional(),
    kind: z.enum(['inline', 'inline_script', 'workspace', 'workspace_script']).optional(),
    script: z.string().trim().min(1).max(100_000).optional(),
    vaultPath: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

const executeArgsInputSchema = z
  .object({
    args: z.array(z.string().trim().min(1).max(1000)).optional(),
    attachments: z.array(sandboxAttachmentInputSchema).optional(),
    garden: z.string().trim().min(1).max(200).optional(),
    cwdVaultPath: z.string().trim().min(1).max(500).optional(),
    env: z.record(z.string().trim().min(1).max(200), z.string().max(10_000)).optional(),
    filename: z.string().trim().min(1).max(200).optional(),
    mode: z.enum(sandboxExecutionModeValues).optional(),
    network: sandboxNetworkRequestSchema,
    outputs: sandboxOutputRequestSchema,
    packages: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200),
            version: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .optional(),
    runtime: z.enum(sandboxRuntimeValues).optional(),
    script: z.string().trim().min(1).max(100_000).optional(),
    source: z.union([z.string().trim().min(1).max(100_000), executeSourceInputSchema]).optional(),
    task: z.string().trim().min(1).max(500),
    vaultAccess: z.enum(['read_only', 'read_write']).optional(),
    vaultPath: z.string().trim().min(1).max(500).optional(),
    vaultInputs: z
      .array(
        z
          .object({
            mountPath: z.string().trim().min(1).max(500).optional(),
            vaultPath: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasTopLevelScript = typeof value.script === 'string'
    const hasTopLevelVaultPath = typeof value.vaultPath === 'string'
    const hasSource = typeof value.source !== 'undefined'

    if (hasSource && (hasTopLevelScript || hasTopLevelVaultPath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'use either source or the top-level script/vaultPath aliases, not both',
        path: ['source'],
      })
    }

    if (!hasSource && !hasTopLevelScript && !hasTopLevelVaultPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provide source, script, or vaultPath',
        path: ['source'],
      })
    }

    if (hasTopLevelScript && hasTopLevelVaultPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provide either script or vaultPath, not both',
        path: ['script'],
      })
    }

    if (value.source && typeof value.source === 'object' && !Array.isArray(value.source)) {
      const source = value.source
      const hasScript = typeof source.script === 'string'
      const hasVaultPath = typeof source.vaultPath === 'string'

      if (!source.kind) {
        if (hasScript === hasVaultPath) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'source without kind must provide exactly one of script or vaultPath',
            path: ['source'],
          })
        }

        return
      }

      if (source.kind === 'inline' || source.kind === 'inline_script') {
        if (!hasScript) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'source.script is required for inline source kinds',
            path: ['source', 'script'],
          })
        }

        if (hasVaultPath) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'source.vaultPath is not allowed for inline source kinds',
            path: ['source', 'vaultPath'],
          })
        }
      } else {
        if (!hasVaultPath) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'source.vaultPath is required for workspace source kinds',
            path: ['source', 'vaultPath'],
          })
        }

        if (hasScript) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'source.script is not allowed for workspace source kinds',
            path: ['source', 'script'],
          })
        }
      }
    }

    if (typeof value.filename === 'string' && hasTopLevelVaultPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'filename is only valid for inline script input',
        path: ['filename'],
      })
    }
  })

const canonicalExecuteArgsSchema = z
  .object({
    args: z.array(z.string().trim().min(1).max(1000)).optional(),
    attachments: z.array(sandboxAttachmentInputSchema).optional(),
    garden: z.string().trim().min(1).max(200).optional(),
    cwdVaultPath: z.string().trim().min(1).max(500).optional(),
    env: z.record(z.string().trim().min(1).max(200), z.string().max(10_000)).optional(),
    mode: z.enum(sandboxExecutionModeValues).optional(),
    network: sandboxNetworkRequestSchema,
    outputs: sandboxOutputRequestSchema,
    packages: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200),
            version: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .optional(),
    runtime: z.enum(sandboxRuntimeValues).optional(),
    source: executeSourceSchema,
    task: z.string().trim().min(1).max(500),
    vaultAccess: z.enum(['read_only', 'read_write']).optional(),
    vaultInputs: z
      .array(
        z
          .object({
            mountPath: z.string().trim().min(1).max(500).optional(),
            vaultPath: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()

const normalizeExecuteArgsInput = (
  value: z.infer<typeof executeArgsInputSchema>,
): z.infer<typeof canonicalExecuteArgsSchema> => {
  const { filename, script, source, vaultPath, ...rest } = value

  if (typeof source === 'string') {
    return {
      ...rest,
      source: {
        ...(filename ? { filename } : {}),
        kind: 'inline',
        script: source,
      },
    }
  }

  if (source) {
    if (source.kind === 'workspace' || source.kind === 'workspace_script') {
      return {
        ...rest,
        source: {
          kind: source.kind,
          vaultPath: source.vaultPath ?? '',
        },
      }
    }

    if (source.kind === 'inline' || source.kind === 'inline_script') {
      return {
        ...rest,
        source: {
          ...((source.filename ?? filename) ? { filename: source.filename ?? filename } : {}),
          kind: source.kind,
          script: source.script ?? '',
        },
      }
    }

    if (source.script) {
      return {
        ...rest,
        source: {
          ...((source.filename ?? filename) ? { filename: source.filename ?? filename } : {}),
          kind: 'inline',
          script: source.script,
        },
      }
    }

    return {
      ...rest,
      source: {
        kind: 'workspace',
        vaultPath: source.vaultPath ?? '',
      },
    }
  }

  if (script) {
    return {
      ...rest,
      source: {
        ...(filename ? { filename } : {}),
        kind: 'inline',
        script,
      },
    }
  }

  return {
    ...rest,
    source: {
      kind: 'workspace',
      vaultPath: vaultPath ?? '',
    },
  }
}

const executeArgsSchema = executeArgsInputSchema
  .transform(normalizeExecuteArgsInput)
  .pipe(canonicalExecuteArgsSchema)

const commitSandboxWritebackArgsSchema = z
  .object({
    operations: z
      .array(
        z
          .string()
          .trim()
          .regex(/^sbw_[A-Za-z0-9_-]{1,200}$/),
      )
      .optional(),
    sandboxExecutionId: z
      .string()
      .trim()
      .regex(/^sbx_[A-Za-z0-9_-]{1,200}$/),
  })
  .strict()

export type SandboxPolicyInput = z.infer<typeof sandboxPolicyInputSchema>
export type ExecuteArgs = z.infer<typeof canonicalExecuteArgsSchema>
export type CommitSandboxWritebackArgs = z.infer<typeof commitSandboxWritebackArgsSchema>

export interface NormalizedSandboxRequestedPackage extends SandboxRequestedPackage {
  installScriptsAllowed: boolean
  registryHost: string | null
}

export type NormalizedSandboxWritebackRequest =
  | (Extract<SandboxWritebackRequest, { mode: 'write' | 'copy' | 'move' }> & {
      requiresApproval: boolean
    })
  | (Extract<SandboxWritebackRequest, { mode: 'delete' }> & {
      requiresApproval: boolean
    })

export interface NormalizedSandboxExecutionRequest
  extends Omit<SandboxExecutionRequest, 'network'> {
  network: {
    allowedHosts?: string[]
    mode: SandboxNetworkMode
  }
  vaultAccess: Extract<SandboxVaultAccessMode, 'read_only' | 'read_write'>
}

export interface ValidatedSandboxJobRequest {
  networkMode: SandboxNetworkMode
  packages: NormalizedSandboxRequestedPackage[]
  request: NormalizedSandboxExecutionRequest
  vaultAccessMode: Extract<SandboxVaultAccessMode, 'read_only' | 'read_write'>
  writebacks: NormalizedSandboxWritebackRequest[]
}

const defaultSandboxPolicy = (): SandboxPolicy => ({
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

const toValidationResult = <TValue>(
  parsed: ReturnType<z.ZodType<TValue>['safeParse']>,
): Result<TValue, DomainError> =>
  parsed.success
    ? ok(parsed.data)
    : err({
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })

const normalizeList = (values: string[] | undefined): string[] | undefined => {
  if (!values || values.length === 0) {
    return undefined
  }

  const normalized = Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  )

  return normalized.length > 0 ? normalized : undefined
}

const normalizeSandboxPath = (value: string, label: string): Result<string, DomainError> => {
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

const normalizeInlineScriptFilename = (value: string): Result<string, DomainError> => {
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

const normalizeVaultPath = (value: string, label: string): Result<string, DomainError> => {
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

const normalizeHostList = (values: string[] | undefined): string[] | undefined => {
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

const normalizeSandboxEnv = (
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

const normalizeRegistryHostList = (values: string[] | undefined): string[] | undefined => {
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

const isVaultPathWithinAllowedRoots = (path: string, allowedRoots?: string[]): boolean => {
  if (!allowedRoots || allowedRoots.length === 0) {
    return true
  }

  return allowedRoots.some((root) => path === root || path.startsWith(`${root}/`))
}

export const parseSandboxPolicyJson = (value: unknown): Result<SandboxPolicy, DomainError> => {
  if (value === undefined || value === null) {
    return ok(defaultSandboxPolicy())
  }

  const parsed = toValidationResult(sandboxPolicyInputSchema.safeParse(value))

  if (!parsed.ok) {
    return parsed
  }

  const base = defaultSandboxPolicy()
  const allowedRoots: string[] = []

  for (const root of parsed.value.vault?.allowedRoots ?? []) {
    const normalizedRoot = normalizeVaultPath(root, 'sandbox.vault.allowedRoots entry')

    if (!normalizedRoot.ok) {
      return normalizedRoot
    }

    allowedRoots.push(normalizedRoot.value)
  }

  const hasExplicitEnginePolicy =
    parsed.value.runtime?.defaultEngine !== undefined ||
    (parsed.value.runtime?.allowedEngines?.length ?? 0) > 0

  const allowedEngines = Array.from(
    new Set(
      parsed.value.runtime?.allowedEngines ??
        (hasExplicitEnginePolicy ? base.runtime.allowedEngines : (['node'] as SandboxRuntime[])),
    ),
  )

  const defaultEngine =
    parsed.value.runtime?.defaultEngine ??
    (hasExplicitEnginePolicy ? base.runtime.defaultEngine : 'node')

  if (!allowedEngines.includes(defaultEngine)) {
    return err({
      message: 'sandbox.runtime.defaultEngine must be included in sandbox.runtime.allowedEngines',
      type: 'validation',
    })
  }

  if (
    parsed.value.runtime?.allowAutomaticCompatFallback === true &&
    !allowedEngines.includes('node')
  ) {
    return err({
      message:
        'sandbox.runtime.allowAutomaticCompatFallback requires sandbox.runtime.allowedEngines to include node',
      type: 'validation',
    })
  }

  return ok({
    enabled: parsed.value.enabled ?? base.enabled,
    network: {
      allowedHosts: normalizeHostList(parsed.value.network?.allowedHosts),
      mode: parsed.value.network?.mode ?? base.network.mode,
    },
    packages: {
      allowedPackages:
        parsed.value.packages?.allowedPackages && parsed.value.packages.allowedPackages.length > 0
          ? parsed.value.packages.allowedPackages.map((entry) => ({
              allowInstallScripts: entry.allowInstallScripts ?? false,
              name: entry.name.trim(),
              ...(entry.runtimes?.length ? { runtimes: Array.from(new Set(entry.runtimes)) } : {}),
              versionRange: entry.versionRange.trim(),
            }))
          : undefined,
      allowedRegistries: normalizeRegistryHostList(parsed.value.packages?.allowedRegistries),
      mode: parsed.value.packages?.mode ?? base.packages.mode,
    },
    runtime: {
      allowAutomaticCompatFallback:
        parsed.value.runtime?.allowAutomaticCompatFallback ??
        base.runtime.allowAutomaticCompatFallback,
      allowedEngines,
      allowWorkspaceScripts:
        parsed.value.runtime?.allowWorkspaceScripts ?? base.runtime.allowWorkspaceScripts,
      defaultEngine,
      maxDurationSec: parsed.value.runtime?.maxDurationSec ?? base.runtime.maxDurationSec,
      maxInputBytes: parsed.value.runtime?.maxInputBytes ?? base.runtime.maxInputBytes,
      maxMemoryMb: parsed.value.runtime?.maxMemoryMb ?? base.runtime.maxMemoryMb,
      maxOutputBytes: parsed.value.runtime?.maxOutputBytes ?? base.runtime.maxOutputBytes,
      nodeVersion: parsed.value.runtime?.nodeVersion?.trim() || base.runtime.nodeVersion,
    },
    shell:
      parsed.value.shell?.allowedCommands && parsed.value.shell.allowedCommands.length > 0
        ? {
            allowedCommands: normalizeList(parsed.value.shell.allowedCommands),
          }
        : undefined,
    vault: {
      allowedRoots: allowedRoots.length > 0 ? Array.from(new Set(allowedRoots)) : undefined,
      mode: parsed.value.vault?.mode ?? base.vault.mode,
      requireApprovalForDelete:
        parsed.value.vault?.requireApprovalForDelete ?? base.vault.requireApprovalForDelete,
      requireApprovalForMove:
        parsed.value.vault?.requireApprovalForMove ?? base.vault.requireApprovalForMove,
      requireApprovalForWorkspaceScript:
        parsed.value.vault?.requireApprovalForWorkspaceScript ??
        base.vault.requireApprovalForWorkspaceScript,
      requireApprovalForWrite:
        parsed.value.vault?.requireApprovalForWrite ?? base.vault.requireApprovalForWrite,
    },
  })
}

const validateExactPackageVersion = (
  input: SandboxRequestedPackage,
): Result<SandboxRequestedPackage, DomainError> => {
  if (!exactPackageVersionPattern.test(input.version)) {
    return err({
      message: `package ${input.name} must use an exact version`,
      type: 'validation',
    })
  }

  return ok({
    name: input.name.trim(),
    version: input.version.trim(),
  })
}

const resolveNetworkMode = (request: ExecuteArgs['network']): SandboxNetworkMode => {
  if (!request || request.mode === 'off') {
    return 'off'
  }

  return request.hosts && request.hosts.length > 0 ? 'allow_list' : 'open'
}

const resolveEffectiveNetworkRequest = (
  policy: SandboxPolicy,
  args: ExecuteArgs,
): {
  mode: SandboxNetworkMode
  requestedHosts?: string[]
} => {
  const requestedHosts = normalizeHostList(args.network?.hosts)
  const requestedPackages = args.packages ?? []

  if (requestedPackages.length === 0) {
    return {
      mode: resolveNetworkMode(args.network),
      ...(requestedHosts ? { requestedHosts } : {}),
    }
  }

  if (args.network && args.network.mode !== 'off') {
    return {
      mode: resolveNetworkMode(args.network),
      ...(requestedHosts ? { requestedHosts } : {}),
    }
  }

  if (policy.network.mode === 'allow_list') {
    return {
      mode: 'allow_list',
      ...((requestedHosts ?? policy.network.allowedHosts)
        ? { requestedHosts: requestedHosts ?? policy.network.allowedHosts }
        : {}),
    }
  }

  return {
    mode: policy.network.mode,
    ...(requestedHosts ? { requestedHosts } : {}),
  }
}

const resolvePackageRegistryHost = (policy: SandboxPolicy): string | null => {
  const allowedRegistries = policy.packages.allowedRegistries ?? []
  return allowedRegistries.length === 1 ? (allowedRegistries[0] ?? null) : null
}

const requiresWritebackApproval = (
  policy: SandboxPolicy,
  request: SandboxWritebackRequest,
): boolean => {
  switch (request.mode) {
    case 'delete':
      return policy.vault.requireApprovalForDelete ?? true
    case 'move':
      return policy.vault.requireApprovalForMove ?? true
    case 'copy':
    case 'write':
      return policy.vault.requireApprovalForWrite ?? true
  }
}

const toPermissionError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'permission',
  })

export const validateExecuteArgs = (value: unknown): Result<ExecuteArgs, DomainError> =>
  toValidationResult(executeArgsSchema.safeParse(value))

export const validateRunSandboxJobArgs = validateExecuteArgs

export const validateCommitSandboxWritebackArgs = (
  value: unknown,
): Result<CommitSandboxWritebackArgs, DomainError> =>
  toValidationResult(commitSandboxWritebackArgsSchema.safeParse(value))

export const validateSandboxExecutionRequest = (
  policy: SandboxPolicy,
  args: ExecuteArgs,
  options?: {
    defaultMode?: SandboxExecutionMode
    supportedRuntimes?: SandboxRuntime[]
  },
): Result<ValidatedSandboxJobRequest, DomainError> => {
  if (!policy.enabled) {
    return toPermissionError('sandbox execution is disabled for this agent')
  }

  const requestedMode = args.mode ?? options?.defaultMode ?? 'script'

  const normalizedEnv = normalizeSandboxEnv(args.env)

  if (!normalizedEnv.ok) {
    return normalizedEnv
  }

  const normalizedVaultInputs: NonNullable<SandboxExecutionRequest['vaultInputs']> = []

  for (const input of args.vaultInputs ?? []) {
    const normalizedVaultPath = normalizeVaultPath(input.vaultPath, 'vaultInputs[].vaultPath')

    if (!normalizedVaultPath.ok) {
      return normalizedVaultPath
    }

    if (!isVaultPathWithinAllowedRoots(normalizedVaultPath.value, policy.vault.allowedRoots)) {
      return toPermissionError(`vault input ${normalizedVaultPath.value} is outside allowed roots`)
    }

    normalizedVaultInputs.push({
      ...(input.mountPath ? { mountPath: input.mountPath.trim() } : {}),
      vaultPath: normalizedVaultPath.value,
    })
  }

  let normalizedCwdVaultPath: string | undefined

  if (args.cwdVaultPath) {
    const normalized = normalizeVaultPath(args.cwdVaultPath, 'cwdVaultPath')

    if (!normalized.ok) {
      return normalized
    }

    if (!isVaultPathWithinAllowedRoots(normalized.value, policy.vault.allowedRoots)) {
      return toPermissionError(`cwdVaultPath ${normalized.value} is outside allowed roots`)
    }

    normalizedCwdVaultPath = normalized.value
  }

  let normalizedSource: SandboxExecutionRequest['source']

  if (args.source.kind === 'workspace_script' || args.source.kind === 'workspace') {
    if (!policy.runtime.allowWorkspaceScripts) {
      return toPermissionError('workspace script execution is not allowed for this agent')
    }

    if (policy.vault.requireApprovalForWorkspaceScript) {
      return err({
        message: 'workspace script execution requires approval and is not implemented yet',
        type: 'conflict',
      })
    }

    const normalizedVaultPath = normalizeVaultPath(args.source.vaultPath, 'source.vaultPath')

    if (!normalizedVaultPath.ok) {
      return normalizedVaultPath
    }

    if (!isVaultPathWithinAllowedRoots(normalizedVaultPath.value, policy.vault.allowedRoots)) {
      return toPermissionError(
        `workspace script ${normalizedVaultPath.value} is outside allowed roots`,
      )
    }

    normalizedSource = {
      kind: 'workspace_script',
      vaultPath: normalizedVaultPath.value,
    }
  } else {
    let normalizedFilename: string | undefined

    if (args.source.filename) {
      const candidateFilename = normalizeInlineScriptFilename(args.source.filename)

      if (!candidateFilename.ok) {
        return candidateFilename
      }

      normalizedFilename = candidateFilename.value
    }

    normalizedSource = {
      ...(normalizedFilename ? { filename: normalizedFilename } : {}),
      kind: 'inline_script',
      script: args.source.script.trim(),
    }
  }

  const effectiveNetwork = resolveEffectiveNetworkRequest(policy, args)
  const networkMode = effectiveNetwork.mode
  const requestedHosts = effectiveNetwork.requestedHosts

  if (policy.network.mode === 'off' && networkMode !== 'off') {
    return toPermissionError('sandbox network access is disabled for this agent')
  }

  if (policy.network.mode === 'allow_list' && networkMode === 'open') {
    return toPermissionError('sandbox network access is restricted to an allow list for this agent')
  }

  if (networkMode === 'allow_list' && requestedHosts && policy.network.allowedHosts) {
    const disallowedHost = requestedHosts.find(
      (host) => !policy.network.allowedHosts!.includes(host),
    )

    if (disallowedHost) {
      return toPermissionError(
        `sandbox network host ${disallowedHost} is not in the agent allow list`,
      )
    }
  }

  const normalizedPackages: NormalizedSandboxRequestedPackage[] = []

  if (requestedMode === 'bash' && (args.packages?.length ?? 0) > 0) {
    return err({
      message:
        'sandbox bash mode does not support packages[]; use script mode for package-backed jobs',
      type: 'validation',
    })
  }

  for (const requestedPackage of args.packages ?? []) {
    const validatedPackage = validateExactPackageVersion(requestedPackage)

    if (!validatedPackage.ok) {
      return validatedPackage
    }

    if (validatedPackage.value.name === 'just-bash') {
      return err({
        message:
          'just-bash is already available by default in sandbox Node compat jobs; remove it from packages[]',
        type: 'validation',
      })
    }

    if (policy.packages.mode === 'disabled') {
      return toPermissionError('package installation is disabled for this agent')
    }

    let installScriptsAllowed = false

    if (policy.packages.mode === 'allow_list') {
      const allowedEntry = policy.packages.allowedPackages?.find(
        (entry) =>
          entry.name === validatedPackage.value.name &&
          entry.versionRange === validatedPackage.value.version,
      )

      if (!allowedEntry) {
        return toPermissionError(
          `package ${validatedPackage.value.name}@${validatedPackage.value.version} is not allowlisted for this agent`,
        )
      }

      installScriptsAllowed = allowedEntry.allowInstallScripts ?? false
    }

    normalizedPackages.push({
      installScriptsAllowed,
      name: validatedPackage.value.name,
      registryHost: resolvePackageRegistryHost(policy),
      version: validatedPackage.value.version,
    })
  }

  if (normalizedPackages.length > 0 && networkMode === 'off') {
    return toPermissionError(
      policy.network.mode === 'off'
        ? 'package installation requires sandbox network access, but sandbox network access is disabled for this agent'
        : 'package installation requires sandbox network access',
    )
  }

  const normalizedWritebacks: NormalizedSandboxWritebackRequest[] = []

  for (const writeback of args.outputs?.writeBack ?? []) {
    const normalizedVaultPath = normalizeVaultPath(
      writeback.toVaultPath,
      'outputs.writeBack[].toVaultPath',
    )

    if (!normalizedVaultPath.ok) {
      return normalizedVaultPath
    }

    if (!isVaultPathWithinAllowedRoots(normalizedVaultPath.value, policy.vault.allowedRoots)) {
      return toPermissionError(
        `write-back target ${normalizedVaultPath.value} is outside allowed roots`,
      )
    }

    if (writeback.mode === 'delete') {
      normalizedWritebacks.push({
        mode: 'delete',
        requiresApproval: requiresWritebackApproval(policy, writeback),
        toVaultPath: normalizedVaultPath.value,
      })
      continue
    }

    const normalizedFromPath = normalizeSandboxPath(
      writeback.fromPath,
      'outputs.writeBack[].fromPath',
    )

    if (!normalizedFromPath.ok) {
      return normalizedFromPath
    }

    normalizedWritebacks.push({
      fromPath: normalizedFromPath.value,
      mode: writeback.mode,
      requiresApproval: requiresWritebackApproval(policy, writeback),
      toVaultPath: normalizedVaultPath.value,
    })
  }

  const requiresVaultRead =
    normalizedVaultInputs.length > 0 ||
    normalizedCwdVaultPath !== undefined ||
    normalizedSource.kind === 'workspace_script'
  const requiresVaultWrite = normalizedWritebacks.length > 0
  const requestedVaultAccess: Extract<SandboxVaultAccessMode, 'read_only' | 'read_write'> =
    args.vaultAccess ?? (requiresVaultWrite ? 'read_write' : 'read_only')

  if (requiresVaultRead && policy.vault.mode === 'none') {
    return toPermissionError('vault access is disabled for this agent')
  }

  if (requestedVaultAccess === 'read_write' && policy.vault.mode !== 'read_write') {
    return toPermissionError('sandbox write-back requires read_write vault access for this agent')
  }

  if (requiresVaultWrite && requestedVaultAccess !== 'read_write') {
    return err({
      message: 'write-back operations require vaultAccess "read_write"',
      type: 'validation',
    })
  }

  const selectedRuntime = selectSandboxRuntime({
    policy,
    requestedPackages: normalizedPackages.map((requestedPackage) => ({
      name: requestedPackage.name,
      version: requestedPackage.version,
    })),
    requestedRuntime: args.runtime,
    supportedRuntimes: options?.supportedRuntimes,
  })

  if (!selectedRuntime.ok) {
    return selectedRuntime
  }

  return ok({
    networkMode,
    packages: normalizedPackages,
    request: {
      ...(args.args && args.args.length > 0 ? { args: [...args.args] } : {}),
      ...(args.attachments && args.attachments.length > 0
        ? {
            attachments: args.attachments.map((attachment) => ({
              fileId: attachment.fileId.trim(),
              ...(attachment.mountPath ? { mountPath: attachment.mountPath.trim() } : {}),
            })),
          }
        : {}),
      ...(normalizedCwdVaultPath ? { cwdVaultPath: normalizedCwdVaultPath } : {}),
      ...(normalizedEnv.value ? { env: normalizedEnv.value } : {}),
      network: {
        ...(requestedHosts && requestedHosts.length > 0 ? { allowedHosts: requestedHosts } : {}),
        mode: networkMode,
      },
      ...(args.outputs
        ? {
            outputs: {
              ...(args.outputs.attachGlobs && args.outputs.attachGlobs.length > 0
                ? { attachGlobs: [...args.outputs.attachGlobs] }
                : {}),
              ...(normalizedWritebacks.length > 0
                ? {
                    writeBack: normalizedWritebacks.map((writeback) =>
                      writeback.mode === 'delete'
                        ? {
                            mode: 'delete' as const,
                            toVaultPath: writeback.toVaultPath,
                          }
                        : {
                            fromPath: writeback.fromPath,
                            mode: writeback.mode,
                            toVaultPath: writeback.toVaultPath,
                          },
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(normalizedPackages.length > 0
        ? {
            packages: normalizedPackages.map((requestedPackage) => ({
              name: requestedPackage.name,
              version: requestedPackage.version,
            })),
          }
        : {}),
      mode: requestedMode,
      runtime: selectedRuntime.value.runtime,
      source: normalizedSource,
      task: args.task.trim(),
      vaultAccess: requestedVaultAccess,
      ...(normalizedVaultInputs.length > 0 ? { vaultInputs: normalizedVaultInputs } : {}),
    },
    vaultAccessMode: requestedVaultAccess,
    writebacks: normalizedWritebacks,
  })
}
