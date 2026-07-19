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
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import {
  isVaultPathWithinAllowedRoots,
  normalizeHostList,
  normalizeInlineScriptFilename,
  normalizeSandboxEnv,
  normalizeSandboxPath,
  normalizeVaultPath,
  toValidationResult,
} from './sandbox-policy-normalize'
import {
  type CommitSandboxWritebackArgs,
  commitSandboxWritebackArgsSchema,
  type ExecuteArgs,
  executeArgsSchema,
  type NormalizedSandboxRequestedPackage,
  type NormalizedSandboxWritebackRequest,
  type ValidatedSandboxJobRequest,
} from './sandbox-policy-schemas'
import { selectSandboxRuntime } from './sandbox-runtime-selector'

const exactPackageVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

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
