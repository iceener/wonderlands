import type {
  BackendRun,
  ExecuteRunInput,
  PostThreadMessageInput,
  PostThreadMessageOutput,
  ProviderName,
  ResumeRunOutput,
  RunExecutionOutput,
  RunId,
  StartThreadInteractionInput,
  StartThreadInteractionOutput,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { apiRequest } from '../backend'

export interface BackendSandboxExecutionFile {
  fileId: string
  mimeType: string | null
  originalFilename: string | null
  sandboxPath: string
  sizeBytes: number | null
}

export interface BackendSandboxExecutionFailure {
  code?: string | null
  exitCode: number | null
  hint: string | null
  message?: string
  nextAction?: string | null
  origin?: 'control_plane' | 'guest' | 'policy' | null
  phase: 'package_install' | 'runner_setup' | 'script_execution'
  retryable?: boolean
  runner: 'deno' | 'local_dev'
  signal: string | null
  stderrPreview: string | null
  stdoutPreview: string | null
  summary: string
}

export interface BackendSandboxIsolationSummary {
  cwd: string
  filesPersistAcrossCalls: boolean
  freshSandboxPerCall: boolean
  mountedInputs: Array<{
    kind: 'directory' | 'file'
    sandboxPath: string
    source: 'attachment' | 'vault'
    sourceRef: string
  }>
  networkEnforcement: 'best_effort' | 'enforced'
  outputVisibleOnlyThisCall: boolean
  packageInstallStrategy: 'none' | 'npm_install_ignore_scripts' | 'prebaked_runtime_packages'
  packagesPersistAcrossCalls: boolean
  requestedNetworkMode: 'off' | 'allow_list' | 'open'
  effectiveNetworkMode: 'off' | 'allow_list' | 'open'
  stagedRoots: string[]
}

export interface BackendSandboxExecutionPackage {
  errorText: string | null
  id: string
  name: string
  requestedVersion: string | null
  resolvedVersion: string | null
  status: string
}

export interface BackendSandboxWritebackOperation {
  appliedAt: string | null
  approvedAt: string | null
  errorText: string | null
  id: string
  operation: 'write' | 'copy' | 'move' | 'delete'
  requiresApproval: boolean
  sourceSandboxPath?: string
  status: 'pending' | 'approved' | 'applied' | 'rejected' | 'failed'
  targetVaultPath: string
}

export interface BackendSandboxExecution {
  durationMs: number | null
  effectiveNetworkMode: 'off' | 'allow_list' | 'open' | null
  failure: BackendSandboxExecutionFailure | null
  files: BackendSandboxExecutionFile[]
  isolation?: BackendSandboxIsolationSummary
  kind?: 'sandbox_result'
  outputDir: '/output'
  packages?: BackendSandboxExecutionPackage[]
  presentationHint?: string
  provider: 'deno' | 'local_dev'
  runtime: 'lo' | 'node'
  sandboxExecutionId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stderr: string | null
  stdout: string | null
  writebacks: BackendSandboxWritebackOperation[]
}

export interface ReviewSandboxWritebacksOutput {
  executionId: string
  skipped: Array<{
    id: string
    reason: string
  }>
  updated: BackendSandboxWritebackOperation[]
  writebacks: BackendSandboxWritebackOperation[]
}

export interface CommitSandboxWritebacksOutput {
  applied: BackendSandboxWritebackOperation[]
  executionId: string
  skipped: Array<{
    id: string
    reason: string
  }>
  writebacks: BackendSandboxWritebackOperation[]
}

export const startThreadInteraction = (
  threadId: ThreadId,
  input: StartThreadInteractionInput,
): Promise<StartThreadInteractionOutput> =>
  apiRequest<StartThreadInteractionOutput>(`/threads/${threadId}/interactions`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const postThreadMessage = (
  threadId: ThreadId,
  input: PostThreadMessageInput,
): Promise<PostThreadMessageOutput> =>
  apiRequest<PostThreadMessageOutput>(`/threads/${threadId}/messages`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const executeRun = (runId: RunId, input: ExecuteRunInput): Promise<RunExecutionOutput> =>
  apiRequest<RunExecutionOutput>(`/runs/${runId}/execute`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const getRun = (runId: RunId): Promise<BackendRun> =>
  apiRequest<BackendRun>(`/runs/${runId}`)

export const resumeRun = (
  runId: RunId,
  input: {
    approve?: boolean
    errorMessage?: string
    maxOutputTokens?: number
    model?: string
    modelAlias?: string
    output?: unknown
    provider?: ProviderName
    rememberApproval?: boolean
    temperature?: number
    waitId: string
  },
): Promise<ResumeRunOutput> =>
  apiRequest<ResumeRunOutput>(`/runs/${runId}/resume`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const cancelRun = (
  runId: RunId,
  reason?: string,
): Promise<{ runId: RunId; status: 'cancelled' }> =>
  apiRequest<{ runId: RunId; status: 'cancelled' }>(`/runs/${runId}/cancel`, {
    body: JSON.stringify(reason ? { reason } : {}),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const getRunSandboxExecution = (
  runId: RunId,
  sandboxExecutionId: string,
): Promise<BackendSandboxExecution> =>
  apiRequest<BackendSandboxExecution>(
    `/runs/${runId}/sandbox/${encodeURIComponent(sandboxExecutionId)}`,
  )

export const reviewRunSandboxWritebacks = (
  runId: RunId,
  sandboxExecutionId: string,
  input: {
    operations: Array<{
      decision: 'approve' | 'reject'
      id: string
    }>
  },
): Promise<ReviewSandboxWritebacksOutput> =>
  apiRequest<ReviewSandboxWritebacksOutput>(
    `/runs/${runId}/sandbox/${encodeURIComponent(sandboxExecutionId)}/writebacks/review`,
    {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

export const commitRunSandboxWritebacks = (
  runId: RunId,
  sandboxExecutionId: string,
  input: {
    operations?: string[]
  } = {},
): Promise<CommitSandboxWritebacksOutput> =>
  apiRequest<CommitSandboxWritebacksOutput>(
    `/runs/${runId}/sandbox/${encodeURIComponent(sandboxExecutionId)}/writebacks/commit`,
    {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
