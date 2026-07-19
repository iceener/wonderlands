import { z } from 'zod'

import type {
  SandboxExecutionRequest,
  SandboxNetworkMode,
  SandboxRequestedPackage,
  SandboxVaultAccessMode,
  SandboxWritebackRequest,
} from '../../domain/sandbox/types'
import {
  sandboxExecutionModeValues,
  sandboxNetworkModeValues,
  sandboxRuntimeValues,
  sandboxVaultAccessModeValues,
} from '../../domain/sandbox/types'

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

export const executeArgsSchema = executeArgsInputSchema
  .transform(normalizeExecuteArgsInput)
  .pipe(canonicalExecuteArgsSchema)

export const commitSandboxWritebackArgsSchema = z
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
