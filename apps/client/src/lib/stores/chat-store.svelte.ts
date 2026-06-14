import type {
  BackendModelsCatalog,
  BackendPendingWait,
  BackendRun,
  BackendSession,
  BackendThread,
  Block,
  ChatModel,
  ChatReasoningMode,
  CreateSessionInput,
  CreateSessionThreadInput,
  MessageAttachment,
  MessageFinishReason,
  MessageId,
  ReasoningEffort,
  RunId,
  SessionId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import {
  asAgentId,
  asMessageId,
  BACKEND_DEFAULT_MODEL,
  BACKEND_DEFAULT_REASONING,
} from '@wonderlands/contracts/chat'
import { createMessageEditCommands } from '../chat/commands/message-edit-commands'
import { createPendingWaitCommands } from '../chat/commands/pending-wait-commands'
import { createRunControlCommands } from '../chat/commands/run-control'
import { createSubmitBranches } from '../chat/commands/submit-branches'
import { createSubmitCommand } from '../chat/commands/submit-command'
import { createSubmitLifecycle } from '../chat/commands/submit-lifecycle'
import type { SubmitAgentSelection } from '../chat/commands/submit-target'
import { createThreadInteractionCommands } from '../chat/commands/thread-interaction'
import { createThreadTitleCommands } from '../chat/commands/thread-title-commands'
import {
  createChatPersistence,
  type PersistedChatState,
  type StorageLike,
} from '../chat/persistence/chat-persistence'
import { createChatPersistenceShell } from '../chat/persistence/chat-persistence-shell'
import { createLiveAssistantLaneCoordinator } from '../chat/projection/live-assistant-lane'
import {
  createRenderedMessageStateCoordinator,
  hasKeepWorthyMessageContent,
} from '../chat/projection/rendered-message-state'
import { createThreadMessageMapper } from '../chat/projection/thread-message-mapper'
import { createActiveRunShellCoordinator } from '../chat/runtime/active-run-shell'
import {
  parseUsage,
  toContextBudget,
  withEstimatedOutputDelta,
  withReconciledUsage,
  withStreamingBudgetStart,
} from '../chat/runtime/context-budget'
import { createChatEventEngine } from '../chat/runtime/event-engine'
import type { RunLease, SubmitLease, ViewLease } from '../chat/runtime/leases'
import { createChatLeaseState } from '../chat/runtime/leases'
import { createRunBootstrapCoordinator } from '../chat/runtime/run-bootstrap'
import {
  createRunLifecycleCoordinator,
  finishReasonForRunStatus,
} from '../chat/runtime/run-lifecycle'
import { createRunOutputCoordinator } from '../chat/runtime/run-output'
import { createRunTranscriptHydrator } from '../chat/runtime/run-transcript-hydrator'
import { createRunWaitCoordinator, isConfirmationPendingWait } from '../chat/runtime/run-waits'
import { createPersistedSnapshotHandler } from '../chat/session/persisted-snapshot'
import { createPersistedThreadHydrator } from '../chat/session/persisted-thread-hydrator'
import { createThreadMessageSyncCoordinator } from '../chat/session/thread-message-sync'
import { createThreadSessionCommands } from '../chat/session/thread-session-commands'
import { createThreadSessionLoader } from '../chat/session/thread-session-loader'
import { createLocalMessageStateCoordinator } from '../chat/state/local-message-state'
import { createChatPreferencesState } from '../chat/state/preferences.svelte'
import { createRunTranscriptShell } from '../chat/state/run-transcript-shell'
import { createRunTranscriptStore } from '../chat/state/run-transcripts'
import { createChatStoreFacade } from '../chat/store-facade'
import { createThreadStreamController } from '../chat/transport/thread-stream-controller'
import { createThreadStreamRuntime } from '../chat/transport/thread-stream-runtime'
import type {
  ChatReasoningModeOption,
  ContextBudget,
  ConversationTargetMode,
  MessageEditDraft,
  RunTranscriptState,
  UiMessage,
} from '../chat/types'
import { logChatDebug, registerChatDebugSnapshot } from '../runtime/chat-debug'
import {
  applyEvent,
  materializePersistedAssistantBlocks,
  settleBlocksForRunTerminalState,
} from '../runtime/materialize'
import { extractSandboxOutputAttachments } from '../sandbox/output-attachments'
import {
  branchThread,
  cancelRun,
  createSession,
  createSessionThread,
  deleteThread,
  editThreadMessage,
  getAccountPreferences,
  getAgent,
  getRun,
  getSupportedModels,
  getThread,
  getThreadBudget,
  listThreadMessages,
  postThreadMessage,
  regenerateThreadTitle,
  renameThread,
  replayRunEvents,
  resumeRun,
  startThreadInteraction,
  streamThreadEvents,
} from '../services/api'
import { getApiTenantId } from '../services/backend'
import { humanizeErrorMessage } from '../services/response-errors'
import { isAbortError } from '../services/sse'
import { typewriterPlayback } from './typewriter-playback.svelte'

const DEFAULT_TITLE = 'Streaming Agent UI'
const STORAGE_KEY = '05_04_ui.active-thread'
const STORAGE_KEY_SCOPE_SEPARATOR = ':'
const BACKEND_DEFAULT_MODEL_VALUE = BACKEND_DEFAULT_MODEL
const BACKEND_DEFAULT_REASONING_VALUE = BACKEND_DEFAULT_REASONING
const PREFERRED_DEFAULT_MODEL = 'gpt-5.4' as const
const PREFERRED_DEFAULT_REASONING = 'medium' as const

type MemoryActivity = 'idle' | 'observing' | 'reflecting'

interface ChatState {
  contextBudget: ContextBudget | null
  eventCursor: number
  isCancelling: boolean
  isLoading: boolean
  isThreadNaming: boolean
  isReconnecting: boolean
  isResolvingWait: boolean
  isStreaming: boolean
  isWaiting: boolean
  error: string | null
  memoryActivity: MemoryActivity
  messageEditDraft: MessageEditDraft | null
  runId: RunId | null
  runStatus: BackendRun['status'] | null
  sessionId: SessionId | null
  streamPulse: number
  threadTitle: string | null
  threadId: ThreadId | null
  title: string
}

interface PendingOptimisticOwner {
  submitId: number
  viewEpoch: number
}

interface ChatStoreDependencies {
  branchThread?: typeof branchThread
  cancelRun?: typeof cancelRun
  completedResponseStreamDrainMs?: number
  createSession?: (input: CreateSessionInput) => Promise<BackendSession>
  createSessionThread?: (
    sessionId: SessionId,
    input: CreateSessionThreadInput,
  ) => Promise<BackendThread>
  deleteThread?: typeof deleteThread
  editThreadMessage?: typeof editThreadMessage
  getAccountPreferences?: typeof getAccountPreferences
  getAgent?: typeof getAgent
  getRun?: typeof getRun
  getSupportedModels?: typeof getSupportedModels
  getThreadBudget?: typeof getThreadBudget
  getThread?: typeof getThread
  listThreadMessages?: typeof listThreadMessages
  now?: () => number
  nowIso?: () => string
  postThreadMessage?: typeof postThreadMessage
  replayRunEvents?: typeof replayRunEvents
  randomUUID?: () => string
  regenerateThreadTitle?: typeof regenerateThreadTitle
  renameThread?: typeof renameThread
  resumeRun?: typeof resumeRun
  runReconcileDelayMs?: number
  startThreadInteraction?: typeof startThreadInteraction
  storage?: StorageLike | null
  streamThreadEvents?: typeof streamThreadEvents
}

const cloneAttachments = (attachments: MessageAttachment[]): MessageAttachment[] =>
  attachments.map((attachment) => ({ ...attachment }))

const mergeAttachments = (
  existing: MessageAttachment[],
  incoming: MessageAttachment[],
): MessageAttachment[] => {
  if (incoming.length === 0) {
    return cloneAttachments(existing)
  }

  const merged = cloneAttachments(existing)
  const seen = new Set(merged.map((attachment) => attachment.id))

  for (const attachment of incoming) {
    if (seen.has(attachment.id)) {
      continue
    }

    seen.add(attachment.id)
    merged.push({ ...attachment })
  }

  return merged
}

const cloneBlocks = (blocks: Block[]): Block[] => $state.snapshot(blocks) as Block[]

const cloneUiMessage = (message: UiMessage): UiMessage => $state.snapshot(message) as UiMessage

const isTerminalRunStatus = (
  status: BackendRun['status'] | null,
): status is 'completed' | 'failed' | 'cancelled' =>
  status === 'completed' || status === 'failed' || status === 'cancelled'

const terminalRunStatusForFinishReason = (
  finishReason: MessageFinishReason | null,
): 'completed' | 'failed' | 'cancelled' | null => {
  switch (finishReason) {
    case 'stop':
      return 'completed'
    case 'error':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return null
  }
}

const isMessageAttachment = (value: unknown): value is MessageAttachment => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const attachment = value as Partial<MessageAttachment>
  return (
    typeof attachment.id === 'string' &&
    typeof attachment.name === 'string' &&
    typeof attachment.size === 'number' &&
    typeof attachment.mime === 'string' &&
    (attachment.kind === 'image' || attachment.kind === 'file') &&
    typeof attachment.url === 'string' &&
    (attachment.thumbnailUrl === undefined || typeof attachment.thumbnailUrl === 'string')
  )
}

const extractAttachmentsFromMetadata = (metadata: unknown): MessageAttachment[] => {
  if (typeof metadata !== 'object' || metadata === null) {
    return []
  }

  const raw = (metadata as Record<string, unknown>).attachments
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter(isMessageAttachment).map((attachment) => ({ ...attachment }))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const deriveAvailableModels = (catalog: BackendModelsCatalog): ChatModel[] => {
  const availableModels: ChatModel[] = [BACKEND_DEFAULT_MODEL_VALUE]
  const seenModels = new Set<string>([BACKEND_DEFAULT_MODEL_VALUE])

  for (const alias of catalog.aliases) {
    if (!alias.configured || seenModels.has(alias.model)) {
      continue
    }

    seenModels.add(alias.model)
    availableModels.push(alias.model as ChatModel)
  }

  return availableModels
}

const pickPreferredModel = (
  availableModels: readonly ChatModel[],
  catalog: BackendModelsCatalog | null,
): ChatModel => {
  if (availableModels.includes(PREFERRED_DEFAULT_MODEL as ChatModel)) {
    return PREFERRED_DEFAULT_MODEL as ChatModel
  }

  const catalogDefaultModel = catalog?.defaultModel as ChatModel | undefined
  if (catalogDefaultModel && availableModels.includes(catalogDefaultModel)) {
    return catalogDefaultModel
  }

  return (
    availableModels.find((model) => model !== BACKEND_DEFAULT_MODEL_VALUE) ??
    (BACKEND_DEFAULT_MODEL_VALUE as ChatModel)
  )
}

const getSelectedModelAliases = (catalog: BackendModelsCatalog | null, model: ChatModel) => {
  if (!catalog) {
    return []
  }

  if (model === BACKEND_DEFAULT_MODEL_VALUE) {
    return catalog.aliases.filter((alias) => alias.isDefault)
  }

  return catalog.aliases.filter((alias) => alias.configured && alias.model === model)
}

const deriveAvailableReasoningModes = (
  catalog: BackendModelsCatalog | null,
  model: ChatModel,
): ChatReasoningModeOption[] => {
  const reasoningModes = new Set<ReasoningEffort>()

  for (const alias of getSelectedModelAliases(catalog, model)) {
    for (const effort of alias.reasoningModes) {
      reasoningModes.add(effort)
    }
  }

  const options: ChatReasoningModeOption[] = [
    {
      id: BACKEND_DEFAULT_REASONING_VALUE,
      label: 'default',
    },
  ]

  if (!catalog) {
    return options
  }

  for (const mode of catalog.reasoningModes) {
    if (reasoningModes.has(mode.effort)) {
      options.push({
        id: mode.effort,
        label: mode.label,
      })
    }
  }

  return options
}

const pickPreferredReasoningMode = (
  availableReasoningModes: readonly ChatReasoningModeOption[],
): ChatReasoningMode => {
  const explicitModes = availableReasoningModes.filter(
    (mode) => mode.id !== BACKEND_DEFAULT_REASONING_VALUE,
  )

  if (explicitModes.length === 1 && explicitModes[0]?.id === 'none') {
    return BACKEND_DEFAULT_REASONING_VALUE as ChatReasoningMode
  }

  return (availableReasoningModes.find((mode) => mode.id === PREFERRED_DEFAULT_REASONING)?.id ??
    explicitModes[0]?.id ??
    BACKEND_DEFAULT_REASONING_VALUE) as ChatReasoningMode
}

export const createChatStore = (dependencies: ChatStoreDependencies = {}) => {
  const branchThreadImpl = dependencies.branchThread ?? branchThread
  const cancelRunImpl = dependencies.cancelRun ?? cancelRun
  const createSessionImpl = dependencies.createSession ?? createSession
  const createSessionThreadImpl = dependencies.createSessionThread ?? createSessionThread
  const deleteThreadImpl = dependencies.deleteThread ?? deleteThread
  const editThreadMessageImpl = dependencies.editThreadMessage ?? editThreadMessage
  const getAccountPreferencesImpl =
    dependencies.getAccountPreferences ??
    (typeof window === 'undefined' ? null : getAccountPreferences)
  const getAgentImpl = dependencies.getAgent ?? getAgent
  const getRunImpl = dependencies.getRun ?? getRun
  const getSupportedModelsImpl =
    dependencies.getSupportedModels ?? (typeof window === 'undefined' ? null : getSupportedModels)
  const getThreadBudgetImpl = dependencies.getThreadBudget ?? getThreadBudget
  const getThreadImpl = dependencies.getThread ?? getThread
  const listThreadMessagesImpl = dependencies.listThreadMessages ?? listThreadMessages
  const now = dependencies.now ?? Date.now
  const nowIso = dependencies.nowIso ?? (() => new Date().toISOString())
  const postThreadMessageImpl = dependencies.postThreadMessage ?? postThreadMessage
  const replayRunEventsImpl = dependencies.replayRunEvents ?? replayRunEvents
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID())
  const regenerateThreadTitleImpl = dependencies.regenerateThreadTitle ?? regenerateThreadTitle
  const renameThreadImpl = dependencies.renameThread ?? renameThread
  const resumeRunImpl = dependencies.resumeRun ?? resumeRun
  const completedResponseStreamDrainMs = dependencies.completedResponseStreamDrainMs ?? 250
  const runReconcileDelayMs = dependencies.runReconcileDelayMs ?? 2_000
  const startThreadInteractionImpl = dependencies.startThreadInteraction ?? startThreadInteraction
  const persistence = createChatPersistence({
    cloneAttachments,
    cloneBlocks,
    getTenantId: () => getApiTenantId()?.trim(),
    scopeKey: STORAGE_KEY,
    scopeSeparator: STORAGE_KEY_SCOPE_SEPARATOR,
    storage: dependencies.storage,
  })
  const threadMessageMapper = createThreadMessageMapper({
    cloneAttachments,
    extractAttachmentsFromMetadata,
    mergeAttachments,
  })
  const streamThreadEventsImpl = dependencies.streamThreadEvents ?? streamThreadEvents
  const localAttachmentsByMessageId = new Map<string, MessageAttachment[]>()
  const runTranscripts = createRunTranscriptStore({
    cloneAttachments,
    cloneBlocks,
    extractSandboxOutputAttachments,
    isTerminalRunStatus,
    mergeAttachments,
    settleBlocksForRunTerminalState,
    terminalRunStatusForFinishReason,
  })
  const threadStreamController = createThreadStreamController<ViewLease>({
    isAbortError,
    streamThreadEvents: streamThreadEventsImpl,
  })
  let runLifecycle: ReturnType<typeof createRunLifecycleCoordinator> | null = null
  let eventEngine: ReturnType<typeof createChatEventEngine> | null = null
  let liveAssistantLane: ReturnType<typeof createLiveAssistantLaneCoordinator> | null = null
  let persistedSnapshotHandler: ReturnType<typeof createPersistedSnapshotHandler>
  let liveAssistantMessageId: MessageId | null = null
  let pendingOptimisticMessageId: MessageId | null = null
  let pendingOptimisticOwner: PendingOptimisticOwner | null = null
  let lastTerminalRunId: RunId | null = null
  let retainedAssistantMessages: UiMessage[] = $state([])

  const toDisplayError = (error: unknown, fallback: string): string =>
    error instanceof Error ? humanizeErrorMessage(error.message) : fallback

  const extractEventErrorMessage = (error: unknown, fallback: string): string => {
    if (typeof error === 'string') {
      return error.trim() || fallback
    }
    if (error != null && typeof error === 'object' && 'message' in error) {
      const message = (error as { message: unknown }).message
      return typeof message === 'string' ? message.trim() || fallback : fallback
    }
    return fallback
  }

  const state: ChatState = $state({
    contextBudget: null,
    eventCursor: 0,
    isCancelling: false,
    isLoading: false,
    isThreadNaming: false,
    isReconnecting: false,
    isResolvingWait: false,
    isStreaming: false,
    isWaiting: false,
    error: null,
    memoryActivity: 'idle' as MemoryActivity,
    messageEditDraft: null,
    runId: null,
    runStatus: null,
    sessionId: null,
    streamPulse: 0,
    threadTitle: null,
    threadId: null,
    title: DEFAULT_TITLE,
  })
  let durableMessages: UiMessage[] = $state([])
  let optimisticMessages: UiMessage[] = $state([])
  let liveAssistantMessage: UiMessage | null = $state(null)
  let messages: UiMessage[] = $state.raw([])
  const leaseState = createChatLeaseState({
    getLastTerminalRunId: () => lastTerminalRunId,
    getRunId: () => state.runId,
    getThreadId: () => state.threadId,
  })

  const summarizeMessage = (message: UiMessage) => ({
    blockTypes: message.blocks.map((block) => block.type),
    id: message.id,
    role: message.role,
    runId: message.runId,
    sequence: message.sequence,
    status: message.status,
    textLength: message.text.length,
    uiKey: message.uiKey ?? message.id,
  })

  const summarizeRunTranscript = (transcript: RunTranscriptState) => ({
    blockTypes: transcript.blocks.map((block) => block.type),
    messageId: transcript.messageId,
    runId: transcript.runId,
    sequence: transcript.sequence,
    sources: transcript.sources,
    status: transcript.status,
    textLength: transcript.text.length,
  })

  const getChatStoreDebugSnapshot = () => ({
    activeRunReplayGuard: runBootstrap.activeRunReplayGuard,
    activeStreamContext: threadStreamController.context,
    activeSubmitId: leaseState.activeSubmitId,
    durableMessages: durableMessages.map(summarizeMessage),
    eventCursor: state.eventCursor,
    isStreaming: state.isStreaming,
    isWaiting: state.isWaiting,
    liveAssistantMessage: liveAssistantMessage ? summarizeMessage(liveAssistantMessage) : null,
    optimisticMessages: optimisticMessages.map(summarizeMessage),
    projectedMessages: messages.map(summarizeMessage),
    retainedAssistantMessages: retainedAssistantMessages.map(summarizeMessage),
    runTranscripts: Array.from(runTranscripts.values()).map(summarizeRunTranscript),
    runId: state.runId,
    runEpoch: leaseState.runEpoch,
    runStatus: state.runStatus,
    threadId: state.threadId,
    viewEpoch: leaseState.viewEpoch,
  })

  registerChatDebugSnapshot('store', getChatStoreDebugSnapshot)

  const captureViewLease = (): ViewLease => leaseState.captureViewLease()

  const beginViewLease = (): ViewLease => leaseState.beginViewLease()

  const isViewLeaseCurrent = (lease: ViewLease): boolean => leaseState.isViewLeaseCurrent(lease)

  const isThreadLeaseCurrent = (lease: ViewLease, threadId: ThreadId | null): boolean =>
    leaseState.isThreadLeaseCurrent(lease, threadId)

  const beginSubmitLease = (): SubmitLease => leaseState.beginSubmitLease()

  const isSubmitLeaseCurrent = (lease: SubmitLease): boolean =>
    leaseState.isSubmitLeaseCurrent(lease)

  const releaseSubmitLease = (lease: SubmitLease) => leaseState.releaseSubmitLease(lease)

  const captureRunLease = (runId: RunId | null = state.runId): RunLease =>
    leaseState.captureRunLease(runId)

  const isRunLeaseCurrent = (lease: RunLease): boolean => leaseState.isRunLeaseCurrent(lease)

  const preferencesState = createChatPreferencesState<ViewLease>({
    defaultModelValue: BACKEND_DEFAULT_MODEL_VALUE as ChatModel,
    defaultReasoningValue: BACKEND_DEFAULT_REASONING_VALUE as ChatReasoningMode,
    deriveAvailableModels,
    deriveAvailableReasoningModes,
    getAccountPreferences: getAccountPreferencesImpl,
    async getAgentName(agentId) {
      const agent = await getAgentImpl(asAgentId(agentId))
      return agent.name
    },
    getSupportedModels: getSupportedModelsImpl,
    initialModel: BACKEND_DEFAULT_MODEL_VALUE as ChatModel,
    initialReasoningMode: BACKEND_DEFAULT_REASONING_VALUE as ChatReasoningMode,
    isViewLeaseCurrent,
    pickPreferredModel,
    pickPreferredReasoningMode,
  })

  const clearTypewriterPlaybackKey = (messageKey: string | null | undefined) => {
    if (!messageKey || messageKey.trim().length === 0) {
      return
    }

    typewriterPlayback.clear(messageKey)
  }

  const clearTypewriterPlaybackForMessage = (
    message: Pick<UiMessage, 'id' | 'uiKey'> | null | undefined,
  ) => {
    if (!message) {
      return
    }

    const stableKey = message.uiKey ?? message.id
    clearTypewriterPlaybackKey(stableKey)

    if (message.id !== stableKey) {
      clearTypewriterPlaybackKey(message.id)
    }
  }

  const {
    rememberRunTranscriptFromMessage,
    projectAssistantMessageFromRunTranscript,
    resolveTranscriptProjectionMessageId,
    ensureRunTranscript,
    clearTranscriptTextBlocksForLiveResume,
    syncSandboxAttachmentsFromTranscript,
    syncLiveAssistantProjectionFromTranscript,
  } = createRunTranscriptShell({
    cloneAttachments,
    cloneUiMessage,
    getIsWaiting() {
      return state.isWaiting
    },
    getLiveAssistantLane() {
      return liveAssistantLane
    },
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getLiveAssistantMessageIdState() {
      return liveAssistantMessageId
    },
    getRunId() {
      return state.runId
    },
    getRunStatus() {
      return state.runStatus
    },
    runTranscripts,
    syncSandboxAttachmentsFromBlocks(message, options) {
      threadMessageMapper.syncSandboxAttachmentsFromBlocks(message, options)
    },
  })

  const applyThreadTitle = (thread: Pick<BackendThread, 'title'>) => {
    state.threadTitle = thread.title?.trim() || null
    state.title = state.threadTitle ?? DEFAULT_TITLE
  }

  const {
    restoreThreadEventCursorIndex,
    setThreadEventCursor,
    resolveThreadEventCursor,
    persistState,
    clearPersistedState,
    primeFromPersistedState,
  } = createChatPersistenceShell({
    clearPersistenceStore() {
      persistence.clear()
    },
    getAttachmentsByMessageId() {
      return localAttachmentsByMessageId
    },
    getDurableMessages() {
      return durableMessages
    },
    getEventCursor() {
      return state.eventCursor
    },
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getOptimisticMessages() {
      return optimisticMessages
    },
    getPersistedActiveRunTranscript() {
      return persistedSnapshotHandler.getPersistedActiveRunTranscript()
    },
    getRunId() {
      return state.runId
    },
    getSessionId() {
      return state.sessionId
    },
    getThreadId() {
      return state.threadId
    },
    readPersistedState() {
      return persistence.readState()
    },
    resolvePersistedThreadEventCursor(threadId) {
      return persistence.resolveThreadEventCursor(threadId)
    },
    restorePersistedThreadEventCursorIndex(persistedState) {
      persistence.restoreThreadEventCursorIndex(persistedState)
    },
    setEventCursor(cursor) {
      state.eventCursor = cursor
    },
    setPersistedThreadEventCursor(threadId, eventCursor) {
      return persistence.setThreadEventCursor(threadId, eventCursor)
    },
    applyPersistedStateSnapshot(persistedState) {
      return persistedSnapshotHandler.applyPersistedStateSnapshot(persistedState)
    },
    applyPersistedActiveRunSnapshot(persistedState, options) {
      persistedSnapshotHandler.applyPersistedActiveRunSnapshot(persistedState, options)
    },
    writePersistenceStore(input) {
      persistence.writeState(input)
    },
  })

  const getLocalAttachments = (messageId: MessageId): MessageAttachment[] =>
    localMessageState.getLocalAttachments(messageId)

  const cloneMessageEditDraft = (draft: MessageEditDraft | null): MessageEditDraft | null =>
    localMessageState.cloneMessageEditDraft(draft)

  const updateMessageEditDraft = (
    input: Parameters<typeof localMessageState.updateMessageEditDraft>[0],
  ) => {
    localMessageState.updateMessageEditDraft(input)
  }

  const restoreMessageEditDraft = (
    input: Parameters<typeof localMessageState.restoreMessageEditDraft>[0],
  ) => {
    localMessageState.restoreMessageEditDraft(input)
  }

  const clearMessageEditDraft = () => {
    localMessageState.clearMessageEditDraft()
  }

  const setLocalAttachments = (messageId: MessageId, attachments: MessageAttachment[]) => {
    localMessageState.setLocalAttachments(messageId, attachments)
  }

  const clearPendingOptimisticOwnershipIfCurrent = (messageId: MessageId | null): boolean =>
    localMessageState.clearPendingOptimisticOwnershipIfCurrent(messageId)

  const bindPendingOptimisticOwnership = (
    messageId: MessageId,
    ownership: { submitId: number; viewEpoch: number },
  ) => {
    localMessageState.bindPendingOptimisticOwnership(messageId, ownership)
  }

  const renderedMessageState = createRenderedMessageStateCoordinator({
    bumpStreamPulse() {
      state.streamPulse += 1
    },
    getDurableMessages() {
      return durableMessages
    },
    getIsStreaming() {
      return state.isStreaming
    },
    getIsWaiting() {
      return state.isWaiting
    },
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getMessages() {
      return messages
    },
    getOptimisticMessages() {
      return optimisticMessages
    },
    getRetainedAssistantMessages() {
      return retainedAssistantMessages
    },
    getRunStatus() {
      return state.runStatus
    },
    isTerminalRunStatus,
    logDebug: logChatDebug,
    projectAssistantMessageFromRunTranscript,
    rememberRunTranscriptFromMessage,
    setDurableMessages(nextMessages) {
      durableMessages = nextMessages
    },
    setLiveAssistantMessage(message) {
      liveAssistantMessage = message
    },
    setLiveAssistantMessageIdState(messageId) {
      liveAssistantMessageId = messageId
    },
    setMessages(nextMessages) {
      messages = nextMessages
    },
    setOptimisticMessages(nextMessages) {
      optimisticMessages = nextMessages
    },
    setRetainedAssistantMessages(nextMessages) {
      retainedAssistantMessages = nextMessages
    },
    summarizeMessage,
    toDurableThreadMessageRow(message) {
      return runTranscripts.toDurableThreadMessageRow(message)
    },
  })

  const durableHasAssistantForRun = renderedMessageState.durableHasAssistantForRun
  const liveAssistantHasBlocksForRun = renderedMessageState.liveAssistantHasBlocksForRun
  const retainedAssistantHasRun = renderedMessageState.retainedAssistantHasRun
  const rememberStableUiKey = renderedMessageState.rememberStableUiKey
  const resolveStableUiKey = renderedMessageState.resolveStableUiKey
  const withStableUiKey = renderedMessageState.withStableUiKey
  const rebuildToolIndexForMessage = renderedMessageState.rebuildToolIndexForMessage
  const replaceDurableMessages = renderedMessageState.replaceDurableMessages
  const syncProjectedMessages = renderedMessageState.syncProjectedMessages
  const syncProjectedMessagesIfLiveAssistantProjected =
    renderedMessageState.syncProjectedMessagesIfLiveAssistantProjected
  const messageIndexById = renderedMessageState.messageIndexById
  const toolIndexByMessageId = renderedMessageState.toolIndexByMessageId

  liveAssistantLane = createLiveAssistantLaneCoordinator({
    clearTypewriterPlaybackForMessage,
    cloneAttachments,
    cloneBlocks,
    cloneUiMessage,
    durableHasAssistantForRun,
    ensureRunTranscript,
    getActiveRunId() {
      return state.runId
    },
    getIsWaiting() {
      return state.isWaiting
    },
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getLiveAssistantMessageIdState() {
      return liveAssistantMessageId
    },
    getMessageIndexById(messageId) {
      return messageIndexById.get(messageId)
    },
    getRetainedAssistantMessages() {
      return retainedAssistantMessages
    },
    getRunTranscript(runId) {
      return runTranscripts.get(runId) ?? null
    },
    hasKeepWorthyMessageContent,
    logDebug: logChatDebug,
    projectAssistantMessageFromRunTranscript,
    randomUUID,
    rebuildToolIndexForMessage,
    rememberStableUiKey,
    setLiveAssistantMessage(message) {
      liveAssistantMessage = message
    },
    setLiveAssistantMessageIdState(messageId) {
      liveAssistantMessageId = messageId
    },
    setRetainedAssistantMessages(messages) {
      retainedAssistantMessages = messages
    },
    setStreamPulse() {
      state.streamPulse += 1
    },
    summarizeMessage,
    syncProjectedMessages,
    syncProjectedMessagesIfLiveAssistantProjected,
    withStableUiKey,
  })

  const localMessageState = createLocalMessageStateCoordinator({
    cloneAttachments,
    getLocalAttachmentsMap() {
      return localAttachmentsByMessageId
    },
    getMessageEditDraft() {
      return state.messageEditDraft
    },
    getOptimisticMessages() {
      return optimisticMessages
    },
    getPendingOptimisticMessageId() {
      return pendingOptimisticMessageId
    },
    logDebug: logChatDebug,
    nowIso,
    persistState,
    randomUUID,
    rememberStableUiKey,
    setMessageEditDraft(draft) {
      state.messageEditDraft = draft
    },
    setOptimisticMessages(messages) {
      optimisticMessages = messages
    },
    setPendingOptimisticOwnership(messageId, owner) {
      pendingOptimisticMessageId = messageId
      pendingOptimisticOwner = owner
    },
    summarizeMessage,
    syncProjectedMessages,
  })

  const activeRunShell = createActiveRunShellCoordinator({
    bumpRunEpoch() {
      leaseState.bumpRunEpoch()
    },
    clearActiveSubmit() {
      leaseState.clearActiveSubmit()
    },
    clearActiveTransport() {
      clearActiveTransport()
    },
    clearLocalAttachments() {
      localAttachmentsByMessageId.clear()
    },
    clearPendingWaits() {
      runWaits.clearPendingWaits()
    },
    clearRenderedMessageCaches() {
      renderedMessageState.clearCaches()
    },
    clearResolvingWaits() {
      runWaits.clearResolving()
    },
    clearRunReconcileTimer() {
      runLifecycle?.clearRunReconcileTimer()
    },
    clearRunReplayGuard() {
      clearRunReplayGuard()
    },
    clearRunTranscripts() {
      runTranscripts.clear()
    },
    clearTypewriterPlaybackAll() {
      typewriterPlayback.clearAll()
    },
    defaultTitle: DEFAULT_TITLE,
    getIsWaiting() {
      return state.isWaiting
    },
    getLiveAssistantLane() {
      return liveAssistantLane
    },
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getLiveAssistantMessageIdState() {
      return liveAssistantMessageId
    },
    getNow: now,
    getRandomUUID: randomUUID,
    getRunId() {
      return state.runId
    },
    setContextBudget(value) {
      state.contextBudget = value
    },
    setDurableMessages(messages) {
      durableMessages = messages
    },
    setError(message) {
      state.error = message
    },
    setEventCursor(cursor) {
      state.eventCursor = cursor
    },
    setIsCancelling(value) {
      state.isCancelling = value
    },
    setIsLoading(value) {
      state.isLoading = value
    },
    setIsReconnecting(value) {
      state.isReconnecting = value
    },
    setIsResolvingWait(value) {
      state.isResolvingWait = value
    },
    setIsStreaming(value) {
      state.isStreaming = value
    },
    setIsThreadNaming(value) {
      state.isThreadNaming = value
    },
    setIsWaiting(value) {
      state.isWaiting = value
    },
    setLastTerminalRunId(runId) {
      lastTerminalRunId = runId
    },
    setLiveAssistantMessage(message) {
      liveAssistantMessage = message
    },
    setLiveAssistantMessageIdState(messageId) {
      liveAssistantMessageId = messageId
    },
    setMemoryActivity(value) {
      state.memoryActivity = value
    },
    setMessageEditDraft(draft) {
      state.messageEditDraft = draft
    },
    setOptimisticMessages(messages) {
      optimisticMessages = messages
    },
    setPendingOptimisticOwnership(messageId, owner) {
      pendingOptimisticMessageId = messageId
      pendingOptimisticOwner = owner
    },
    setRetainedAssistantMessages(messages) {
      retainedAssistantMessages = messages
    },
    setRunId(runId) {
      state.runId = runId
    },
    setRunStatus(status) {
      state.runStatus = status
    },
    setSessionId(sessionId) {
      state.sessionId = sessionId
    },
    setStreamPulse(pulse) {
      state.streamPulse = pulse
    },
    setThreadId(threadId) {
      state.threadId = threadId
    },
    setThreadTitle(title) {
      state.threadTitle = title
    },
    setTitle(title) {
      state.title = title
    },
    syncProjectedMessages,
    syncProjectedMessagesIfLiveAssistantProjected,
  })

  const setActiveRunId = activeRunShell.setActiveRunId
  const bindActiveRun = activeRunShell.bindActiveRun
  const resetRunState = activeRunShell.resetRunState
  const resetState = activeRunShell.resetState
  const getLiveAssistantMessageId = activeRunShell.getLiveAssistantMessageId
  const primeLiveAssistantMessageId = activeRunShell.primeLiveAssistantMessageId
  const ensureLiveAssistantMessage = activeRunShell.ensureLiveAssistantMessage
  const prepareFreshLiveAssistantLane = activeRunShell.prepareFreshLiveAssistantLane
  const ensureStreamingAssistantShell = activeRunShell.ensureStreamingAssistantShell

  const runWaits = createRunWaitCoordinator<ViewLease>({
    bumpStreamPulse() {
      state.streamPulse += 1
    },
    ensureLiveAssistantMessage,
    ensureRunTranscript,
    getIsWaiting() {
      return state.isWaiting
    },
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getNowIso: nowIso,
    getRunId() {
      return state.runId
    },
    getRunStatus() {
      return state.runStatus
    },
    getTranscript(runId) {
      return runTranscripts.get(runId) ?? null
    },
    isThreadLeaseCurrent,
    rebuildToolIndexForMessage,
    rememberRunTranscriptFromMessage,
    resolveTranscriptProjectionMessageId,
    setIsReconnecting(value) {
      state.isReconnecting = value
    },
    setIsResolvingWait(value) {
      state.isResolvingWait = value
    },
    setIsStreaming(value) {
      state.isStreaming = value
    },
    syncLiveAssistantProjectionFromTranscript,
    syncProjectedMessages,
  })

  const ensurePendingWaitBlocks = runWaits.ensurePendingWaitBlocks
  const hydratePendingWaitState = runWaits.hydratePendingWaitState
  const getReplyablePendingWait = () => runWaits.getReplyablePendingWait()

  const transcriptHydrator = createRunTranscriptHydrator({
    cloneAttachments,
    cloneBlocks,
    durableHasAssistantForRun,
    finishReasonForRunStatus,
    getActiveRunId() {
      return state.runId
    },
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getLiveAssistantMessageIdState() {
      return liveAssistantMessageId
    },
    getRunTranscript(runId) {
      return runTranscripts.get(runId) ?? null
    },
    isResultRecord: isRecord,
    materializePersistedAssistantBlocks,
    rememberRunTranscriptFromMessage(message) {
      rememberRunTranscriptFromMessage(message, 'durableSnapshot')
    },
    setRunTranscript(runId, transcript) {
      runTranscripts.set(runId, transcript)
    },
    syncLiveAssistantProjectionFromTranscript,
    syncProjectedMessages,
    syncSandboxAttachmentsFromBlocks(message, options) {
      threadMessageMapper.syncSandboxAttachmentsFromBlocks(message, options)
    },
  })

  const hydrateAssistantTranscriptFromRunSnapshot =
    transcriptHydrator.hydrateAssistantTranscriptFromRunSnapshot

  const removeLiveAssistantMessage = activeRunShell.removeLiveAssistantMessage
  const releaseLiveAssistantAfterTerminal = activeRunShell.releaseLiveAssistantAfterTerminal
  const pruneLiveAssistantAfterThreadRefresh = activeRunShell.pruneLiveAssistantAfterThreadRefresh
  const restorePersistedRunTranscript = transcriptHydrator.restorePersistedRunTranscript

  persistedSnapshotHandler = createPersistedSnapshotHandler({
    bindActiveRun,
    cloneAttachments,
    cloneBlocks,
    getRunId() {
      return state.runId
    },
    getRunStatus() {
      return state.runStatus
    },
    getRunTranscript(runId) {
      return runTranscripts.get(runId) ?? null
    },
    isTerminalRunStatus,
    resolveThreadEventCursor,
    restorePersistedRunTranscript,
    restoreThreadEventCursorIndex,
    setAttachmentsByMessageId(attachmentsByMessageId) {
      localAttachmentsByMessageId.clear()
      for (const [messageId, attachments] of Object.entries(attachmentsByMessageId)) {
        localAttachmentsByMessageId.set(messageId, cloneAttachments(attachments))
      }
    },
    setEventCursor(eventCursor) {
      state.eventCursor = eventCursor
    },
    setIsCancelling(value) {
      state.isCancelling = value
    },
    setIsReconnecting(value) {
      state.isReconnecting = value
    },
    setIsResolvingWait(value) {
      state.isResolvingWait = value
    },
    setIsStreaming(value) {
      state.isStreaming = value
    },
    setIsWaiting(value) {
      state.isWaiting = value
    },
    setRunStatus(status) {
      state.runStatus = status
    },
    setSessionId(sessionId) {
      state.sessionId = sessionId
    },
    setThreadId(threadId) {
      state.threadId = threadId
    },
    syncProjectedMessages,
  })

  const replaceMessageId = (currentId: MessageId, nextId: MessageId) => {
    localMessageState.replaceMessageId(currentId, nextId)
  }

  const appendOptimisticUserMessage = (
    text: string,
    attachments: MessageAttachment[] = [],
  ): MessageId => localMessageState.appendOptimisticUserMessage(text, attachments)
  const threadMessageSync = createThreadMessageSyncCoordinator({
    clearMessageEditDraft,
    getDefaultLease() {
      return captureViewLease()
    },
    getLocalAttachments,
    getMessageEditDraftMessageId() {
      return state.messageEditDraft?.messageId ?? null
    },
    getPendingOptimisticMessageId() {
      return pendingOptimisticMessageId
    },
    getThreadId() {
      return state.threadId
    },
    getThreadLeaseCurrent: isThreadLeaseCurrent,
    getThreadBudget(threadId) {
      return getThreadBudgetImpl(threadId)
    },
    getLiveAssistantMessageIdState() {
      return liveAssistantMessageId
    },
    getOptimisticMessages() {
      return optimisticMessages
    },
    getRetainedAssistantMessages() {
      return retainedAssistantMessages
    },
    listThreadMessages(threadId) {
      return listThreadMessagesImpl(threadId)
    },
    mapThreadMessage(message) {
      return threadMessageMapper.toUiMessage(message, getLocalAttachments(message.id))
    },
    replaceDurableMessages,
    removeLocalAttachments(messageId) {
      localAttachmentsByMessageId.delete(messageId)
    },
    setContextBudget(budget) {
      state.contextBudget = budget as ContextBudget | null
    },
    setLiveAssistantMessage(message) {
      liveAssistantMessage = message
    },
    setLiveAssistantMessageIdState(messageId) {
      liveAssistantMessageId = messageId
    },
    setOptimisticMessages(messages) {
      optimisticMessages = messages
    },
    setPendingOptimisticOwnership(messageId, owner) {
      pendingOptimisticMessageId = messageId
      pendingOptimisticOwner = owner
    },
    setRetainedAssistantMessages(messages) {
      retainedAssistantMessages = messages
    },
    syncProjectedMessages,
    toContextBudget,
  })

  const { removeMessage, refreshThreadMessages, refreshThreadBudget } = threadMessageSync

  runLifecycle = createRunLifecycleCoordinator({
    bindActiveRun,
    captureRunLease,
    captureViewLease,
    clearPendingWaits: runWaits.clearPendingWaits,
    clearRunReplayGuard(runId) {
      runBootstrap.clearRunReplayGuard(runId)
    },
    ensurePendingWaitBlocks,
    ensureRunTranscript,
    extractSandboxOutputAttachments,
    getChatStoreDebugSnapshot,
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getRunTranscript(runId) {
      return runTranscripts.get(runId) ?? null
    },
    getRun: getRunImpl,
    getRunId() {
      return state.runId
    },
    getRunStatus() {
      return state.runStatus
    },
    getThreadId() {
      return state.threadId
    },
    hydrateAssistantTranscriptFromRunSnapshot,
    hydratePendingWaitState,
    isRunLeaseCurrent,
    isTerminalRunStatus,
    isViewLeaseCurrent,
    logDebug: logChatDebug,
    mergeAttachments,
    nowIso,
    persistState,
    primeRunReplayGuardFromSnapshot(run) {
      runBootstrap.primeRunReplayGuardFromSnapshot(run)
    },
    refreshThreadBudget,
    refreshThreadMessages,
    releaseLiveAssistantAfterTerminal,
    resolveTranscriptProjectionMessageId,
    runReconcileDelayMs,
    setActiveRunId,
    setError(message) {
      state.error = message
    },
    setIsCancelling(value) {
      state.isCancelling = value
    },
    setIsResolvingWait(value) {
      state.isResolvingWait = value
    },
    setIsStreaming(value) {
      state.isStreaming = value
    },
    setIsWaiting(value) {
      state.isWaiting = value
    },
    setLastTerminalRunId(runId) {
      lastTerminalRunId = runId
    },
    setRunStatus(status) {
      state.runStatus = status
    },
    settleBlocksForRunTerminalState,
    syncLiveAssistantProjectionFromTranscript,
    syncProjectedMessages,
    threadStreamAbort() {
      threadStreamController.abort()
    },
    toDisplayError,
    rememberRunTranscriptFromMessage,
    updateLiveAssistantMessage(updater) {
      if (!liveAssistantMessage) {
        return
      }
      updater(liveAssistantMessage)
    },
  })

  const scheduleRunReconciliation = (
    runId: RunId,
    viewLease: ViewLease = captureViewLease(),
    runLease: RunLease = captureRunLease(runId),
  ) => runLifecycle.scheduleRunReconciliation(runId, viewLease, runLease)

  const syncRunStateFromBackend = async (
    run: BackendRun,
    viewLease: ViewLease = captureViewLease(),
    runLease: RunLease = captureRunLease(run.id),
  ) => runLifecycle.syncRunStateFromBackend(run, viewLease, runLease)

  const reconcileRunState = async (
    runId: RunId,
    viewLease: ViewLease = captureViewLease(),
    runLease: RunLease = captureRunLease(runId),
  ) => runLifecycle.reconcileRunState(runId, viewLease, runLease)

  const awaitStreamOutcome = async (
    streamPromise: Promise<void>,
    runId: RunId | null,
    viewLease: ViewLease = captureViewLease(),
    runLease: RunLease = captureRunLease(runId),
  ) => {
    try {
      await streamPromise
    } catch (error) {
      if (threadStreamController.isCurrentAbortError(error)) {
        return
      }

      if (runId && isViewLeaseCurrent(viewLease) && isRunLeaseCurrent(runLease)) {
        try {
          await reconcileRunState(runId, viewLease, runLease)
          return
        } catch {
          // Fall through to surface the original stream error.
        }
      }

      throw error
    }
  }

  const finalizeRun = (
    status: BackendRun['status'],
    finishReason: MessageFinishReason | null,
    options: { runId?: RunId | null } = {},
  ) => runLifecycle.finalizeRun(status, finishReason, options)

  const runOutput = createRunOutputCoordinator({
    bindActiveRun,
    clearPendingWaits: runWaits.clearPendingWaits,
    durableHasAssistantForRun,
    ensurePendingWaitBlocks: runWaits.ensurePendingWaitBlocks,
    ensureStreamingAssistantShell,
    finalizeRun,
    getRunId() {
      return state.runId
    },
    getRunStatus() {
      return state.runStatus
    },
    getThreadId() {
      return state.threadId
    },
    hasActiveStream() {
      return threadStreamController.hasActiveStream()
    },
    isTerminalRunStatus,
    mergePendingWaitsForRun: runWaits.mergePendingWaitsForRun,
    nowIso,
    persistState,
    refreshThreadBudget,
    scheduleCompletedResponseSettle(runId, delayMs) {
      runLifecycle?.scheduleCompletedResponseSettle(
        runId,
        delayMs ?? completedResponseStreamDrainMs,
      )
    },
    scheduleRunReconciliation,
    setIsStreaming(value) {
      state.isStreaming = value
    },
    setIsWaiting(value) {
      state.isWaiting = value
    },
    setPendingWaits: runWaits.setPendingWaits,
    setRunStatus(status) {
      state.runStatus = status
    },
    setSessionId(sessionId) {
      state.sessionId = sessionId
    },
    setThreadId(threadId) {
      state.threadId = threadId
    },
    threadStreamAbort() {
      threadStreamController.abort()
    },
  })

  const applyResumeRunOutput = runOutput.applyResumeRunOutput
  const applyRunExecutionOutput = runOutput.applyRunExecutionOutput
  const applyThreadInteractionStart = runOutput.applyThreadInteractionStart

  const ingestEvent = (
    ...args: Parameters<NonNullable<typeof eventEngine>['ingestEvent']>
  ): boolean => eventEngine?.ingestEvent(...args) ?? false

  const threadStreamRuntime = createThreadStreamRuntime<ViewLease>({
    bumpStreamPulse() {
      state.streamPulse += 1
    },
    captureViewLease,
    clearCompletedResponseSettle() {
      runLifecycle?.clearCompletedResponseSettle()
    },
    getEventCursor() {
      return state.eventCursor
    },
    ingestEvent,
    setIsReconnecting(value) {
      state.isReconnecting = value
    },
    threadLeaseCurrent: isThreadLeaseCurrent,
    threadStreamController,
  })

  const {
    clearActiveTransport,
    stopActiveStream,
    connectThreadEventStream,
    ensureThreadEventStream,
  } = threadStreamRuntime

  const runBootstrap = createRunBootstrapCoordinator({
    clearPendingWaits: runWaits.clearPendingWaits,
    eventRunId(event) {
      return eventEngine?.eventRunId(event) ?? null
    },
    getRun: getRunImpl,
    getThreadId() {
      return state.threadId
    },
    getThreadLeaseCurrent: isThreadLeaseCurrent,
    getRunLeaseCurrent: isRunLeaseCurrent,
    ingestEvent(event, options) {
      return ingestEvent(event, options)
    },
    isAbortError(error, signal) {
      return isAbortError(error, signal ?? undefined)
    },
    isTerminalRunStatus,
    replayRunEvents: replayRunEventsImpl,
    rememberRunTranscriptFromMessage,
    resolveKnownChildRunIds() {
      return eventEngine?.collectKnownChildRunIds() ?? new Set()
    },
    setThreadEventCursor,
    syncLiveAssistantProjectionFromTranscript,
    syncProjectedMessages,
    persistState,
    getLiveAssistantMessageId(runId) {
      return liveAssistantMessage?.runId === runId
        ? liveAssistantMessage.id
        : liveAssistantMessageId
    },
  })

  const clearRunReplayGuard = runBootstrap.clearRunReplayGuard
  const primeRunReplayGuardFromSnapshot = runBootstrap.primeRunReplayGuardFromSnapshot
  const shouldIgnoreReplayGuardedRunEvent = runBootstrap.shouldIgnoreReplayGuardedRunEvent
  const resolveHydratedRun = runBootstrap.resolveHydratedRun
  const bootstrapActiveRunTranscriptFromBackend =
    runBootstrap.bootstrapActiveRunTranscriptFromBackend

  eventEngine = createChatEventEngine({
    applyEvent,
    applyRunExecutionOutput,
    applyThreadTitle,
    bindActiveRun,
    captureViewLease,
    clearPendingWaits: runWaits.clearPendingWaits,
    clearTranscriptTextBlocksForLiveResume,
    durableHasAssistantForRun,
    ensureLiveAssistantMessage,
    ensureRunTranscript,
    eventCursor() {
      return state.eventCursor
    },
    extractEventErrorMessage,
    finalizeRun,
    getContextBudget() {
      return state.contextBudget
    },
    getDurableMessages() {
      return durableMessages
    },
    getIsStreaming() {
      return state.isStreaming
    },
    getLiveAssistantMessage() {
      return liveAssistantMessage
    },
    getPendingOptimisticMessageId() {
      return pendingOptimisticMessageId
    },
    getPendingOptimisticOwner() {
      return pendingOptimisticOwner
    },
    getPendingWaits() {
      return runWaits.pending
    },
    getRetainedAssistantMessages() {
      return retainedAssistantMessages
    },
    getRunId() {
      return state.runId
    },
    getRunStatus() {
      return state.runStatus
    },
    getThreadId() {
      return state.threadId
    },
    getViewEpoch() {
      return leaseState.viewEpoch
    },
    humanizeErrorMessage,
    isTerminalRunStatus,
    isViewLeaseCurrent(lease) {
      return isViewLeaseCurrent(lease)
    },
    liveAssistantHasBlocksForRun,
    logDebug: logChatDebug,
    mergePendingWaitsForRun: runWaits.mergePendingWaitsForRun,
    nowIso,
    parseUsage,
    persistState,
    projectAssistantMessageFromRunTranscript,
    reconcileFailedRunState(runId) {
      runLifecycle?.reconcileFailedRunState(runId)
    },
    refreshThreadMessages,
    rememberRunTranscriptFromMessage,
    removePendingWaitByCallId: runWaits.removePendingWaitByCallId,
    removePendingWaitByWaitId: runWaits.removePendingWaitByWaitId,
    replaceMessageId,
    resolveStableUiKey,
    resolveTranscriptProjectionMessageId,
    scheduleRunReconciliation,
    setContextBudget(budget) {
      state.contextBudget = budget
    },
    setError(message) {
      state.error = message
    },
    setEventCursor(cursor) {
      state.eventCursor = cursor
    },
    setIsResolvingWait(value) {
      state.isResolvingWait = value
    },
    setIsStreaming(value) {
      state.isStreaming = value
    },
    setIsThreadNaming(value) {
      state.isThreadNaming = value
    },
    setIsWaiting(value) {
      state.isWaiting = value
    },
    setMemoryActivity(value) {
      state.memoryActivity = value
    },
    setPendingWaits: runWaits.setPendingWaits,
    setRunStatus(status) {
      state.runStatus = status
    },
    setSessionId(sessionId) {
      state.sessionId = sessionId
    },
    setStreamPulse() {
      state.streamPulse += 1
    },
    setThreadId(threadId) {
      state.threadId = threadId
    },
    shouldIgnoreReplayGuardedRunEvent,
    syncLiveAssistantProjectionFromTranscript,
    syncPendingWaitBlocks: runWaits.syncPendingWaitBlocks,
    syncProjectedMessages,
    syncSandboxAttachmentsFromLiveMessage(message, options) {
      threadMessageMapper.syncSandboxAttachmentsFromBlocks(message, options)
    },
    syncSandboxAttachmentsFromTranscript,
    threadMessageRefreshError(error) {
      return toDisplayError(error, 'Failed to refresh thread messages.')
    },
    toolIndexByMessageId,
    typewriterMarkStreamed(key) {
      typewriterPlayback.markStreamed(key)
    },
    updateLiveAssistantMessage(updater) {
      if (!liveAssistantMessage) {
        return
      }
      updater(liveAssistantMessage)
    },
    upsertPendingWait: runWaits.upsertPendingWait,
    withEstimatedOutputDelta,
    withReconciledUsage,
    withStreamingBudgetStart,
  })

  const pendingWaitCommands = createPendingWaitCommands<ViewLease>({
    applyOptimisticConfirmationEvent(...args) {
      eventEngine?.applyOptimisticConfirmationEvent(...args)
    },
    applyResumeRunOutput,
    bumpStreamPulse() {
      state.streamPulse += 1
    },
    captureViewLease,
    ensureThreadEventStream,
    finishResolvingWait: runWaits.finishResolvingWait,
    findPendingWait(waitId) {
      return runWaits.find(waitId)
    },
    getActiveRunId() {
      return state.runId
    },
    getPendingWaitIds() {
      return runWaits.waitIds
    },
    getPendingWaits() {
      return runWaits.pending
    },
    getSessionId() {
      return state.sessionId
    },
    getThreadId() {
      return state.threadId
    },
    getVisibleToolBlockStatus(callId) {
      return eventEngine?.getVisibleToolBlockStatus(callId) ?? null
    },
    hasResolvingWait(waitId) {
      return runWaits.hasResolving(waitId)
    },
    isThreadLeaseCurrent,
    postThreadMessage: postThreadMessageImpl,
    removePendingWaitByWaitId: runWaits.removePendingWaitByWaitId,
    replaceMessageId,
    resumeRun: resumeRunImpl,
    setError(message) {
      state.error = message
    },
    setSessionId(sessionId) {
      state.sessionId = sessionId
    },
    startResolvingWait: runWaits.startResolvingWait,
    toDisplayError,
  })

  const threadInteractionCommands = createThreadInteractionCommands<ViewLease, RunLease>({
    applyThreadInteractionStart,
    awaitStreamOutcome,
    captureRunLease,
    ensureThreadEventStream,
    replaceMessageId,
    startThreadInteraction: startThreadInteractionImpl,
  })

  const submitBranches = createSubmitBranches<ViewLease>({
    applyThreadTitle,
    clearMessageEditDraft,
    clearPendingOptimisticOwnershipIfCurrent,
    createSession: () => createSessionImpl({}),
    createSessionThread: (sessionId) => createSessionThreadImpl(sessionId, {}),
    editThreadMessage: editThreadMessageImpl,
    getThread: getThreadImpl,
    pendingWaitSubmitReply: pendingWaitCommands.submitReply,
    persistState,
    pruneLiveAssistantAfterThreadRefresh,
    refreshThreadMessages,
    removeLiveAssistantMessage,
    removeMessage,
    resetRunState,
    restoreMessageEditDraft,
    setError(message) {
      state.error = message
    },
    setLocalAttachments,
    setSessionId(sessionId) {
      state.sessionId = sessionId
    },
    setThreadId(threadId) {
      state.threadId = threadId
    },
    startThreadInteraction: threadInteractionCommands.start,
    stopActiveStream,
    streamAbortError: (error) => threadStreamController.isCurrentAbortError(error),
    toDisplayError,
    updateMessageEditDraft,
  })

  const submitLifecycle = createSubmitLifecycle({
    appendOptimisticUserMessage,
    bindPendingOptimisticOwnership,
    ensureStreamingAssistantShell,
    enterStreamingSubmitState() {
      state.isStreaming = true
      state.isCancelling = false
      state.isReconnecting = false
      state.isWaiting = false
    },
    prepareAssistantLaneForSubmit() {
      if (isTerminalRunStatus(state.runStatus)) {
        prepareFreshLiveAssistantLane()
      } else if (
        liveAssistantMessage &&
        liveAssistantMessage.role === 'assistant' &&
        liveAssistantMessage.status !== 'streaming' &&
        !retainedAssistantHasRun(liveAssistantMessage.runId)
      ) {
        prepareFreshLiveAssistantLane()
      }
    },
    primeLiveAssistantMessageId,
    resetRunState,
    setResolvedConversationTarget(target) {
      preferencesState.setResolvedConversationTarget(target)
    },
  })

  const submitCommand = createSubmitCommand<ViewLease, SubmitLease>({
    beginSubmitLease,
    buildViewLease(submitLease) {
      return {
        epoch: submitLease.viewEpoch,
      }
    },
    defaultModelValue: BACKEND_DEFAULT_MODEL_VALUE as ChatModel,
    defaultReasoningValue: BACKEND_DEFAULT_REASONING_VALUE as ChatReasoningMode,
    finalizeCurrentSubmitState(submitStillCurrent) {
      if (submitStillCurrent) {
        if (!state.isWaiting) {
          state.isStreaming = false
        }
        state.isCancelling = false
        state.isReconnecting = false
        state.streamPulse += 1
      }
    },
    getReplyablePendingWait,
    getStateSnapshot() {
      return {
        activeAgentId: preferencesState.activeAgentId,
        activeAgentName: preferencesState.activeAgentName,
        activeEditDraft: cloneMessageEditDraft(state.messageEditDraft),
        activeEditMessageId: state.messageEditDraft?.messageId ?? null,
        chatModel: preferencesState.chatModel,
        chatReasoningMode: preferencesState.chatReasoningMode,
        isLoading: state.isLoading,
        isStreaming: state.isStreaming,
        isWaiting: state.isWaiting,
        modelsCatalog: preferencesState.modelsCatalog,
        runStatus: state.runStatus,
        targetMode: preferencesState.targetMode,
        threadId: state.threadId,
      }
    },
    isSubmitLeaseCurrent,
    logSubmitStart(input) {
      logChatDebug('store', 'submit:start', input)
    },
    nowIso,
    prepareSubmitLifecycle: submitLifecycle.prepare,
    recoverSubmitFailure: submitBranches.recoverFailure,
    releaseSubmitLease,
    replyToPendingWait: submitBranches.replyToPendingWait,
    rerunEditedMessage: submitBranches.rerunEditedMessage,
    setError(message) {
      state.error = message
    },
    shouldTreatRunStatusAsTerminal: isTerminalRunStatus,
    startInExistingThread: submitBranches.startInExistingThread,
    startInNewThread: submitBranches.startInNewThread,
    submitFinalizeSuccess: submitBranches.finalizeSuccess,
  })

  const threadSessionLoader = createThreadSessionLoader<
    ViewLease,
    RunLease,
    ContextBudget,
    UiMessage
  >({
    applyThreadTitle,
    bindActiveRun,
    bootstrapActiveRunTranscriptFromBackend,
    captureRunLease,
    ensureThreadEventStream,
    getIsWaiting() {
      return state.isWaiting
    },
    getLocalAttachments,
    getRun: getRunImpl,
    getRunStatus() {
      return state.runStatus
    },
    getThreadBudget: (threadId) => getThreadBudgetImpl(threadId).catch(() => null),
    isTerminalRunStatus,
    isThreadLeaseCurrent,
    listThreadMessages: listThreadMessagesImpl,
    mapThreadMessage: (message, attachments) =>
      threadMessageMapper.toUiMessage(message, attachments),
    persistState,
    refreshThreadMessages,
    releaseLiveAssistantAfterTerminal,
    replaceDurableMessages,
    resolveHydratedRun,
    setContextBudget(budget) {
      state.contextBudget = budget
    },
    setError(message) {
      state.error = message
    },
    setEventCursorForThread(threadId) {
      state.eventCursor = resolveThreadEventCursor(threadId)
    },
    setSessionId(sessionId) {
      state.sessionId = sessionId
    },
    setThreadId(threadId) {
      state.threadId = threadId
    },
    setThreadNaming(isThreadNaming) {
      state.isThreadNaming = isThreadNaming
    },
    syncRunStateFromBackend,
    toContextBudget,
    toDisplayError,
  })

  const runControlCommands = createRunControlCommands<ViewLease, RunLease>({
    abortActiveStream() {
      threadStreamController.abort()
    },
    bumpStreamPulse() {
      state.streamPulse += 1
    },
    cancelRun: cancelRunImpl,
    captureRunLease,
    captureViewLease,
    finalizeRun,
    getRunId() {
      return state.runId
    },
    getRunStatus() {
      return state.runStatus
    },
    getThreadId() {
      return state.threadId
    },
    isTerminalRunStatus,
    isThreadLeaseCurrent,
    isViewLeaseCurrent,
    reconcileRunState,
    refreshThreadMessages,
    setError(message) {
      state.error = message
    },
    setIsCancelling(value) {
      state.isCancelling = value
    },
    toDisplayError,
  })

  const threadTitleCommands = createThreadTitleCommands<ViewLease>({
    applyThreadTitle,
    captureViewLease,
    ensureThreadEventStream,
    getThreadId() {
      return state.threadId
    },
    isBusy() {
      return state.isLoading || state.isStreaming || state.isCancelling || state.isWaiting
    },
    isThreadLeaseCurrent,
    isThreadNaming() {
      return state.isThreadNaming
    },
    persistState,
    regenerateThreadTitle: regenerateThreadTitleImpl,
    renameThread: renameThreadImpl,
    setError(message) {
      state.error = message
    },
    setStreamPulse() {
      state.streamPulse += 1
    },
    setThreadNaming(value) {
      state.isThreadNaming = value
    },
    toDisplayError,
  })

  const resolveBranchSourceMessageId = (messageId: MessageId | string): MessageId | null => {
    if (
      !state.threadId ||
      state.isLoading ||
      state.isStreaming ||
      state.isCancelling ||
      state.isWaiting
    ) {
      return null
    }

    const targetMessageId = asMessageId(String(messageId))
    const index = messageIndexById.get(targetMessageId)

    if (index === undefined) {
      return null
    }

    const message = messages[index]

    if (
      message.role !== 'assistant' ||
      message.sequence === null ||
      message.status !== 'complete'
    ) {
      return null
    }

    return targetMessageId
  }

  const messageEditCommands = createMessageEditCommands({
    cloneAttachments,
    findMessage(messageId) {
      const index = messageIndexById.get(messageId)
      return index === undefined ? null : (messages[index] ?? null)
    },
    getEditDraft() {
      return cloneMessageEditDraft(state.messageEditDraft)
    },
    isBusy() {
      return state.isLoading || state.isStreaming || state.isCancelling || state.isWaiting
    },
    randomUUID,
    setError(message) {
      state.error = message
    },
    setLocalAttachments,
    setMessageEditDraft(draft) {
      state.messageEditDraft = draft
    },
    syncMessageAttachments(messageId) {
      const index = messageIndexById.get(messageId)
      if (index === undefined) {
        return
      }

      messages = messages.map((message, messageIndex) =>
        messageIndex === index
          ? { ...message, attachments: getLocalAttachments(messageId) }
          : message,
      )
      syncProjectedMessages({ pulse: true })
    },
  })

  const threadSessionCommands = createThreadSessionCommands<ViewLease>({
    beginViewLease,
    branchThread: branchThreadImpl,
    bumpStreamPulse() {
      state.streamPulse += 1
    },
    captureViewLease,
    clearContextBudget() {
      state.contextBudget = null
    },
    clearPersistedState,
    clearTargetSelectionState: preferencesState.clearTargetSelectionState,
    deleteThread: deleteThreadImpl,
    getThreadId() {
      return state.threadId
    },
    hydrateThreadRunFromRootJob: threadSessionLoader.hydrateThreadRunFromRootJob,
    isThreadLeaseCurrent,
    isViewLeaseCurrent,
    loadThread: threadSessionLoader.loadThread,
    refreshThreadBudget: (threadId, lease) => refreshThreadBudget(threadId, lease),
    refreshThreadMessages,
    resetState,
    resolveBranchSourceMessageId,
    setError(message) {
      state.error = message
    },
    setIsLoading(value) {
      state.isLoading = value
    },
    stopActiveStream,
    toDisplayError,
  })

  const persistedThreadHydrator = createPersistedThreadHydrator<
    ViewLease,
    RunLease,
    PersistedChatState
  >({
    applyPersistedStateSnapshot: persistedSnapshotHandler.applyPersistedStateSnapshot,
    awaitStreamOutcome,
    bindActiveRun,
    bootstrapActiveRunTranscriptFromBackend,
    captureRunLease,
    connectThreadEventStream,
    ensurePendingWaitBlocks,
    ensureRunTranscript,
    finalizeRun,
    finishReasonForRunStatus,
    getIsWaiting() {
      return state.isWaiting
    },
    getPersistedRunTranscript(persistedState) {
      return persistedState?.activeRunTranscript ?? null
    },
    getRun: getRunImpl,
    getRunId() {
      return state.runId
    },
    getRunStatus() {
      return state.runStatus
    },
    getThread: getThreadImpl,
    getThreadId() {
      return state.threadId
    },
    hydrateAssistantTranscriptFromRunSnapshot,
    hydratePendingWaitState,
    isTerminalRunStatus,
    isThreadLeaseCurrent,
    isViewLeaseCurrent,
    loadThread: threadSessionLoader.loadThread,
    primeRunReplayGuardFromSnapshot,
    readPersistedState: () => persistence.readState(),
    refreshThreadMessages,
    releaseLiveAssistantAfterTerminal,
    resetRunState,
    resetState,
    resolveHydratedRun,
    resolveTranscriptProjectionMessageId,
    restorePersistedRunTranscript,
    scheduleRunReconciliation,
    setError(message) {
      state.error = message
    },
    setIsStreaming(value) {
      state.isStreaming = value
    },
    setIsWaiting(value) {
      state.isWaiting = value
    },
    setRunStatus(status) {
      state.runStatus = status
    },
    stopActiveStream,
    syncLiveAssistantProjectionFromTranscript,
    toDisplayError,
  })

  const contextWindow = $derived.by(() => {
    if (state.contextBudget?.contextWindow) {
      return state.contextBudget.contextWindow
    }

    return preferencesState.contextWindow
  })

  const canCancel = $derived(
    state.runStatus === 'pending' || state.runStatus === 'running' || state.runStatus === 'waiting',
  )

  const canReplyToPendingWait = $derived(runWaits.getReplyablePendingWait() !== null)

  const pendingToolConfirmation = $derived.by(
    () =>
      runWaits.pending.find(
        (wait) => isConfirmationPendingWait(wait) && !runWaits.hasResolving(wait.waitId),
      ) ?? null,
  )

  const exposedMessages = $derived.by(() => [...messages] as readonly Readonly<UiMessage>[])
  const exposedPendingToolConfirmation = $derived.by(() =>
    pendingToolConfirmation
      ? (runWaits.clonePendingWait(pendingToolConfirmation) as Readonly<BackendPendingWait>)
      : null,
  )
  const exposedResolvingWaitIds = $derived.by(
    () => new Set(runWaits.resolvingIds) as ReadonlySet<string>,
  )
  const exposedWaitIds = $derived([...runWaits.waitIds] as readonly string[])

  const clearError = () => {
    state.error = null
  }

  const cancel = async () => {
    if (!state.runId || state.isCancelling) {
      return
    }
    await runControlCommands.cancelActiveRun()
  }

  const hydrate = async (_historyCount = 0) => {
    const viewLease = beginViewLease()
    state.isLoading = true
    state.error = null

    void preferencesState.refreshAvailableModels(viewLease).catch(() => undefined)
    void preferencesState.refreshAccountPreferences(viewLease).catch(() => {
      if (isViewLeaseCurrent(viewLease)) {
        preferencesState.clearDefaultTargetState()
      }
    })

    try {
      await persistedThreadHydrator.hydrate(viewLease)
    } finally {
      if (isViewLeaseCurrent(viewLease)) {
        state.isLoading = false
        state.streamPulse += 1
      }
    }
  }

  const refreshAccountPreferences = async () => {
    try {
      await preferencesState.refreshAccountPreferences(captureViewLease())
    } catch {
      preferencesState.clearDefaultTargetState()
    }
  }

  const setTargetAgent = (input: { agentId: string; agentName?: string | null }) => {
    state.error = null
    preferencesState.setTargetAgent(input)
  }

  const setTargetMode = (mode: ConversationTargetMode) => {
    state.error = null
    preferencesState.setTargetMode(mode)
  }

  const submit = (
    prompt: string,
    attachments: MessageAttachment[] = [],
    referencedFileIds: string[] = [],
    agentSelection?: SubmitAgentSelection,
  ): Promise<boolean> =>
    submitCommand.submit(prompt, attachments, referencedFileIds, agentSelection)

  return createChatStoreFacade({
    getActiveAgentId: () => preferencesState.activeAgentId,
    getActiveAgentName: () => preferencesState.activeAgentName,
    getAvailableModels: () => preferencesState.availableModels,
    getAvailableReasoningModes: () => preferencesState.availableReasoningModes,
    getCanCancel: () => canCancel,
    getCanReplyToPendingWait: () => canReplyToPendingWait,
    getChatModel: () => preferencesState.chatModel,
    getChatReasoningMode: () => preferencesState.chatReasoningMode,
    getContextBudget: () => state.contextBudget,
    getContextWindow: () => contextWindow,
    getCurrentThreadTitle: () => state.threadTitle,
    getDefaultTarget: () => preferencesState.defaultTarget,
    getDefaultTargetAgentName: () => preferencesState.defaultTargetAgentName,
    getError: () => state.error,
    getIsCancelling: () => state.isCancelling,
    getIsLoading: () => state.isLoading,
    getIsReconnecting: () => state.isReconnecting,
    getIsResolvingWait: () => state.isResolvingWait,
    getIsStreaming: () => state.isStreaming,
    getIsThreadNaming: () => state.isThreadNaming,
    getIsWaiting: () => state.isWaiting,
    getMemoryActivity: () => state.memoryActivity,
    getMessageEditDraft: () => cloneMessageEditDraft(state.messageEditDraft),
    getMessages: () => exposedMessages,
    getPendingToolConfirmation: () => exposedPendingToolConfirmation,
    getResolvingWaitIds: () => exposedResolvingWaitIds,
    getRunId: () => state.runId,
    getSessionId: () => state.sessionId,
    getStreamPulse: () => state.streamPulse,
    getTargetMode: () => preferencesState.targetMode,
    getThreadId: () => state.threadId,
    getTitle: () => state.title,
    getWaitIds: () => exposedWaitIds,
    approvePendingWait: async (waitId?: string, ownerRunId?: RunId | string) => {
      await pendingWaitCommands.resolveConfirmation({
        mode: 'approve',
        ownerRunId,
        waitId,
      })
    },
    beginMessageEdit: (messageId: MessageId | string) =>
      messageEditCommands.beginMessageEdit(asMessageId(String(messageId))),
    branchFromMessage: (messageId: MessageId | string) =>
      threadSessionCommands.branchFromMessage(messageId),
    cancel,
    cancelMessageEdit: () => {
      messageEditCommands.cancelMessageEdit()
    },
    clearError,
    deleteCurrentThread: () => threadSessionCommands.deleteCurrentThread(),
    dispose: () => {
      runLifecycle?.clearRunReconcileTimer()
      void stopActiveStream().catch(() => undefined)
    },
    hydrate,
    primeFromPersistedState,
    refreshAccountPreferences,
    refreshCurrentThread: () => threadSessionCommands.refreshCurrentThread(),
    regenerateCurrentThreadTitle: () => threadTitleCommands.regenerateCurrentThreadTitle(),
    rejectPendingWait: async (waitId?: string, ownerRunId?: RunId | string) => {
      await pendingWaitCommands.resolveConfirmation({
        mode: 'reject',
        ownerRunId,
        waitId,
      })
    },
    renameCurrentThread: (title: string) =>
      threadTitleCommands.renameCurrentThread(title, state.threadTitle),
    replaceMessageAttachment: (
      messageId: MessageId | string,
      attachmentId: string,
      next: MessageAttachment,
    ) =>
      messageEditCommands.replaceMessageAttachment(
        asMessageId(String(messageId)),
        attachmentId,
        next,
      ),
    reset: (options: { clearTargetSelection?: boolean } = {}) =>
      threadSessionCommands.reset(options),
    setChatModel: (model: ChatModel) => {
      preferencesState.setChatModel(model)
    },
    setChatReasoningMode: (mode: ChatReasoningMode) => {
      preferencesState.setChatReasoningMode(mode)
    },
    setTargetAgent,
    setTargetMode,
    submit,
    switchToThread: (thread: BackendThread) => threadSessionCommands.switchToThread(thread),
    trustPendingWait: async (waitId?: string, ownerRunId?: RunId | string) => {
      await pendingWaitCommands.resolveConfirmation({
        mode: 'trust',
        ownerRunId,
        waitId,
      })
    },
  })
}

export const chatStore = createChatStore()
