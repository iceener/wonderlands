import { dirname } from 'node:path'

import type { SandboxExecutionFileRecord } from '../../domain/sandbox/sandbox-execution-file-repository'
import type { SandboxExecutionRecord } from '../../domain/sandbox/sandbox-execution-repository'
import type { SandboxRunFailure } from '../../domain/sandbox/sandbox-runner'
import type {
  SandboxExecutionRequest,
  SandboxExecutionStatus,
  SandboxNetworkMode,
  SandboxProvider,
  SandboxRuntime,
} from '../../domain/sandbox/types'

type SandboxResultFile = {
  fileId: string
  mimeType: string | null
  originalFilename: string | null
  sandboxPath: string
  sizeBytes: number | null
}

type SandboxResultPackage = {
  errorText: string | null
  id: string
  name: string
  requestedVersion: string | null
  resolvedVersion: string | null
  status: string
}

type SandboxResultWriteback = {
  appliedAt: string | null
  approvedAt: string | null
  errorText: string | null
  id: string
  operation: string
  requiresApproval: boolean
  sourceSandboxPath?: string
  status: string
  targetVaultPath: string
}

export interface SandboxMountedInputSummary {
  kind: 'directory' | 'file'
  sandboxPath: string
  source: 'attachment' | 'vault'
  sourceRef: string
}

export interface SandboxIsolationSummary {
  cwd: string
  filesPersistAcrossCalls: false
  freshSandboxPerCall: true
  mountedInputs: SandboxMountedInputSummary[]
  networkEnforcement: 'best_effort' | 'enforced'
  outputVisibleOnlyThisCall: true
  packageInstallStrategy: 'none' | 'npm_install_ignore_scripts' | 'prebaked_runtime_packages'
  packagesPersistAcrossCalls: false
  requestedNetworkMode: SandboxNetworkMode
  effectiveNetworkMode: SandboxNetworkMode
  stagedRoots: string[]
}

export interface SandboxExecutionResultOutput {
  durationMs: number | null
  effectiveNetworkMode: SandboxNetworkMode
  failure: SandboxRunFailure | null
  files: SandboxResultFile[]
  isolation: SandboxIsolationSummary
  kind: 'sandbox_result'
  outputDir: '/output'
  packages: SandboxResultPackage[]
  presentationHint: string
  provider: SandboxProvider
  runtime: SandboxRuntime
  sandboxExecutionId: string
  status: SandboxExecutionStatus
  stderr: string | null
  stdout: string | null
  writebacks: SandboxResultWriteback[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toSandboxRequest = (value: unknown): SandboxExecutionRequest =>
  value as SandboxExecutionRequest

const toRequestedNetworkMode = (requestJson: unknown): SandboxNetworkMode => {
  if (!isRecord(requestJson) || !isRecord(requestJson.network)) {
    return 'off'
  }

  const mode = requestJson.network.mode

  if (mode === 'off' || mode === 'allow_list' || mode === 'open') {
    return mode
  }

  if (mode === 'on') {
    const hosts = Array.isArray(requestJson.network.allowedHosts)
      ? requestJson.network.allowedHosts
      : Array.isArray(requestJson.network.hosts)
        ? requestJson.network.hosts
        : []

    return hosts.length > 0 ? 'allow_list' : 'open'
  }

  return 'off'
}

const toSandboxCwd = (request: SandboxExecutionRequest): string =>
  request.cwdVaultPath ??
  (request.source.kind === 'workspace_script' ? dirname(request.source.vaultPath) : '/work')

const inferVaultMountKind = (
  request: SandboxExecutionRequest,
  file: Pick<SandboxExecutionFileRecord, 'sandboxPath' | 'sourceVaultPath'>,
): 'directory' | 'file' => {
  if (
    request.source.kind === 'workspace_script' &&
    file.sourceVaultPath === request.source.vaultPath
  ) {
    return 'file'
  }

  if (request.cwdVaultPath && file.sourceVaultPath === request.cwdVaultPath) {
    return 'directory'
  }

  const explicitVaultInput = request.vaultInputs?.find(
    (entry) =>
      entry.vaultPath === file.sourceVaultPath &&
      (entry.mountPath ?? entry.vaultPath) === file.sandboxPath,
  )

  if (!explicitVaultInput) {
    return 'directory'
  }

  if (
    explicitVaultInput.vaultPath.endsWith('/') ||
    (explicitVaultInput.mountPath ?? '').endsWith('/')
  ) {
    return 'directory'
  }

  return 'directory'
}

const dedupeMountedInputs = (
  inputs: SandboxMountedInputSummary[],
): SandboxMountedInputSummary[] => {
  const seen = new Set<string>()
  const deduped: SandboxMountedInputSummary[] = []

  for (const input of inputs) {
    const key = `${input.source}:${input.sourceRef}:${input.sandboxPath}:${input.kind}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(input)
  }

  return deduped
}

const toMountedInputs = (
  request: SandboxExecutionRequest,
  stagedFiles: Array<
    Pick<SandboxExecutionFileRecord, 'role' | 'sandboxPath' | 'sourceFileId' | 'sourceVaultPath'>
  >,
): SandboxMountedInputSummary[] => {
  const mountedInputs: SandboxMountedInputSummary[] = []

  for (const file of stagedFiles) {
    if (file.role === 'attachment_input' && typeof file.sourceFileId === 'string') {
      mountedInputs.push({
        kind: 'file',
        sandboxPath: file.sandboxPath,
        source: 'attachment',
        sourceRef: file.sourceFileId,
      })
      continue
    }

    if (file.role === 'vault_input' && typeof file.sourceVaultPath === 'string') {
      mountedInputs.push({
        kind: inferVaultMountKind(request, file),
        sandboxPath: file.sandboxPath,
        source: 'vault',
        sourceRef: file.sourceVaultPath,
      })
    }
  }

  return dedupeMountedInputs(mountedInputs)
}

export const buildSandboxIsolationSummary = (input: {
  effectiveNetworkMode: SandboxNetworkMode
  packagesCount: number
  provider: SandboxProvider
  requestJson: unknown
  runtime: SandboxRuntime
  stagedFiles: Array<
    Pick<SandboxExecutionFileRecord, 'role' | 'sandboxPath' | 'sourceFileId' | 'sourceVaultPath'>
  >
}): SandboxIsolationSummary => {
  const request = toSandboxRequest(input.requestJson)
  const mountedInputs = toMountedInputs(request, input.stagedFiles)
  const hasVaultMount = mountedInputs.some((entry) => entry.source === 'vault')
  const stagedRoots = ['/input', '/work', '/output']

  if (hasVaultMount) {
    stagedRoots.push('/vault')
  }

  return {
    cwd: toSandboxCwd(request),
    filesPersistAcrossCalls: false,
    freshSandboxPerCall: true,
    mountedInputs,
    networkEnforcement: input.provider === 'local_dev' ? 'best_effort' : 'enforced',
    outputVisibleOnlyThisCall: true,
    packageInstallStrategy:
      input.runtime === 'node' && input.packagesCount > 0 ? 'npm_install_ignore_scripts' : 'none',
    packagesPersistAcrossCalls: false,
    requestedNetworkMode: toRequestedNetworkMode(input.requestJson),
    effectiveNetworkMode: input.effectiveNetworkMode,
    stagedRoots,
  }
}

export const coerceSandboxFailure = (value: unknown): SandboxRunFailure | null =>
  isRecord(value) && typeof value.summary === 'string'
    ? (value as unknown as SandboxRunFailure)
    : null

export const buildSandboxExecutionOutput = (input: {
  durationMs: number | null
  effectiveNetworkMode: SandboxNetworkMode
  execution: Pick<SandboxExecutionRecord, 'id' | 'provider' | 'requestJson' | 'runtime'>
  failure: SandboxRunFailure | null
  files: SandboxResultFile[]
  packages: SandboxResultPackage[]
  stagedFiles: Array<
    Pick<SandboxExecutionFileRecord, 'role' | 'sandboxPath' | 'sourceFileId' | 'sourceVaultPath'>
  >
  status: SandboxExecutionStatus
  stderr: string | null
  stdout: string | null
  writebacks: SandboxResultWriteback[]
}): SandboxExecutionResultOutput => ({
  durationMs: input.durationMs,
  effectiveNetworkMode: input.effectiveNetworkMode,
  failure: input.failure,
  files: input.files,
  isolation: buildSandboxIsolationSummary({
    effectiveNetworkMode: input.effectiveNetworkMode,
    packagesCount: input.packages.length,
    provider: input.execution.provider,
    requestJson: input.execution.requestJson,
    runtime: input.execution.runtime,
    stagedFiles: input.stagedFiles,
  }),
  kind: 'sandbox_result',
  outputDir: '/output',
  packages: input.packages,
  presentationHint:
    input.files.length > 0
      ? 'Files listed in files are already attached to the conversation UI. In the follow-up reply, tell the user the file is attached by filename instead of pasting raw API or /vault paths unless asked.'
      : 'No files were attached from this sandbox run.',
  provider: input.execution.provider,
  runtime: input.execution.runtime,
  sandboxExecutionId: input.execution.id,
  status: input.status,
  stderr: input.stderr,
  stdout: input.stdout,
  writebacks: input.writebacks,
})
