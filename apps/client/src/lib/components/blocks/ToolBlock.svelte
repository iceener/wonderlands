<script lang="ts">
import {
  asRunId,
  type MessageAttachment,
  type ToolInteractionBlock,
} from '@wonderlands/contracts/chat'
import { onMount } from 'svelte'
import { resolveTextPreviewItem } from '../../preview/preview-adapters'
import { tryGetPreviewContext } from '../../preview/preview-context'
import { formatStructuredValue } from '../../runtime/format'
import {
  isSandboxExecutionFile,
  isSandboxExecutionToolName,
  toSandboxFileAttachment,
} from '../../sandbox/output-attachments'
import {
  type BackendSandboxExecution,
  type BackendSandboxExecutionFailure,
  type BackendSandboxExecutionFile,
  type BackendSandboxIsolationSummary,
  type BackendSandboxWritebackOperation,
  commitRunSandboxWritebacks,
  getRunSandboxExecution,
  reviewRunSandboxWritebacks,
} from '../../services/api'
import { openAssetInNewTab } from '../../services/authenticated-asset'
import { toApiUrl } from '../../services/backend'
import { escapeHtml, hljs } from '../../services/markdown/highlight'
import { getShortcutManagerContext } from '../../shortcuts/shortcut-manager'
import { chatStore } from '../../stores/chat-store.svelte'
import FileChip from '../FileChip.svelte'
import ImageTile from '../ImageTile.svelte'
import {
  focusAdjacentExpandableToggle,
  getBlockAnnouncement,
  getExpandablePanelId,
  getExpandableToggleLabel,
} from './block-accessibility'
import McpAppView from './McpAppView.svelte'
import { shouldShowSandboxPreview } from './tool-block-sandbox'
import { getSuspendedToolLabel, isSuspendedToolBlock } from './tool-state'

const MIN_HOLD_MS = 450
const STALE_THRESHOLD_MS = 2000

let { block }: { block: ToolInteractionBlock } = $props()
const mountedAt = Date.now()
const shortcutManager = getShortcutManagerContext()
const preview = tryGetPreviewContext()
const isApplePlatform =
  typeof navigator !== 'undefined' && /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform)
const shortcutLabels = {
  acceptOnce: isApplePlatform ? 'Cmd+Enter' : 'Ctrl+Enter',
  reject: 'Esc',
  trust: isApplePlatform ? 'Cmd+Shift+Enter' : 'Ctrl+Shift+Enter',
}

let userHasToggled = false
let expanded = $state(false)

const toolDurationMs = (b: ToolInteractionBlock): number | null => {
  if (b.status !== 'complete') return null
  const created = Date.parse(b.createdAt)
  const finished = b.finishedAt != null ? Date.parse(b.finishedAt) : created
  if (!Number.isFinite(created) || !Number.isFinite(finished)) return null
  return Math.max(0, finished - created)
}

const formatDurationLabel = (durationMs: number | null): string | null => {
  if (durationMs == null) {
    return null
  }

  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
}

const completionKey = (b: ToolInteractionBlock): string => `${b.toolCallId}:${b.finishedAt ?? ''}`

let holdRunningVisual = $state(false)
let releasedCompletionKey = $state<string | null>(null)

const toggle = () => {
  userHasToggled = true
  expanded = !expanded
}

const hasAppView = $derived(Boolean(block.appsMeta?.resourceUri))
const argsText = $derived(block.args == null ? '{}' : formatStructuredValue(block.args))
const outputText = $derived(block.output == null ? '' : formatStructuredValue(block.output))

const isRecord = (value: unknown): value is Record<string, unknown> =>
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

const isSandboxNetworkMode = (
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

const parseSandboxExecution = (value: unknown): BackendSandboxExecution | null => {
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

  if (
    files.length !== candidate.files.length ||
    writebacks.length !== candidate.writebacks.length
  ) {
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
const parseImageToolArgs = (value: unknown): { aspectRatio: string | null; count: number } => {
  if (!isRecord(value)) return { aspectRatio: null, count: 1 }
  const aspectRatio = typeof value.aspectRatio === 'string' ? value.aspectRatio : null
  const refs = Array.isArray(value.references) ? value.references.length : 0
  return { aspectRatio, count: Math.max(1, refs || 1) }
}

/** A single image entry from the generate_image tool output. */
interface ImageOutputEntry {
  fileId: string
  mimeType: string
  name: string
}

/** Parse generate_image tool output for completion summary and inline preview. */
const parseImageToolOutput = (
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
const aspectRatioToDecimal = (ratio: string | null): number => {
  if (!ratio) return 1
  const parts = ratio.split(':')
  if (parts.length !== 2) return 1
  const w = Number(parts[0])
  const h = Number(parts[1])
  return w > 0 && h > 0 ? w / h : 1
}

const SKELETON_HEIGHT = 160
const SKELETON_MAX_WIDTH = 280

const parseToolErrorMessage = (value: unknown): string | null => {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== 'string') {
    return null
  }

  return value.error.message
}

const formatSandboxNetworkMode = (
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

const formatSandboxProvider = (value: BackendSandboxExecution['provider']): string => {
  switch (value) {
    case 'deno':
      return 'deno'
    case 'local_dev':
      return 'local_dev'
  }
}

const formatSandboxRuntime = (value: BackendSandboxExecution['runtime']): string => {
  switch (value) {
    case 'lo':
      return 'lo'
    case 'node':
      return 'Node compat'
  }
}

const sandboxStatusLabel = (status: BackendSandboxWritebackOperation['status']): string => {
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

const sandboxStatusClass = (status: BackendSandboxWritebackOperation['status']): string => {
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

const highlightJson = (text: string): string => {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language: 'json' }).value
  } catch {
    return escapeHtml(text)
  }
}

const highlightCode = (text: string, language: string): string => {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language }).value
  } catch {
    return escapeHtml(text)
  }
}

const extractSandboxScript = (
  args: Record<string, unknown> | null,
): { script: string; lang: string; rest: Record<string, unknown> } | null => {
  if (!args) return null
  const source = args.source
  // Handle nested source.script or flat args.script
  const scriptSource = isRecord(source) ? source : args
  const script = scriptSource.script
  if (typeof script !== 'string') return null
  const kind = (isRecord(source) ? source.kind : (args.kind ?? args.mode)) as string | undefined
  const lang = kind === 'bash' ? 'bash' : 'javascript'
  // Build rest without the script content
  const rest = { ...args }
  if (isRecord(source)) {
    const { script: _, ...restSource } = source as Record<string, unknown>
    rest.source = restSource
  } else {
    delete rest.script
  }
  return { script, lang, rest }
}

const sandboxScript = $derived(
  block.name.startsWith('execute') ? extractSandboxScript(block.args) : null,
)
const sandboxScriptHtml = $derived(
  sandboxScript ? highlightCode(sandboxScript.script, sandboxScript.lang) : null,
)
const sandboxRestHtml = $derived(
  sandboxScript && Object.keys(sandboxScript.rest).length > 0
    ? highlightJson(JSON.stringify(sandboxScript.rest, null, 2))
    : null,
)

const argsHtml = $derived(highlightJson(argsText))
const outputHtml = $derived(highlightJson(outputText))
const panelId = $derived(getExpandablePanelId(block))
const toggleLabel = $derived(getExpandableToggleLabel(block, expanded))
const announcement = $derived(getBlockAnnouncement(block))
const isSandboxTool = $derived(isSandboxExecutionToolName(block.name))
const isImageToolByName = $derived(block.name === 'generate_image')
const initialSandboxOutput = $derived(parseSandboxExecution(block.output))
const sandboxExecutionId = $derived(initialSandboxOutput?.sandboxExecutionId ?? null)
const imageOutput = $derived(parseImageToolOutput(block.output))
const isImageTool = $derived(isImageToolByName || imageOutput !== null)

// Image skeleton layout is computed once from the initial args and cached to avoid
// reactive style changes that would restart the CSS pulse animation on every tick.
let imageSkeletonWidth = $state(SKELETON_HEIGHT)
let imageSkeletonCount = $state(1)
let imageAspectLabel = $state<string | null>(null)
let imageIsEditing = $state(false)
let imageLayoutResolved = false

$effect(() => {
  if (!isImageTool || imageLayoutResolved) return
  const parsed = parseImageToolArgs(block.args)
  const ratio = aspectRatioToDecimal(parsed.aspectRatio)
  imageSkeletonWidth = Math.min(SKELETON_MAX_WIDTH, Math.round(SKELETON_HEIGHT * ratio))
  imageSkeletonCount = parsed.count
  imageAspectLabel = parsed.aspectRatio
  imageIsEditing =
    isRecord(block.args) && Array.isArray(block.args.references) && block.args.references.length > 0
  imageLayoutResolved = true
})
const confirmationWaitId = $derived(block.confirmation?.waitId ?? null)
const confirmationOwnerRunId = $derived(block.confirmation?.ownerRunId ?? block.sourceRunId ?? null)
const sandboxRunId = $derived(
  typeof block.sourceRunId === 'string'
    ? asRunId(block.sourceRunId)
    : confirmationOwnerRunId
      ? asRunId(String(confirmationOwnerRunId))
      : null,
)
const showConfirmationPanel = $derived(
  block.status === 'awaiting_confirmation' && Boolean(block.confirmation),
)
const suspendedTool = $derived(isSuspendedToolBlock(block))
const suspendedToolLabel = $derived(suspendedTool ? getSuspendedToolLabel(block) : null)
const isRejected = $derived(block.approval?.status === 'rejected')
const approvalBadgeLabel = $derived.by(() => {
  if (block.approval?.status === 'approved' && block.approval.remembered) {
    return 'Trusted'
  }

  return block.approval?.status === 'rejected' ? 'Rejected' : null
})
const durationLabel = $derived(formatDurationLabel(toolDurationMs(block)))
const activePendingConfirmation = $derived.by(() => {
  if (block.status !== 'awaiting_confirmation' || !confirmationWaitId) return false
  if (chatStore.resolvingWaitIds.has(confirmationWaitId)) return false
  const pending = chatStore.pendingToolConfirmation
  return Boolean((pending && pending.waitId === confirmationWaitId) || block.confirmation)
})

const thisWaitResolving = $derived(
  confirmationWaitId ? chatStore.resolvingWaitIds.has(confirmationWaitId) : false,
)

let resolvingAction = $state<'approve' | 'trust' | 'reject' | null>(null)
let resolveError = $state<string | null>(null)
let sandboxDetails = $state<BackendSandboxExecution | null>(null)
let sandboxLoading = $state(false)
let sandboxAction = $state<'approve' | 'reject' | 'commit' | null>(null)
let sandboxError = $state<string | null>(null)
const isResolvingConfirmation = $derived(Boolean(resolvingAction || thisWaitResolving))

const sandboxOutput = $derived(sandboxDetails ?? initialSandboxOutput)
const sandboxFailure = $derived(sandboxOutput?.failure ?? null)
const sandboxFailureHint = $derived(
  sandboxFailure && sandboxFailure.hint !== sandboxFailure.nextAction ? sandboxFailure.hint : null,
)
const showSandboxStderrPreview = $derived(
  shouldShowSandboxPreview(sandboxFailure?.stderrPreview ?? null, sandboxOutput?.stderr ?? null),
)
const showSandboxStdoutPreview = $derived(
  shouldShowSandboxPreview(sandboxFailure?.stdoutPreview ?? null, sandboxOutput?.stdout ?? null),
)
const sandboxTopLevelError = $derived(sandboxFailure ? null : parseToolErrorMessage(block.output))
const sandboxFiles = $derived(sandboxOutput?.files ?? [])
const sandboxWritebacks = $derived(sandboxOutput?.writebacks ?? [])
const requestedSandboxNetworkMode = $derived.by(() => {
  if (sandboxOutput?.isolation?.requestedNetworkMode) {
    return sandboxOutput.isolation.requestedNetworkMode
  }

  if (!isRecord(block.args)) {
    return 'off' as const
  }

  const network = block.args.network

  if (!isRecord(network) || !isSandboxNetworkMode(network.mode)) {
    return 'off' as const
  }

  return network.mode
})
const sandboxRequestedNetworkWasExplicit = $derived.by(() => {
  if (sandboxOutput?.isolation?.requestedNetworkMode) {
    return true
  }

  if (!isRecord(block.args)) {
    return false
  }

  const network = block.args.network
  return isRecord(network) && isSandboxNetworkMode(network.mode)
})
const effectiveSandboxNetworkMode = $derived(
  sandboxOutput?.effectiveNetworkMode ?? requestedSandboxNetworkMode,
)
const sandboxNetworkModeChanged = $derived(
  requestedSandboxNetworkMode !== effectiveSandboxNetworkMode,
)
const approvedSandboxWritebacks = $derived(
  sandboxWritebacks.filter((operation) => operation.status === 'approved'),
)
const pendingSandboxWritebacks = $derived(
  sandboxWritebacks.filter((operation) => operation.status === 'pending'),
)
const sandboxActionLabel = $derived.by(() => {
  switch (sandboxAction) {
    case 'approve':
      return 'Updating approval…'
    case 'reject':
      return 'Rejecting…'
    case 'commit':
      return 'Committing…'
    default:
      return null
  }
})
const showOutputPanel = $derived(
  Boolean(sandboxOutput) || Boolean(outputText) || block.status === 'running',
)

const updateSandboxWritebacks = (writebacks: BackendSandboxWritebackOperation[]) => {
  const current = sandboxOutput ?? initialSandboxOutput

  if (!current) {
    return
  }

  sandboxDetails = {
    ...current,
    writebacks,
  }
}

const openSandboxFile = async (file: BackendSandboxExecutionFile) => {
  const attachment = toSandboxFileAttachment(file)
  if (preview) {
    const item = await resolveTextPreviewItem(attachment, {
      editable: false,
    })

    if (item) {
      preview.openItem(item)
      return
    }
  }

  await openAssetInNewTab(attachment.url)
}

const reviewSandboxWriteback = async (operationId: string, decision: 'approve' | 'reject') => {
  if (!sandboxRunId || !sandboxExecutionId) return
  sandboxError = null
  sandboxAction = decision

  try {
    const result = await reviewRunSandboxWritebacks(sandboxRunId, sandboxExecutionId, {
      operations: [{ decision, id: operationId }],
    })
    updateSandboxWritebacks(result.writebacks)
    await chatStore.refreshCurrentThread()
  } catch {
    sandboxError =
      decision === 'approve'
        ? 'Could not approve the sandbox write-back.'
        : 'Could not reject the sandbox write-back.'
  } finally {
    sandboxAction = null
  }
}

const commitSandboxWritebacks = async () => {
  if (!sandboxRunId || !sandboxExecutionId || approvedSandboxWritebacks.length === 0) return
  sandboxError = null
  sandboxAction = 'commit'

  try {
    const result = await commitRunSandboxWritebacks(sandboxRunId, sandboxExecutionId)
    updateSandboxWritebacks(result.writebacks)
    await chatStore.refreshCurrentThread()
  } catch {
    sandboxError = 'Could not commit approved sandbox outputs.'
  } finally {
    sandboxAction = null
  }
}

const resolvingLabel = $derived.by(() => {
  switch (resolvingAction) {
    case 'approve':
      return 'Approving…'
    case 'trust':
      return 'Trusting…'
    case 'reject':
      return 'Rejecting…'
    default:
      return null
  }
})
const panelResolvingLabel = $derived(resolvingLabel ?? 'Approving…')

const approveOnce = async () => {
  if (!confirmationWaitId) return
  resolveError = null
  resolvingAction = 'approve'
  await chatStore.approvePendingWait(confirmationWaitId, confirmationOwnerRunId ?? undefined)
  if (block.status === 'awaiting_confirmation') {
    resolveError = 'Could not approve. Try again.'
    resolvingAction = null
  }
}

const trustAndApprove = async () => {
  if (!confirmationWaitId) return
  resolveError = null
  resolvingAction = 'trust'
  await chatStore.trustPendingWait(confirmationWaitId, confirmationOwnerRunId ?? undefined)
  if (block.status === 'awaiting_confirmation') {
    resolveError = 'Could not trust and approve. Try again.'
    resolvingAction = null
  }
}

const rejectConfirmation = async () => {
  if (!confirmationWaitId) return
  resolveError = null
  resolvingAction = 'reject'
  await chatStore.rejectPendingWait(confirmationWaitId, confirmationOwnerRunId ?? undefined)
  if (block.status === 'awaiting_confirmation') {
    resolveError = 'Could not reject. Try again.'
    resolvingAction = null
  }
}

const headerRunning = $derived(
  !suspendedTool &&
    block.status !== 'error' &&
    block.status !== 'awaiting_confirmation' &&
    (block.status === 'running' || (block.status === 'complete' && holdRunningVisual)),
)

$effect(() => {
  if (block.status !== 'awaiting_confirmation') {
    resolvingAction = null
    resolveError = null
  }
})

$effect(() => {
  if (!isSandboxTool || !sandboxExecutionId || !sandboxRunId) {
    sandboxDetails = null
    sandboxLoading = false
    return
  }

  let cancelled = false
  sandboxLoading = true
  sandboxError = null

  void getRunSandboxExecution(sandboxRunId, sandboxExecutionId)
    .then((result) => {
      if (cancelled) return
      sandboxDetails = result
    })
    .catch(() => {
      if (cancelled) return
      sandboxDetails = initialSandboxOutput
    })
    .finally(() => {
      if (cancelled) return
      sandboxLoading = false
    })

  return () => {
    cancelled = true
  }
})

const handleToggleKeydown = (event: KeyboardEvent) => {
  const currentTarget = event.currentTarget
  if (!(currentTarget instanceof HTMLButtonElement)) {
    return
  }

  if (focusAdjacentExpandableToggle(currentTarget, event.key)) {
    event.preventDefault()
  }
}

$effect(() => {
  if (
    (block.status === 'awaiting_confirmation' ||
      hasAppView ||
      (isImageTool && (headerRunning || imageOutput))) &&
    !userHasToggled
  ) {
    requestAnimationFrame(() => {
      expanded = true
    })
  }
})

$effect.pre(() => {
  void block.toolCallId
  void block.status
  void block.createdAt
  void block.finishedAt

  if (
    block.status === 'error' ||
    block.status === 'running' ||
    block.status === 'awaiting_confirmation'
  ) {
    holdRunningVisual = false
    return
  }

  const ms = toolDurationMs(block)
  if (ms == null || ms >= MIN_HOLD_MS) {
    holdRunningVisual = false
    return
  }

  const finishedTs = block.finishedAt != null ? Date.parse(block.finishedAt) : null
  if (finishedTs != null && finishedTs < mountedAt - STALE_THRESHOLD_MS) {
    holdRunningVisual = false
    return
  }

  const key = completionKey(block)
  if (releasedCompletionKey === key) {
    holdRunningVisual = false
    return
  }

  holdRunningVisual = true
})

$effect(() => {
  void block.toolCallId
  void block.status
  void block.createdAt
  void block.finishedAt

  if (
    block.status === 'error' ||
    block.status === 'running' ||
    block.status === 'awaiting_confirmation'
  ) {
    return
  }

  const ms = toolDurationMs(block)
  if (ms == null || ms >= MIN_HOLD_MS) return

  const key = completionKey(block)
  if (releasedCompletionKey === key) return

  const extendMs = MIN_HOLD_MS - ms
  const id = setTimeout(() => {
    releasedCompletionKey = key
  }, extendMs)
  return () => clearTimeout(id)
})

onMount(() =>
  shortcutManager.registerShortcuts([
    {
      allowInEditable: true,
      description: 'Accept tool confirmation once',
      id: `tool.accept-once:${block.toolCallId}`,
      keys: ['Mod+Enter'],
      scope: 'global',
      when: () => activePendingConfirmation && !chatStore.isResolvingWait,
      run: () => {
        approveOnce()
      },
    },
    {
      allowInEditable: true,
      description: 'Accept and trust tool confirmation',
      id: `tool.accept-trust:${block.toolCallId}`,
      keys: ['Mod+Shift+Enter'],
      scope: 'global',
      when: () => activePendingConfirmation && !chatStore.isResolvingWait,
      run: () => {
        trustAndApprove()
      },
    },
    {
      allowInEditable: true,
      description: 'Reject tool confirmation',
      id: `tool.reject:${block.toolCallId}`,
      keys: ['Escape'],
      scope: 'global',
      when: () => activePendingConfirmation && !chatStore.isResolvingWait,
      run: () => {
        rejectConfirmation()
      },
    },
  ]),
)
</script>

<div>
  <button
    id={`${panelId}-toggle`}
    type="button"
    data-block-toggle="true"
    class="sd-block-header w-full flex items-center gap-2 py-1 rounded text-left group text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
    onclick={toggle}
    onkeydown={handleToggleKeydown}
    aria-controls={panelId}
    aria-expanded={expanded}
    aria-label={toggleLabel}
  >
    {#if announcement}
      <span class="sr-only" aria-live={block.status === 'error' || isRejected ? 'assertive' : 'polite'}>
        {announcement}
      </span>
    {/if}
    <div class="sd-block-icon w-4 h-4 flex items-center justify-center shrink-0 {block.status === 'error' || isRejected ? 'text-danger-text' : block.status === 'awaiting_confirmation' && !isResolvingConfirmation ? 'text-accent' : suspendedTool ? 'text-text-tertiary' : headerRunning || isResolvingConfirmation ? 'text-text-primary' : 'text-text-tertiary'}">
      {#if isRejected}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 15.5 15.5 8.5" />
        </svg>
      {:else if block.status === 'error'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      {:else if block.status === 'awaiting_confirmation' && isResolvingConfirmation}
        <span class="caret-blink" style="width:2px;height:12px;" aria-hidden="true"></span>
      {:else if block.status === 'awaiting_confirmation'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18h.01"/><path d="M9.09 9a3 3 0 1 1 5.82 1c0 2-3 2-3 4"/></svg>
      {:else if suspendedTool}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
          <path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
        </svg>
      {:else if headerRunning}
        <span class="caret-blink" style="width:2px;height:12px;" aria-hidden="true"></span>
      {:else}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      {/if}
    </div>

    <div class="flex-1 min-w-0 flex items-center gap-2">
      <span class="sd-block-label text-[13px] truncate text-text-secondary group-hover:text-text-primary">{isImageTool ? (imageIsEditing ? 'editing image' : 'generating image') : block.name}</span>
      {#if durationLabel}
        <span class="text-[11px] text-text-tertiary whitespace-nowrap">{durationLabel}</span>
      {/if}
      {#if block.status === 'error' && !isRejected}
        <span class="text-[11px] text-danger-text whitespace-nowrap">Failed</span>
      {:else if block.status === 'awaiting_confirmation' && isResolvingConfirmation}
        <span class="text-[11px] text-text-tertiary whitespace-nowrap">{panelResolvingLabel}</span>
      {:else if block.status === 'awaiting_confirmation'}
        <span class="text-[11px] text-accent whitespace-nowrap">Needs approval</span>
      {:else if suspendedTool && suspendedToolLabel}
        <span class="text-[11px] text-text-tertiary whitespace-nowrap">{suspendedToolLabel}</span>
      {/if}
      {#if approvalBadgeLabel}
        <span
          class="text-[11px] whitespace-nowrap {block.approval?.status === 'rejected' ? 'text-danger-text' : 'text-accent'}"
        >
          {approvalBadgeLabel}
        </span>
      {/if}
    </div>

    <svg
      class="sd-block-chevron w-3.5 h-3.5 shrink-0 {expanded ? 'open' : ''}"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  </button>

  <div
    id={panelId}
    class="collapsible {expanded ? 'open' : ''}"
    role="region"
    aria-busy={headerRunning || resolvingAction === 'approve' || resolvingAction === 'trust' || undefined}
    aria-labelledby={`${panelId}-toggle`}
  >
    <div>
      <div class="pl-6 pr-4 pb-2 space-y-3">
        <div>
          <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Input</div>
          {#if sandboxScriptHtml}
            {#if sandboxRestHtml}
              <pre class="m-0 mb-2 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words" style="scrollbar-width: thin;">{@html sandboxRestHtml}</pre>
            {/if}
            <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto hljs" style="scrollbar-width: thin;">{@html sandboxScriptHtml}</pre>
          {:else}
            <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto" style="scrollbar-width: thin;">{@html argsHtml}</pre>
          {/if}
        </div>

        {#if showConfirmationPanel}
          <div class="approval-breathe">
            {#if resolveError}
              <p class="resolve-error text-[12px] text-danger-text">{resolveError}</p>
            {/if}

            {#if isResolvingConfirmation}
              <div class="flex items-center gap-2 py-1 text-[12px] text-text-tertiary" aria-live="polite" role="status">
                <span class="caret-blink shrink-0" style="width:2px;height:12px;" aria-hidden="true"></span>
                <span>{panelResolvingLabel}</span>
              </div>
            {:else}
              <div class="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  class="confirm-trust inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/12 px-2.5 py-1 text-[12px] font-medium text-accent-text transition-colors hover:bg-accent/20 hover:border-accent/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={trustAndApprove}
                  disabled={thisWaitResolving}
                  aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"
                >
                  <span>Accept &amp; trust</span>
                  <span class="text-[10px] opacity-55">{shortcutLabels.trust}</span>
                </button>

                <button
                  type="button"
                  class="confirm-once inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-transparent px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-text-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={approveOnce}
                  disabled={thisWaitResolving}
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                >
                  <span>Accept once</span>
                  <span class="text-[10px] opacity-55">{shortcutLabels.acceptOnce}</span>
                </button>

                <button
                  type="button"
                  class="confirm-reject inline-flex items-center gap-1.5 rounded-md border border-danger/15 bg-transparent px-2.5 py-1 text-[12px] font-medium text-text-tertiary transition-colors hover:text-danger-text hover:border-danger/35 hover:bg-danger/6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger/40 disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={rejectConfirmation}
                  disabled={thisWaitResolving}
                  aria-keyshortcuts="Escape"
                >
                  <span>Reject</span>
                  <span class="text-[10px] opacity-55">{shortcutLabels.reject}</span>
                </button>
              </div>
            {/if}
          </div>
        {/if}
        {#if isImageTool}
          <div>
            <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Output</div>
            {#if block.status === 'running' || (block.status === 'complete' && holdRunningVisual)}
              <div class="flex flex-wrap gap-2" aria-label={imageIsEditing ? 'Editing image…' : 'Generating image…'} role="status">
                {#each Array.from({ length: imageSkeletonCount }, (_, i) => i) as i (i)}
                  <div
                    class="image-skeleton rounded border border-border bg-surface-2"
                    style="width:{imageSkeletonWidth}px;height:{SKELETON_HEIGHT}px"
                  ></div>
                {/each}
              </div>
              <div class="mt-1.5 text-[11px] text-text-tertiary">
                {imageIsEditing ? 'Editing' : 'Generating'}{imageAspectLabel ? ` · ${imageAspectLabel}` : ''}
              </div>
            {:else if block.status === 'complete' && imageOutput && imageOutput.images.length > 0}
              <div class="flex flex-wrap gap-2">
                {#each imageOutput.images as img (img.fileId)}
                  <ImageTile
                    alt={img.name}
                    src={toApiUrl(`/files/${img.fileId}/content`)}
                    frameWidth={imageSkeletonWidth}
                    frameHeight={SKELETON_HEIGHT}
                    variant="message"
                  />
                {/each}
              </div>
            {:else if block.status === 'complete' && imageOutput}
              <div class="text-[13px] text-text-secondary">
                {imageOutput.imageCount === 1 ? 'Generated 1 image' : `Generated ${imageOutput.imageCount} images`}
              </div>
            {:else if block.status === 'error'}
              <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto" style="scrollbar-width: thin;">{@html outputHtml}</pre>
            {:else}
              <div class="flex items-center py-1" aria-label="Waiting for image generation" aria-live="polite" role="status">
                <span class="caret-blink shrink-0" aria-hidden="true"></span>
              </div>
            {/if}
          </div>
        {:else if hasAppView}
          <div>
            <McpAppView {block} />
          </div>
        {:else if showOutputPanel}
          <div>
            <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Output</div>
            {#if isSandboxTool && sandboxOutput}
              {#if sandboxError}
                <p class="mb-2 text-[12px] text-danger-text">{sandboxError}</p>
              {/if}
              {#if sandboxActionLabel}
                <p class="mb-2 text-[12px] text-text-tertiary">{sandboxActionLabel}</p>
              {/if}
              {#if sandboxTopLevelError}
                <p class="mb-2 text-[12px] text-danger-text">{sandboxTopLevelError}</p>
              {/if}
              {#if sandboxLoading && sandboxFiles.length === 0 && sandboxWritebacks.length === 0 && !(sandboxOutput.stdout || sandboxOutput.stderr)}
                <div class="flex items-center py-1 text-[12px] text-text-tertiary" aria-live="polite" role="status">
                  Loading sandbox details…
                </div>
              {/if}

              <div>
                <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Sandbox</div>
                <div class="mb-3 text-[12px] leading-relaxed text-text-secondary">
                  <div>
                    Provider:
                    <span class="font-medium text-text-primary">
                      {formatSandboxProvider(sandboxOutput.provider)}
                    </span>
                  </div>
                  <div>
                    Engine:
                    <span class="font-medium text-text-primary">
                      {formatSandboxRuntime(sandboxOutput.runtime)}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Network</div>
                <div class="text-[12px] leading-relaxed text-text-secondary">
                  <div>
                    Requested:
                    <span class="font-medium text-text-primary">
                      {formatSandboxNetworkMode(requestedSandboxNetworkMode)}
                    </span>
                    {#if !sandboxRequestedNetworkWasExplicit}
                      <span class="text-text-tertiary"> (default)</span>
                    {/if}
                  </div>
                  <div>
                    Effective:
                    <span class="font-medium text-text-primary">
                      {formatSandboxNetworkMode(effectiveSandboxNetworkMode)}
                    </span>
                    {#if sandboxNetworkModeChanged}
                      <span class="text-text-tertiary"> (adjusted by sandbox policy)</span>
                    {/if}
                  </div>
                </div>
              </div>

              {#if sandboxFailure}
                <div class="space-y-2">
                  <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">Failure</div>
                  <div class="text-[12px] font-medium text-danger-text">{sandboxFailure.summary}</div>
                  <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
                    {#if sandboxFailure.code}
                      <span>Code: {sandboxFailure.code}</span>
                    {/if}
                    <span>Phase: {sandboxFailure.phase}</span>
                    <span>Runner: {sandboxFailure.runner}</span>
                    {#if sandboxFailure.exitCode !== null}
                      <span>Exit code: {sandboxFailure.exitCode}</span>
                    {/if}
                    {#if sandboxFailure.signal}
                      <span>Signal: {sandboxFailure.signal}</span>
                    {/if}
                  </div>
                  {#if sandboxFailure.nextAction}
                    <div class="text-[12px] text-text-secondary">{sandboxFailure.nextAction}</div>
                  {/if}
                  {#if sandboxFailureHint}
                    <div class="text-[12px] text-text-secondary">{sandboxFailureHint}</div>
                  {/if}
                  {#if showSandboxStderrPreview}
                    <div>
                      <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Stderr preview</div>
                      <pre class="m-0 text-[12px] leading-relaxed text-danger-text font-mono whitespace-pre-wrap break-words max-h-[8lh] overflow-y-auto" style="scrollbar-width: thin;">{sandboxFailure.stderrPreview}</pre>
                    </div>
                  {/if}
                  {#if showSandboxStdoutPreview}
                    <div>
                      <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Stdout preview</div>
                      <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[8lh] overflow-y-auto" style="scrollbar-width: thin;">{sandboxFailure.stdoutPreview}</pre>
                    </div>
                  {/if}
                </div>
              {/if}

              {#if sandboxOutput.isolation}
                <div>
                  <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Isolation</div>
                  <div class="text-[12px] leading-relaxed text-text-secondary">
                    <div>
                      Fresh sandbox:
                      <span class="font-medium text-text-primary">
                        {sandboxOutput.isolation.freshSandboxPerCall ? 'yes' : 'no'}
                      </span>
                    </div>
                    <div>
                      Output persists:
                      <span class="font-medium text-text-primary">
                        {sandboxOutput.isolation.outputVisibleOnlyThisCall ? 'no' : 'yes'}
                      </span>
                    </div>
                    <div>
                      Package install:
                      <span class="font-medium text-text-primary">
                        {sandboxOutput.isolation.packageInstallStrategy}
                      </span>
                    </div>
                    <div>
                      Network enforcement:
                      <span class="font-medium text-text-primary">
                        {sandboxOutput.isolation.networkEnforcement}
                      </span>
                    </div>
                  </div>
                </div>
              {/if}

              {#if sandboxFiles.length > 0}
                <div class="space-y-2">
                  <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">Files</div>
                  <div class="flex flex-wrap gap-1.5">
                    {#each sandboxFiles as file (file.fileId)}
                      <button
                        type="button"
                        class="inline-flex cursor-pointer items-center gap-1 rounded border border-border/50 px-2 py-0.5 text-[12px] text-text-secondary transition-colors hover:text-text-primary hover:border-border"
                        title={file.sandboxPath}
                        onclick={() => { void openSandboxFile(file) }}
                      >
                        <svg class="h-3 w-3 shrink-0 opacity-50" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 0 1-4.5-4.5l5.8-5.8a2.1 2.1 0 0 1 3 3L6.2 11.8a1.1 1.1 0 0 1-1.5-1.5L10 5"/></svg>
                        <span class="max-w-[22ch] truncate">{toSandboxFileAttachment(file).name}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if sandboxWritebacks.length > 0}
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">Write-back</div>
                    {#if approvedSandboxWritebacks.length > 0}
                      <button
                        type="button"
                        class="inline-flex items-center rounded-md border border-border-strong bg-transparent px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary hover:border-text-tertiary disabled:cursor-not-allowed disabled:opacity-50"
                        onclick={commitSandboxWritebacks}
                        disabled={sandboxAction !== null}
                      >
                        Commit approved
                      </button>
                    {/if}
                  </div>

                  <div class="space-y-2">
                    {#each sandboxWritebacks as operation (operation.id)}
                      <div class="rounded-lg border border-border bg-surface-0/70 px-3 py-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-[12px] font-medium text-text-primary">{operation.operation}</span>
                          <span class={`text-[11px] ${sandboxStatusClass(operation.status)}`}>
                            {sandboxStatusLabel(operation.status)}
                          </span>
                        </div>
                        {#if operation.sourceSandboxPath}
                          <div class="mt-1 text-[12px] text-text-secondary font-mono break-all">
                            {operation.sourceSandboxPath}
                          </div>
                        {/if}
                        <div class="mt-1 text-[12px] text-text-tertiary font-mono break-all">
                          {operation.targetVaultPath}
                        </div>
                        {#if operation.errorText}
                          <div class="mt-1 text-[11px] text-danger-text">{operation.errorText}</div>
                        {/if}
                        {#if operation.status === 'pending'}
                          <div class="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              class="inline-flex items-center rounded-md border border-accent/30 bg-accent/12 px-2 py-1 text-[11px] font-medium text-accent-text transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                              onclick={() => { void reviewSandboxWriteback(operation.id, 'approve') }}
                              disabled={sandboxAction !== null}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              class="inline-flex items-center rounded-md border border-danger/15 bg-transparent px-2 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:text-danger-text hover:border-danger/35 hover:bg-danger/6 disabled:cursor-not-allowed disabled:opacity-50"
                              onclick={() => { void reviewSandboxWriteback(operation.id, 'reject') }}
                              disabled={sandboxAction !== null}
                            >
                              Reject
                            </button>
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if sandboxOutput.stdout}
                <div>
                  <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Stdout</div>
                  <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto" style="scrollbar-width: thin;">{sandboxOutput.stdout}</pre>
                </div>
              {/if}

              {#if sandboxOutput.stderr}
                <div>
                  <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1">Stderr</div>
                  <pre class="m-0 text-[12px] leading-relaxed text-danger-text font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto" style="scrollbar-width: thin;">{sandboxOutput.stderr}</pre>
                </div>
              {/if}
            {:else if outputText}
              <pre class="m-0 text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[12lh] overflow-y-auto" style="scrollbar-width: thin;">{@html outputHtml}</pre>
            {:else if suspendedTool && suspendedToolLabel}
              <div class="flex items-center gap-2 py-1 text-[12px] text-text-tertiary" aria-label={suspendedToolLabel} aria-live="polite" role="status">
                <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
                  <path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
                </svg>
                <span>{suspendedToolLabel}</span>
              </div>
            {:else}
              <div class="flex items-center py-1" aria-label="Waiting for tool output" aria-live="polite" role="status">
                <span class="caret-blink shrink-0" aria-hidden="true"></span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
