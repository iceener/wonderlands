<script lang="ts">
import type { Editor, Range } from '@tiptap/core'
import {
  BACKEND_DEFAULT_MODEL,
  type BackendFilePickerResult,
  INLINE_MESSAGE_TEXT_LIMIT,
  type MessageAttachment,
} from '@wonderlands/contracts/chat'
import { onDestroy, tick } from 'svelte'
import {
  ATTACHMENT_ACCEPT_HINT,
  collectTransferFiles,
  hasTransferFiles,
} from '../../attachments/intake'
import { createAgentProvider } from '../../command-palette/agent-provider.svelte'
import { getPaletteStoreContext } from '../../command-palette/palette-store.svelte'
import { searchCommands } from '../../command-palette/search'
import type { CommandItem, PaletteProvider } from '../../command-palette/types'
import { getAppCommandsContext } from '../../commands/app-commands'
import {
  appendLargeTextPasteHiddenMetadata,
  createLargeTextPasteAttachment,
} from '../../prompt-editor/large-paste'
import { validateModelVisibleImageMarkdown } from '../../prompt-editor/markdown'
import { createSuggestionTrigger, exitSuggestion } from '../../prompt-editor/suggestion-trigger'
import TiptapPromptEditor from '../../prompt-editor/TiptapPromptEditor.svelte'
import type { LargeTextPastePayload, PromptEditorHandle } from '../../prompt-editor/types'
import { listAgents } from '../../services/api'
import { uploadAttachment } from '../../services/attachment-api'
import { toApiUrl } from '../../services/backend'
import { searchFilePicker } from '../../services/file-picker-api'
import { chatStore } from '../../stores/chat-store.svelte'
import { createComposerAttachmentStore } from '../../stores/composer-attachments.svelte'
import { getMessageNavigatorContext } from '../../stores/message-navigator.svelte'
import { typewriter } from '../../stores/typewriter.svelte'
import { typewriterPlayback } from '../../stores/typewriter-playback.svelte'
import AttachmentTray from './AttachmentTray.svelte'
import ContextBar from './ContextBar.svelte'
import FilePickerPopover from './FilePickerPopover.svelte'

interface Props {
  commandItems?: CommandItem[]
  onPinToBottom?: (() => void) | null
}

let { commandItems = [], onPinToBottom = null }: Props = $props()

const emptyThreadTips = [
  'Type # to attach a file, @ to mention an agent, / for commands',
  'Type / to browse available commands',
  'Use # to search and attach files from your project',
]
const activeThreadTips = [
  'Type # to attach a file, @ to mention an agent, / for commands',
  'Use ↑ to navigate messages, c to copy, esc to dismiss',
  'Type / to browse available commands',
  'Press ↑ in an empty input to browse previous messages',
  'Use # to search and attach files from your project',
]
const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]
let lastHasMessages: boolean | null = null
let placeholderTip = $state(pick(emptyThreadTips))
$effect(() => {
  const hasMessages = chatStore.messages.length > 0
  if (hasMessages !== lastHasMessages) {
    lastHasMessages = hasMessages
    placeholderTip = pick(hasMessages ? activeThreadTips : emptyThreadTips)
  }
})

let prompt = $state('')
let promptEditor: PromptEditorHandle | null = $state(null)
let fileInput: HTMLInputElement | null = $state(null)
let composerValidationError = $state<string | null>(null)
let fileDragDepth = $state(0)
let hydratedEditActivationId = $state<string | null>(null)
let pendingLargeTextPastes = $state<
  Array<{
    characterCount: number
    draftLocalId: string
    fileName: string
  }>
>([])

const appCommands = getAppCommandsContext()
const paletteStore = getPaletteStoreContext()
const messageNavigator = getMessageNavigatorContext()
const composerHintId = 'composer-hint'

const handleEditorKeyDown = (event: KeyboardEvent, cursorAtStart: boolean): boolean => {
  if (messageNavigator.active) {
    switch (event.key) {
      case 'ArrowUp':
        messageNavigator.moveUp(chatStore.messages)
        return true
      case 'ArrowDown':
        messageNavigator.moveDown(chatStore.messages)
        return true
      case 'c':
      case 'C':
        void messageNavigator.copyHighlighted(chatStore.messages)
        return true
      case 'Escape':
        messageNavigator.deactivate()
        return true
      default:
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
          messageNavigator.deactivate()
        }
        return false
    }
  }

  if (event.key === 'ArrowUp' && cursorAtStart && chatStore.messages.length > 0) {
    messageNavigator.activate(chatStore.messages)
    return true
  }

  return false
}

// Slash trigger bridge — connects TipTap suggestion to palette store
let activeRange: Range = { from: 0, to: 0 }
let activeEditor: Editor | null = null
let filePickerRange: Range = { from: 0, to: 0 }
let filePickerEditor: Editor | null = null
let filePickerQuery = $state('')
let filePickerResults = $state<BackendFilePickerResult[]>([])
let filePickerSelectedIndex = $state(0)
let filePickerLoading = $state(false)
let filePickerError = $state<string | null>(null)
let filePickerDebounceId: ReturnType<typeof setTimeout> | null = null
let filePickerLoadingIndicatorId: ReturnType<typeof setTimeout> | null = null
let filePickerSearchSettled = $state(false)
let filePickerSearchVersion = 0
const FILE_PICKER_DEBOUNCE_MS = 80
const FILE_PICKER_LOADING_DELAY_MS = 150

const clearFilePickerDebounce = () => {
  if (!filePickerDebounceId) {
    return
  }

  clearTimeout(filePickerDebounceId)
  filePickerDebounceId = null
}

const clearFilePickerLoadingIndicator = () => {
  if (!filePickerLoadingIndicatorId) {
    return
  }

  clearTimeout(filePickerLoadingIndicatorId)
  filePickerLoadingIndicatorId = null
}

const closeFilePicker = (shouldExitSuggestion = false) => {
  clearFilePickerDebounce()
  clearFilePickerLoadingIndicator()
  filePickerSearchVersion += 1
  filePickerQuery = ''
  filePickerResults = []
  filePickerSelectedIndex = 0
  filePickerLoading = false
  filePickerError = null
  filePickerSearchSettled = false

  const editor = filePickerEditor
  filePickerEditor = null

  if (shouldExitSuggestion && editor?.view) {
    exitSuggestion(editor.view)
  }
}

const scheduleFilePickerSearch = (query: string) => {
  clearFilePickerDebounce()
  clearFilePickerLoadingIndicator()
  filePickerQuery = query
  filePickerSelectedIndex = 0
  filePickerLoading = false
  filePickerError = null

  const requestVersion = ++filePickerSearchVersion
  filePickerDebounceId = setTimeout(() => {
    filePickerDebounceId = null
    filePickerLoadingIndicatorId = setTimeout(() => {
      if (requestVersion !== filePickerSearchVersion) {
        return
      }

      filePickerLoading = true
    }, FILE_PICKER_LOADING_DELAY_MS)

    void searchFilePicker(query, {
      limit: 30,
      sessionId: chatStore.sessionId,
    })
      .then((results) => {
        if (requestVersion !== filePickerSearchVersion) {
          return
        }

        filePickerResults = results
        filePickerSelectedIndex = 0
      })
      .catch((error: unknown) => {
        if (requestVersion !== filePickerSearchVersion) {
          return
        }

        filePickerResults = []
        filePickerError =
          error instanceof Error ? error.message : 'Failed to search workspace files.'
      })
      .finally(() => {
        if (requestVersion !== filePickerSearchVersion) {
          return
        }

        clearFilePickerLoadingIndicator()
        filePickerLoading = false
        filePickerSearchSettled = true
      })
  }, FILE_PICKER_DEBOUNCE_MS)
}

const filePickerShouldShowEmptyState = $derived(
  filePickerSearchSettled && filePickerResults.length === 0 && !filePickerError,
)

const filePickerIsOpen = $derived(
  filePickerLoading ||
    filePickerResults.length > 0 ||
    !!filePickerError ||
    filePickerShouldShowEmptyState,
)

const moveFilePickerSelection = (delta: number) => {
  const count = filePickerResults.length
  if (count === 0) {
    return
  }

  filePickerSelectedIndex = (filePickerSelectedIndex + delta + count) % count
}

const toPickedImageAttachment = (result: BackendFilePickerResult): MessageAttachment | null => {
  if (result.source !== 'attachment' || !result.fileId || !result.mimeType?.startsWith('image/')) {
    return null
  }

  const contentUrl = toApiUrl(`/files/${result.fileId}/content`)

  return {
    id: result.fileId,
    kind: 'image',
    mime: result.mimeType,
    name: result.label,
    size: result.sizeBytes ?? 0,
    thumbnailUrl: contentUrl,
    url: contentUrl,
  }
}

const selectFilePickerResult = (result: BackendFilePickerResult) => {
  const editor = filePickerEditor

  if (!editor) {
    return
  }

  const pickedImageAttachment = toPickedImageAttachment(result)

  if (pickedImageAttachment) {
    editor.chain().deleteRange(filePickerRange).focus().run()
    composerValidationError = null
    composerAttachments.addUploadedAttachments([pickedImageAttachment])
    closeFilePicker(false)
    if (editor.view) {
      exitSuggestion(editor.view)
    }
    return
  }

  const content = [
    {
      type: 'fileMention',
      attrs: {
        fileId: result.fileId,
        label: result.label,
        relativePath: result.source === 'workspace' ? result.relativePath : null,
        source: result.source,
      },
    },
    {
      type: 'text',
      text: ' ',
    },
  ]

  editor.commands.insertContentAt(filePickerRange, content, {
    errorOnInvalidContent: false,
    updateSelection: true,
  })
  editor.commands.focus()
  closeFilePicker(false)
  if (editor.view) {
    exitSuggestion(editor.view)
  }
}

const slashProvider: PaletteProvider = {
  id: 'slash',
  mode: 'mention',
  getItems: (query) => searchCommands(query, commandItems),
  onSelect: (item) => {
    activeEditor?.chain().deleteRange(activeRange).run()
    void item.run()
  },
  onDismiss: () => {
    if (activeEditor?.view) {
      exitSuggestion(activeEditor.view)
    }
  },
}

const slashTrigger = createSuggestionTrigger({
  name: 'slash-commands',
  char: '/',
  callbacks: {
    onActivate: ({ query, range, editor }) => {
      closeFilePicker(false)
      activeRange = range
      activeEditor = editor
      paletteStore.openWith(slashProvider)
      paletteStore.setQuery(query)
    },
    onUpdate: ({ query, range }) => {
      activeRange = range
      paletteStore.setQuery(query)
    },
    onDeactivate: () => {
      paletteStore.close()
      activeEditor = null
    },
    onKeyDown: ({ event }) => {
      if (!paletteStore.isOpen) return false

      switch (event.key) {
        case 'ArrowDown':
          paletteStore.moveSelection(1)
          return true
        case 'ArrowUp':
          paletteStore.moveSelection(-1)
          return true
        case 'Enter':
          paletteStore.executeSelected()
          return true
        case 'Escape':
          paletteStore.close()
          return true
        default:
          return false
      }
    },
  },
})

const agentProvider = createAgentProvider({
  listAgents,
  onSelectAgent: async (agent) => {
    if (!activeEditor) {
      return
    }

    activeEditor.commands.insertContentAt(
      activeRange,
      [
        {
          type: 'agentMention',
          attrs: {
            agentId: agent.id,
            label: agent.name,
            slug: agent.slug,
          },
        },
        {
          type: 'text',
          text: ' ',
        },
      ],
      {
        errorOnInvalidContent: false,
        updateSelection: true,
      },
    )
    activeEditor.commands.focus()

    if (activeEditor.view) {
      exitSuggestion(activeEditor.view)
    }
  },
})

const conversationTargetAgentProvider: PaletteProvider = {
  ...createAgentProvider({
    listAgents,
    onSelectAgent: async (agent) => {
      chatStore.setTargetAgent({
        agentId: agent.id,
        agentName: agent.name,
      })
      await focusComposer()
    },
  }),
  id: 'conversation-target-agents',
  mode: 'conversation',
}

const agentTrigger = createSuggestionTrigger({
  name: 'agent-mentions',
  char: '@',
  callbacks: {
    onActivate: ({ query, range, editor }) => {
      closeFilePicker(false)
      activeRange = range
      activeEditor = editor
      paletteStore.openWith(agentProvider)
      paletteStore.setQuery(query)
    },
    onUpdate: ({ query, range, editor }) => {
      activeRange = range
      activeEditor = editor
      paletteStore.setQuery(query)
    },
    onDeactivate: () => {
      paletteStore.close()
      activeEditor = null
    },
    onKeyDown: ({ event }) => {
      if (!paletteStore.isOpen) return false

      switch (event.key) {
        case 'ArrowDown':
          paletteStore.moveSelection(1)
          return true
        case 'ArrowUp':
          paletteStore.moveSelection(-1)
          return true
        case 'Enter':
          paletteStore.executeSelected()
          return true
        case 'Escape':
          paletteStore.close()
          return true
        default:
          return false
      }
    },
  },
})

const fileTrigger = createSuggestionTrigger({
  name: 'hash-files',
  char: '#',
  callbacks: {
    onActivate: ({ query, range, editor }) => {
      filePickerRange = range
      filePickerEditor = editor
      paletteStore.close()

      scheduleFilePickerSearch(query)
    },
    onUpdate: ({ query, range, editor }) => {
      filePickerRange = range
      filePickerEditor = editor

      scheduleFilePickerSearch(query)
    },
    onDeactivate: () => {
      closeFilePicker(false)
    },
    onKeyDown: ({ event }) => {
      if (!filePickerEditor) {
        return false
      }

      switch (event.key) {
        case 'ArrowDown':
          if (filePickerResults.length === 0) {
            return false
          }
          moveFilePickerSelection(1)
          return true
        case 'ArrowUp':
          if (filePickerResults.length === 0) {
            return false
          }
          moveFilePickerSelection(-1)
          return true
        case 'Enter': {
          const selected = filePickerResults[filePickerSelectedIndex]
          if (!selected) {
            return false
          }
          selectFilePickerResult(selected)
          return true
        }
        case 'Escape':
          closeFilePicker(true)
          return true
        default:
          return false
      }
    },
  },
})
const composerAttachments = createComposerAttachmentStore({
  uploadAttachment: (file) =>
    uploadAttachment(
      file,
      chatStore.sessionId
        ? {
            accessScope: 'session_local',
            sessionId: chatStore.sessionId,
          }
        : {
            accessScope: 'account_library',
          },
    ),
})

onDestroy(() => {
  closeFilePicker(false)
  composerValidationError = null
  composerAttachments.dispose()
})

const unregisterComposerBridge = appCommands.registerComposerBridge({
  focusPrompt: async () => {
    await focusComposer()
  },
  pickAttachments: () => {
    pickFiles()
  },
  resetComposer: () => {
    closeFilePicker(false)
    paletteStore.close()
    promptEditor?.clear()
    prompt = ''
    composerValidationError = null
    hydratedEditActivationId = null
    pendingLargeTextPastes = []
    composerAttachments.reset()
    chatStore.cancelMessageEdit()
  },
})

onDestroy(() => {
  unregisterComposerBridge()
})

const typewriterFinishing = $derived(
  !chatStore.isStreaming && !chatStore.isWaiting && typewriterPlayback.hasPending,
)
const canReplyWhileWaiting = $derived(chatStore.isWaiting && chatStore.canReplyToPendingWait)
const submitButtonState = $derived<'idle' | 'active' | 'cancelling' | 'finishing'>(
  chatStore.isCancelling
    ? 'cancelling'
    : chatStore.isStreaming || (chatStore.canCancel && !canReplyWhileWaiting)
      ? 'active'
      : typewriterFinishing
        ? 'finishing'
        : 'idle',
)
const canStopActiveRun = $derived(submitButtonState === 'active' && chatStore.canCancel)
const composerBusy = $derived(
  chatStore.isLoading ||
    chatStore.isStreaming ||
    chatStore.isCancelling ||
    (chatStore.isWaiting && !canReplyWhileWaiting) ||
    typewriterFinishing,
)
const attachmentBusy = $derived(composerBusy || chatStore.isWaiting)
const canSubmitPrompt = $derived(prompt.trim().length > 0 || pendingLargeTextPastes.length > 0)

const fileDragActive = $derived(fileDragDepth > 0 && !attachmentBusy)

const handleComposerDragEnterCapture = (e: DragEvent) => {
  if (attachmentBusy) {
    fileDragDepth = 0
    return
  }
  if (!hasTransferFiles(e.dataTransfer)) {
    return
  }
  e.preventDefault()
  const current = e.currentTarget as HTMLElement
  const related = e.relatedTarget as Node | null
  if (related && current.contains(related)) {
    return
  }
  fileDragDepth += 1
}

const handleComposerDragOverCapture = (e: DragEvent) => {
  if (attachmentBusy) {
    fileDragDepth = 0
    return
  }
  if (!hasTransferFiles(e.dataTransfer)) {
    return
  }
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
}

const handleComposerDragLeave = (e: DragEvent) => {
  if (attachmentBusy) {
    fileDragDepth = 0
    return
  }
  if (!hasTransferFiles(e.dataTransfer)) {
    return
  }
  const current = e.currentTarget as HTMLElement
  const related = e.relatedTarget as Node | null
  if (related && current.contains(related)) {
    return
  }
  fileDragDepth = Math.max(0, fileDragDepth - 1)
}

const handleComposerDropCapture = (e: DragEvent) => {
  fileDragDepth = 0

  if (attachmentBusy) {
    return
  }

  const files = collectTransferFiles(e.dataTransfer)
  if (files.length === 0) {
    return
  }

  e.preventDefault()
  e.stopPropagation()
  addFilesToComposer(files)
}

const focusComposer = async () => {
  await tick()
  promptEditor?.focus()
}

const resetComposerForDraft = () => {
  closeFilePicker(false)
  paletteStore.close()
  composerValidationError = null
  pendingLargeTextPastes = []
  composerAttachments.reset()
  prompt = ''
  promptEditor?.clear()
}

const addFilesToComposer = (files: File[]) => {
  if (files.length === 0) {
    return
  }

  composerValidationError = null
  composerAttachments.addFiles(files)
  onPinToBottom?.()
}

const removePendingLargeTextPaste = (localId: string) => {
  pendingLargeTextPastes = pendingLargeTextPastes.filter((entry) => entry.draftLocalId !== localId)
}

const handleLargeTextPaste = ({ format, text }: LargeTextPastePayload) => {
  const attachment = createLargeTextPasteAttachment(text, { format })

  composerValidationError = null
  const drafts = composerAttachments.addFiles([attachment.file])
  const draft = drafts[0]

  if (draft) {
    pendingLargeTextPastes = [
      ...pendingLargeTextPastes.filter((entry) => entry.draftLocalId !== draft.localId),
      {
        characterCount: attachment.characterCount,
        draftLocalId: draft.localId,
        fileName: attachment.fileName,
      },
    ]
  }

  onPinToBottom?.()
}

const pickFiles = () => {
  if (attachmentBusy) {
    return
  }

  fileInput?.click()
}

const handleFileSelection = (event: Event) => {
  const input = event.currentTarget as HTMLInputElement | null
  addFilesToComposer(Array.from(input?.files ?? []))

  if (input) {
    input.value = ''
  }
}

$effect(() => {
  const draft = chatStore.messageEditDraft

  if (!draft) {
    if (!hydratedEditActivationId) {
      return
    }

    hydratedEditActivationId = null
    resetComposerForDraft()
    return
  }

  if (draft.activationId === hydratedEditActivationId) {
    return
  }

  hydratedEditActivationId = draft.activationId
  resetComposerForDraft()
  prompt = draft.text
  if (draft.attachments.length > 0) {
    composerAttachments.addUploadedAttachments(draft.attachments)
  }
  onPinToBottom?.()
  void focusComposer()
})

const submitPrompt = async () => {
  const nextPrompt = promptEditor?.getSubmissionMarkdown() ?? prompt
  const selectedAgent = promptEditor?.getReferencedAgent() ?? null
  const selectedAgentId = selectedAgent?.agentId?.trim() || undefined

  if (nextPrompt.trim().length > INLINE_MESSAGE_TEXT_LIMIT) {
    composerValidationError = `Inline message text exceeds the ${INLINE_MESSAGE_TEXT_LIMIT.toLocaleString()} character limit. Shorten it or paste it as an attachment.`
    return
  }

  const imageValidation = validateModelVisibleImageMarkdown(nextPrompt)
  if (!imageValidation.ok) {
    composerValidationError = imageValidation.error
    return
  }

  const preparedAttachments = composerAttachments.prepareForSubmit()
  if (!preparedAttachments.ok) {
    return
  }

  const isEditing = Boolean(chatStore.messageEditDraft)
  if (
    !nextPrompt.trim() &&
    pendingLargeTextPastes.length === 0 &&
    (!isEditing || preparedAttachments.attachments.length === 0)
  ) {
    return
  }

  const largeTextPasteEntries = pendingLargeTextPastes.flatMap((entry) => {
    const attachment = preparedAttachments.attachments.find(
      (candidate) => candidate.name === entry.fileName,
    )

    if (!attachment) {
      return []
    }

    return [
      {
        characterCount: entry.characterCount,
        fileId: attachment.id,
        fileName: attachment.name,
      },
    ]
  })
  const submittedPrompt = appendLargeTextPasteHiddenMetadata(nextPrompt, largeTextPasteEntries)
  if (!submittedPrompt.trim() && (!isEditing || preparedAttachments.attachments.length === 0)) {
    composerValidationError = 'Message is empty.'
    return
  }

  const referencedFileIds = promptEditor?.getReferencedFileIds() ?? []
  const promptToRestore = prompt
  const attachmentsToRestore = preparedAttachments.attachments.map((attachment) => ({
    ...attachment,
  }))
  const pendingLargeTextPastesToRestore = pendingLargeTextPastes.map((entry) => ({ ...entry }))

  composerValidationError = null
  promptEditor?.clear()
  prompt = ''
  pendingLargeTextPastes = []
  onPinToBottom?.()

  const submitPromise = chatStore.submit(
    submittedPrompt,
    preparedAttachments.attachments,
    referencedFileIds,
    selectedAgentId
      ? {
          agentId: selectedAgentId,
          agentName: selectedAgent?.label?.trim() || selectedAgent?.slug || selectedAgentId,
        }
      : undefined,
  )
  const submitSucceeded = await submitPromise
  if (!submitSucceeded) {
    prompt = promptToRestore
    pendingLargeTextPastes = pendingLargeTextPastesToRestore
    composerAttachments.addUploadedAttachments(attachmentsToRestore)
  }
  await focusComposer()
}

const composerDescription = composerHintId
const activeMessageEdit = $derived(chatStore.messageEditDraft)

$effect(() => {
  if (!chatStore.isLoading && promptEditor) {
    void focusComposer()
  }
})

const lastAssistantHasError = $derived.by(() => {
  const lastMessage = chatStore.messages.at(-1)
  return lastMessage?.role === 'assistant' ? lastMessage.status === 'error' : false
})

const composerError = $derived(
  composerValidationError ??
    composerAttachments.error ??
    (lastAssistantHasError ? null : chatStore.error),
)
const composerErrorDismissable = $derived(!composerValidationError && !!composerError)
const activeModelLabel = $derived(
  chatStore.chatModel === BACKEND_DEFAULT_MODEL ? 'default' : chatStore.chatModel,
)
const defaultTargetLabel = $derived.by(() => {
  const defaultTarget = chatStore.defaultTarget

  if (!defaultTarget) {
    return 'Loading…'
  }

  if (defaultTarget.kind === 'assistant') {
    return 'Assistant'
  }

  return chatStore.defaultTargetAgentName?.trim() || 'Agent'
})
const currentTargetLabel = $derived.by(() => {
  if (chatStore.targetMode === 'assistant') {
    return 'Assistant'
  }

  if (chatStore.targetMode === 'agent') {
    return chatStore.activeAgentName?.trim() || 'Choose agent'
  }

  return `Default: ${defaultTargetLabel}`
})
const activeReasoningLabel = $derived.by(
  () =>
    chatStore.availableReasoningModes
      .find((mode) => mode.id === chatStore.chatReasoningMode)
      ?.label.toLowerCase() ?? 'default',
)

const openConversationTargetAgentPicker = () => {
  closeFilePicker(false)
  paletteStore.openWith(conversationTargetAgentProvider)
}

let cachedAgentList = $state<Array<{ id: string; name: string }>>([])
let isCyclingAgents = false

const loadAgentsForCycle = async () => {
  if (cachedAgentList.length > 0) return
  try {
    const agents = await listAgents({ limit: 50 })
    cachedAgentList = agents.map((a) => ({ id: a.id, name: a.name }))
  } catch {
    /* ignore */
  }
}

const cycleTarget = async () => {
  await loadAgentsForCycle()

  // Build cycle: Main → Agent1 → Agent2 → ... → Main
  const cycle: Array<{ mode: 'default' } | { mode: 'agent'; id: string; name: string }> = [
    { mode: 'default' },
    ...cachedAgentList.map((a) => ({ mode: 'agent' as const, id: a.id, name: a.name })),
  ]

  if (cycle.length <= 1) {
    // No agents — stay on Main
    chatStore.setTargetMode('default')
    return
  }

  // Find current position
  let currentIndex = 0
  if (chatStore.targetMode === 'agent' && chatStore.activeAgentId) {
    const agentIndex = cycle.findIndex(
      (e) => e.mode === 'agent' && 'id' in e && e.id === chatStore.activeAgentId,
    )
    if (agentIndex >= 0) currentIndex = agentIndex
  }

  // Advance
  const next = cycle[(currentIndex + 1) % cycle.length]
  if (next.mode === 'default') {
    chatStore.setTargetMode('default')
  } else {
    chatStore.setTargetAgent({ agentId: next.id, agentName: next.name })
  }

  void focusComposer()
}

const targetCycleLabel = $derived.by(() => {
  if (chatStore.targetMode === 'agent' && chatStore.activeAgentName?.trim()) {
    return chatStore.activeAgentName.trim()
  }
  return 'Main'
})

$effect(() => {
  if (!chatStore.error) return
  const id = setTimeout(() => {
    chatStore.clearError()
  }, 10_000)
  return () => clearTimeout(id)
})
</script>

<div class="shrink-0 border-border">
  <form
    class="relative mx-auto px-4.5 py-3"
    style="max-width: var(--chat-max-w, 42rem)"
    onsubmit={(event: SubmitEvent) => {
      event.preventDefault()
      void submitPrompt()
    }}
  >
    {#if activeMessageEdit}
      <div class="mb-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2">
        <p class="min-w-0 text-[13px] leading-snug text-text-secondary">
          Editing a previous message. Sending replaces that turn and truncates later history before rerunning from it.
        </p>
        <button
          type="button"
          class="shrink-0 rounded border border-border bg-surface-0 px-2 py-0.5 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
          disabled={composerBusy}
          onclick={() => {
            chatStore.cancelMessageEdit()
            void focusComposer()
          }}
        >
          Cancel edit
        </button>
      </div>
    {/if}

    {#if composerError}
      <div class="mb-2 flex items-start gap-2 rounded-lg border border-danger/15 bg-danger-soft px-3 py-2.5" role="status">
        <p class="min-w-0 flex-1 text-[13px] leading-snug text-danger-text">{composerError}</p>
        {#if composerErrorDismissable}
          <button
            type="button"
            class="mt-0.5 shrink-0 rounded p-0.5 text-danger-text/40 transition-colors hover:bg-danger/10 hover:text-danger-text"
            aria-label="Dismiss error"
            onclick={() => {
              composerAttachments.clearError()
              chatStore.clearError()
            }}
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l8 8"/><path d="M12 4 4 12"/></svg>
          </button>
        {/if}
      </div>
    {/if}

    <input
      bind:this={fileInput}
      type="file"
      class="hidden"
      accept={ATTACHMENT_ACCEPT_HINT}
      multiple
      onchange={handleFileSelection}
    />

    <div
      class="relative"
      role="presentation"
      ondragentercapture={handleComposerDragEnterCapture}
      ondragovercapture={handleComposerDragOverCapture}
      ondragleave={handleComposerDragLeave}
      ondropcapture={handleComposerDropCapture}
    >
      <AttachmentTray
        drafts={composerAttachments.drafts}
        disabled={attachmentBusy}
        onRemove={(localId) => {
          composerValidationError = null
          removePendingLargeTextPaste(localId)
          composerAttachments.removeDraft(localId)
        }}
        onReplaceDraftFile={(localId, file) => {
          composerAttachments.replaceDraftFile(localId, file)
        }}
      />

      <div class="flex items-end gap-2">
        <div class="relative min-w-0 flex-1">
          <FilePickerPopover
            isOpen={filePickerIsOpen}
            query={filePickerQuery}
            results={filePickerResults}
            selectedIndex={filePickerSelectedIndex}
            loading={filePickerLoading}
            error={filePickerError}
            onClose={() => {
              closeFilePicker(true)
              void focusComposer()
            }}
            onHighlight={(index) => {
              filePickerSelectedIndex = index
            }}
            onSelect={(result) => {
              selectFilePickerResult(result)
            }}
          />
          <TiptapPromptEditor
            bind:this={promptEditor}
            value={prompt}
            placeholder={placeholderTip}
            disabled={chatStore.isLoading}
            ariaDescribedBy={composerDescription}
            triggers={[slashTrigger, fileTrigger, agentTrigger]}
            onEditorKeyDown={handleEditorKeyDown}
            onMarkdownChange={(markdown) => {
              prompt = markdown
              composerValidationError = null
            }}
            onPasteFiles={(files) => {
              addFilesToComposer(files)
            }}
            onLargeTextPaste={(payload) => {
              handleLargeTextPaste(payload)
            }}
            onSubmitShortcut={() => {
              if (canSubmitPrompt && !composerBusy) {
                void submitPrompt()
              }
            }}
            shouldSuppressSubmitShortcut={() => chatStore.pendingToolConfirmation !== null}
          />
        </div>

        <button
          type={
            chatStore.isStreaming || (chatStore.isWaiting && !canReplyWhileWaiting) || typewriterFinishing
              ? 'button'
              : 'submit'
          }
          disabled={
            (chatStore.isLoading && !canStopActiveRun) ||
            chatStore.isCancelling ||
            typewriterFinishing ||
            (
              submitButtonState !== 'active' &&
              !canSubmitPrompt
            )
          }
          aria-label={
            submitButtonState === 'cancelling'
              ? 'Cancelling'
              : submitButtonState === 'active'
                ? 'Stop'
                : submitButtonState === 'finishing'
                  ? 'Finishing response'
                  : 'Send message'
          }
          onclick={() => {
            if (submitButtonState === 'active' && chatStore.canCancel) {
              void chatStore.cancel()
            }
          }}
          class="sd-submit-btn group grid h-[42px] shrink-0 place-items-center self-end overflow-hidden rounded bg-text-primary text-[13px] font-semibold text-bg shadow-[0_1px_2px_rgba(0,0,0,0.25)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong disabled:cursor-not-allowed disabled:shadow-none"
          data-state={submitButtonState}
        >
          <span class="sd-submit-face" class:sd-submit-active={submitButtonState === 'idle'}>Send</span>
          <span class="sd-submit-face" class:sd-submit-active={submitButtonState === 'active'}>Stop</span>
          <span class="sd-submit-face" class:sd-submit-active={submitButtonState === 'cancelling'}>Stopping&#8230;</span>
          <span class="sd-submit-face" class:sd-submit-active={submitButtonState === 'finishing'}>Finishing&#8230;</span>
        </button>
      </div>

      <div class="mt-1.5 flex items-center justify-between gap-3">
        <!-- Left: context items -->
        <div class="flex min-w-0 items-center gap-2 text-[11px]">
          <button
            type="button"
            class="text-text-tertiary transition-colors hover:text-text-secondary focus-visible:text-text-secondary focus-visible:outline-none disabled:opacity-40"
            onclick={() => {
              void appCommands.newConversation()
            }}
            disabled={!appCommands.canStartNewConversation()}
          >
            New thread
          </button>

          <span class="text-text-tertiary/40">|</span>

          <button
            type="button"
            disabled={false}
            class="text-text-tertiary transition-colors hover:text-text-secondary focus-visible:text-text-secondary focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none"
            title="Click to cycle target"
            onclick={() => { void cycleTarget() }}
          >
            {targetCycleLabel}
          </button>

          <button
            type="button"
            disabled={!appCommands.canCycleModel()}
            onclick={() => { appCommands.cycleModel() }}
            class="text-text-tertiary transition-colors hover:text-text-secondary focus-visible:text-text-secondary focus-visible:outline-none disabled:opacity-40"
            title={`Model: ${activeModelLabel}`}
          >
            {activeModelLabel}
          </button>

          <button
            type="button"
            disabled={!appCommands.canCycleReasoning()}
            onclick={() => { appCommands.cycleReasoning() }}
            class="text-text-tertiary transition-colors hover:text-text-secondary focus-visible:text-text-secondary focus-visible:outline-none disabled:opacity-40"
            title={`Reasoning: ${activeReasoningLabel}`}
          >
            {activeReasoningLabel}
          </button>

          <button
            type="button"
            onclick={() => { appCommands.cycleTypewriter() }}
            class="text-text-tertiary transition-colors hover:text-text-secondary focus-visible:text-text-secondary focus-visible:outline-none"
            title={`Typewriter speed: ${typewriter.speed}`}
          >
            {typewriter.speed}
          </button>

        </div>

        <div class="flex items-center gap-2">
          <ContextBar />
          <span
            id={composerHintId}
            class="sr-only max-w-48 shrink-0 text-right text-[11px] text-text-tertiary sm:block"
          >
            {chatStore.isReconnecting ? 'Reconnecting…' : '⌘↵ to send'}
          </span>
        </div>
      </div>

      {#if fileDragActive}
        <div
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-border-strong bg-surface-0/85 backdrop-blur-[2px]"
          aria-hidden="true"
        >
          <span class="text-[13px] font-medium text-text-secondary">Drop files here</span>
        </div>
      {/if}
    </div>
  </form>
</div>

<style>
  /* ── Button shell ── */
  .sd-submit-btn {
    --_pad: 20px;
    padding-left: var(--_pad);
    padding-right: var(--_pad);
    transition:
      padding 320ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 220ms ease,
      box-shadow 220ms ease,
      transform 140ms ease;
  }

  /* Idle hover / press */
  .sd-submit-btn[data-state="idle"]:not(:disabled):hover {
    opacity: 0.88;
  }
  .sd-submit-btn[data-state="idle"]:not(:disabled):active {
    transform: scale(0.96);
  }

  /* Active (Stop) hover / press */
  .sd-submit-btn[data-state="active"]:not(:disabled):hover {
    opacity: 0.88;
  }
  .sd-submit-btn[data-state="active"]:not(:disabled):active {
    transform: scale(0.97);
  }

  /* Disabled fade */
  .sd-submit-btn:disabled {
    opacity: 0.3;
  }

  /* ── Face layers (stacked in the same grid cell) ── */
  .sd-submit-face {
    grid-column: 1;
    grid-row: 1;
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 140ms ease;
  }

  .sd-submit-face.sd-submit-active {
    opacity: 1;
    pointer-events: auto;
  }

  /* ── Background pulse for busy states ── */
  .sd-submit-btn[data-state="active"],
  .sd-submit-btn[data-state="cancelling"],
  .sd-submit-btn[data-state="finishing"] {
    animation: sd-bg-breathe 2s ease-in-out infinite;
  }

  @keyframes sd-bg-breathe {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.7; }
  }
</style>
