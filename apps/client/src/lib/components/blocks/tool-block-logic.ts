import type {
  MessageAttachment,
  ToolInteractionBlock,
} from '@wonderlands/contracts/chat'
import {
  type BackendSandboxExecution,
  type BackendSandboxExecutionFailure,
  type BackendSandboxExecutionFile,
  type BackendSandboxIsolationSummary,
  type BackendSandboxWritebackOperation,
} from '../../services/api'
import { escapeHtml, hljs } from '../../services/markdown/highlight'

export const toolDurationMs = (block: ToolInteractionBlock): number | null => {
  if (block.status !== 'complete') return null
  const created = Date.parse(block.createdAt)
  const finished = block.finishedAt != null ? Date.parse(block.finishedAt) : created
  if (!Number.isFinite(created) || !Number.isFinite(finished)) return null
  return Math.max(0, finished - created)
}

export const formatDurationLabel = (durationMs: number | null): string | null => {
  if (durationMs == null) {
    return null
  }

  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
}

export const completionKey = (block: ToolInteractionBlock): string => `${block.toolCallId}:${block.finishedAt ?? ''}`

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSandboxWritebackOperation = (value: unknown): value is BackendSandboxWritebackOperation =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.operation === 'string' &&
  (value.sourceSandboxPath === undefined || typeof value.sourceSandboxPath === 'string') &&
  typeof value.targetVaultPath === 'string' &&
  typeof value.status === 'string' &&
  typeof value.requiresApproval === 'boolean' &&
  (value.errorText === null || typeof value.errorText === 'string') &&
  (value.approvedAt === null || typeof value.approvedAt === 'string') &&
  (value.appliedAt === null || typeof value.appliedAt === 'string')

const isSandboxFailurePhase = (value: unknown): value is BackendSandboxExecutionFailure['phase'] =>
  value === 'package_install' || value === 'runner_setup' || value === 'script_execution'

const isSandboxFailureRunner = (
  value: unknown,
): value is BackendSandboxExecutionFailure['runner'] => value === 'deno' || value === 'local_dev'

const isSandboxExecutionFailure = (value: unknown): value is BackendSandboxExecutionFailure =>
  isRecord(value) &&
  isSandboxFailurePhase(value.phase) &&
  isSandboxFailureRunner(value.runner) &&
  typeof value.summary === 'string' &&
  (value.hint === null || typeof value.hint === 'string') &&
  (value.stderrPreview === null || typeof value.stderrPreview === 'string') &&
  (value.stdoutPreview === null || typeof value.stdoutPreview === 'string') &&
  (value.signal === null || typeof value.signal === 'string') &&
  (value.exitCode === null || typeof value.exitCode === 'number')

const isSandboxIsolationSummary = (value: unknown): value is BackendSandboxIsolationSummary =>
  isRecord(value) &&
  typeof value.cwd === 'string' &&
  typeof value.freshSandboxPerCall === 'boolean' &&
  typeof value.filesPersistAcrossCalls === 'boolean' &&
  typeof value.packagesPersistAcrossCalls === 'boolean' &&
  typeof value.outputVisibleOnlyThisCall === 'boolean' &&
  Array.isArray(value.stagedRoots) &&
  Array.isArray(value.mountedInputs) &&
  typeof value.networkEnforcement === 'string' &&
  typeof value.packageInstallStrategy === 'string' &&
  isSandboxNetworkMode(value.requestedNetworkMode) &&
  isSandboxNetworkMode(value.effectiveNetworkMode)

export const isSandboxNetworkMode = (
  value: unknown,
): value is NonNullable<BackendSandboxExecution['effectiveNetworkMode']> =>
  value === 'off' || value === 'allow_list' || value === 'open'

const isSandboxProvider = (value: unknown): value is BackendSandboxExecution['provider'] =>
  value === 'deno' || value === 'local_dev'

const isSandboxRuntime = (value: unknown): value is BackendSandboxExecution['runtime'] =>
  value === 'lo' || value === 'node'

const extractSandboxExecutionValue = (value: unknown): unknown => {
  if (isRecord(value) && isRecord(value.details)) {
    return value.details
  }

  return value
}

export const parseSandboxExecution = (value: unknown): BackendSandboxExecution | null => {
  const candidate = extractSandboxExecutionValue(value)

  if (
    !isRecord(candidate) ||
    typeof candidate.sandboxExecutionId !== 'string' ||
    typeof candidate.status !== 'string' ||
    !Array.isArray(candidate.files) ||
    !Array.isArray(candidate.writebacks)
  ) {
    return null
  }

  const files = candidate.files.filter(isSandboxExecutionFile)
  const writebacks = candidate.writebacks.filter(isSandboxWritebackOperation)

  if (files.length !== candidate.files.length || writebacks.length !== candidate.writebacks.length) {
    return null
  }

  return {
    durationMs: typeof candidate.durationMs === 'number' ? candidate.durationMs : null,
    effectiveNetworkMode: isSandboxNetworkMode(candidate.effectiveNetworkMode)
      ? candidate.effectiveNetworkMode
      : null,
    failure: isSandboxExecutionFailure(candidate.failure) ? candidate.failure : null,
    files,
    isolation: isSandboxIsolationSummary(candidate.isolation) ? candidate.isolation : undefined,
    kind: candidate.kind === 'sandbox_result' ? 'sandbox_result' : undefined,
    outputDir: '/output',
    packages: Array.isArray(candidate.packages) ? candidate.packages : undefined,
    presentationHint:
      typeof candidate.presentationHint === 'string' ? candidate.presentationHint : undefined,
    provider: isSandboxProvider(candidate.provider) ? candidate.provider : 'local_dev',
    runtime: isSandboxRuntime(candidate.runtime) ? candidate.runtime : 'node',
    sandboxExecutionId: candidate.sandboxExecutionId,
    status:
      candidate.status === 'queued' ||
      candidate.status === 'running' ||
      candidate.status === 'completed' ||
      candidate.status === 'failed' ||
      candidate.status === 'cancelled'
        ? candidate.status
        : 'failed',
    stderr: typeof candidate.stderr === 'string' ? candidate.stderr : null,
    stdout: typeof candidate.stdout === 'string' ? candidate.stdout : null,
    writebacks,
  }
}

/** Parse generate_image tool args for skeleton layout. */
export const parseImageToolArgs = (value: unknown): { aspectRatio: string | null; count: number } => {
  if (!isRecord(value)) return { aspectRatio: null, count: 1 }
  const aspectRatio = typeof value.aspectRatio === 'string' ? value.aspectRatio : null
  const refs = Array.isArray(value.references) ? value.references.length : 0
  return { aspectRatio, count: Math.max(1, refs || 1) }
}

/** A single image entry from the generate_image tool output. */
export interface ImageOutputEntry {
  fileId: string
  mimeType: string
  name: string
}

/** Parse generate_image tool output for completion summary and inline preview. */
export const parseImageToolOutput = (
  value: unknown,
): {
  imageCount: number
  images: ImageOutputEntry[]
  model: string | null
  provider: string | null
} | null => {
  if (!isRecord(value) || typeof value.imageCount !== 'number') return null
  const images: ImageOutputEntry[] = []
  if (Array.isArray(value.images)) {
    for (const img of value.images) {
      if (isRecord(img) && typeof img.fileId === 'string') {
        images.push({
          fileId: img.fileId as string,
          mimeType: typeof img.mimeType === 'string' ? (img.mimeType as string) : 'image/png',
          name: typeof img.name === 'string' ? (img.name as string) : 'generated image',
        })
      }
    }
  }
  return {
    imageCount: value.imageCount,
    images,
    model: typeof value.model === 'string' ? value.model : null,
    provider: typeof value.provider === 'string' ? value.provider : null,
  }
}

/** Convert an aspect ratio string like "16:9" into a decimal multiplier (width / height). */
export const aspectRatioToDecimal = (ratio: string | null): number => {
  if (!ratio) return 1
  const parts = ratio.split(':')
  if (parts.length !== 2) return 1
  const w = Number(parts[0])
  const h = Number(parts[1])
  return w > 0 && h > 0 ? w / h : 1
}

export const SKELETON_HEIGHT = 160
export const SKELETON_MAX_WIDTH = 280

export const parseToolErrorMessage = (value: unknown): string | null => {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== 'string') {
    return null
  }

  return value.error.message
}

export const formatSandboxNetworkMode = (
  value: NonNullable<BackendSandboxExecution['effectiveNetworkMode']>,
): string => {
  switch (value) {
    case 'off':
      return 'Off'
    case 'allow_list':
      return 'Allow list'
    case 'open':
      return 'Open'
  }
}

export const formatSandboxProvider = (value: BackendSandboxExecution['provider']): string => {
  switch (value) {
    case 'deno':
      return 'deno'
    case 'local_dev':
      return 'local_dev'
  }
}

export const formatSandboxRuntime = (value: BackendSandboxExecution['runtime']): string => {
  switch (value) {
    case 'lo':
      return 'lo'
    case 'node':
      return 'Node compat'
  }
}

export const sandboxStatusLabel = (status: BackendSandboxWritebackOperation['status']): string => {
  switch (status) {
    case 'pending':
      return 'Pending approval'
    case 'approved':
      return 'Approved'
    case 'applied':
      return 'Committed'
    case 'rejected':
      return 'Rejected'
    case 'failed':
      return 'Failed'
  }
}

export const sandboxStatusClass = (status: BackendSandboxWritebackOperation['status']): string => {
  switch (status) {
    case 'pending':
      return 'text-accent'
    case 'approved':
      return 'text-text-secondary'
    case 'applied':
      return 'text-text-primary'
    case 'rejected':
      return 'text-danger-text'
    case 'failed':
      return 'text-danger-text'
  }
}

export const highlightJson = (text: string): string => {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language: 'json' }).value
  } catch {
    return escapeHtml(text)
  }
}

export const highlightCode = (text: string, language: string): string => {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language }).value
  } catch {
    return escapeHtml(text)
  }
}

export const extractSandboxScript = (
  args: Record<string, unknown> | null,
): { script: string; lang: string; rest: Record<string, unknown> } | null => {
  if (!args) return null
  const source = args.source
  const scriptSource = isRecord(source) ? source : args
  const script = scriptSource.script
  if (typeof script !== 'string') return null
  const kind = (isRecord(source) ? source.kind : (args.kind ?? args.mode)) as string | undefined
  const lang = kind === 'bash' ? 'bash' : 'javascript'
  const rest = { ...args }
  if (isRecord(source)) {
    const { script: _, ...restSource } = source as Record<string, unknown>
    rest.source = restSource
  } else {
    delete rest.script
  }
  return { script, lang, rest }
}

export const isSandboxExecutionFile = (value: unknown): value is BackendSandboxExecutionFile =>
  isRecord(value) &&
  typeof value.fileId === 'string' &&
  typeof value.sandboxPath === 'string' &&
  typeof value.sizeBytes === 'number'
