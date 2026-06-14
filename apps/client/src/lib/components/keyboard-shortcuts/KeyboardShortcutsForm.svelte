<script lang="ts">
import type { ShortcutBindings } from '@wonderlands/contracts/chat'
import { onDestroy, onMount } from 'svelte'
import {
  resetShortcutBindings as resetShortcutBindingsApi,
  updateAccountPreferences,
} from '../../services/api'
import { humanizeErrorMessage } from '../../services/response-errors'
import {
  DEFAULT_SHORTCUT_BINDINGS,
  type ResolvedShortcutBindings,
  resolveShortcutBindings,
} from '../../shortcuts/default-bindings'
import { normalizeKeyboardEvent } from '../../shortcuts/normalize'
import { getViewStoreContext, viewKey } from '../../stores/view-store.svelte'
import ActionButton from '../../ui/ActionButton.svelte'
import AlertBanner from '../../ui/AlertBanner.svelte'
import { scrollFormViewToTop } from '../../utils/scroll-form-view'

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)

const keyToSymbol = (token: string): string => {
  if (!isMac) {
    if (token === 'Mod') return 'Ctrl'
    return token
  }
  if (token === 'Mod') return '⌘'
  if (token === 'Alt') return '⌥'
  if (token === 'Shift') return '⇧'
  return token
}

const splitKeyCaps = (keys: string): string[] => keys.split('+').map(keyToSymbol)

const cloneBindings = (value: ResolvedShortcutBindings): ResolvedShortcutBindings => ({ ...value })

interface Props {
  bindings: ResolvedShortcutBindings
  onBindingsChanged: (bindings: ResolvedShortcutBindings) => void
}

let { bindings, onBindingsChanged }: Props = $props()

const viewStore = getViewStoreContext()
const formView = { kind: 'keyboard-shortcuts' as const }

const ACTION_LABELS: Record<string, { label: string; group: string }> = {
  'palette.toggle': { label: 'Toggle Command Palette', group: 'General' },
  'chat.new-conversation': { label: 'New Conversation', group: 'Chat' },
  'chat.switch-conversation': { label: 'Switch Conversation', group: 'Chat' },
  'chat.previous-conversation': { label: 'Previous Conversation', group: 'Chat' },
  'chat.next-conversation': { label: 'Next Conversation', group: 'Chat' },
  'chat.rename-conversation': { label: 'Rename Conversation', group: 'Chat' },
  'chat.delete-conversation': { label: 'Delete Conversation', group: 'Chat' },
  'chat.upload-attachment': { label: 'Add File or Image', group: 'Chat' },
  'settings.cycle-model': { label: 'Cycle Model', group: 'Settings' },
  'settings.cycle-reasoning': { label: 'Cycle Reasoning Mode', group: 'Settings' },
  'settings.cycle-theme': { label: 'Cycle Theme', group: 'Settings' },
  'settings.cycle-typewriter': { label: 'Cycle Typewriter Speed', group: 'Settings' },
  'settings.keyboard-shortcuts': { label: 'Keyboard Shortcuts', group: 'Settings' },
  'agents.manage': { label: 'Manage Agents', group: 'Agents' },
  'agents.new': { label: 'New Agent', group: 'Agents' },
  'garden.manage': { label: 'Manage Gardens', group: 'Garden' },
  'garden.new': { label: 'New Garden Site', group: 'Garden' },
  'mcp.connect': { label: 'Connect MCP', group: 'Integrations' },
  'mcp.manage': { label: 'Manage MCP Servers', group: 'Integrations' },
  'mcp.tool-profiles': { label: 'Manage Tool Profiles', group: 'Integrations' },
  'workspace.switch': { label: 'Switch Workspace', group: 'Workspace' },
  'account.sign-out': { label: 'Sign Out', group: 'Account' },
}

const GROUP_ORDER = [
  'General',
  'Chat',
  'Settings',
  'Agents',
  'Integrations',
  'Garden',
  'Workspace',
  'Account',
]

interface ShortcutRow {
  actionId: string
  label: string
  group: string
}

const rows: ShortcutRow[] = Object.entries(ACTION_LABELS)
  .map(([actionId, meta]) => ({ actionId, ...meta }))
  .sort((a, b) => {
    const gi = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    return gi !== 0 ? gi : a.label.localeCompare(b.label)
  })

const groupedRows = $derived.by(() => {
  const groups: { name: string; items: ShortcutRow[] }[] = []
  let current: { name: string; items: ShortcutRow[] } | null = null
  for (const row of rows) {
    if (!current || current.name !== row.group) {
      current = { name: row.group, items: [] }
      groups.push(current)
    }
    current.items.push(row)
  }
  return groups
})

let formRoot: HTMLElement | undefined = $state()
let draft = $state<ResolvedShortcutBindings>(cloneBindings(DEFAULT_SHORTCUT_BINDINGS))
let recordingActionId = $state<string | null>(null)
let errorMessage = $state('')
let successMessage = $state('')
let isSaving = $state(false)
let lastBindings: ResolvedShortcutBindings | null = null

const anyDirty = $derived.by(() => {
  for (const actionId of Object.keys(DEFAULT_SHORTCUT_BINDINGS)) {
    if (draft[actionId] !== bindings[actionId]) {
      return true
    }
  }
  return false
})

const conflictFor = (actionId: string, keys: string | null): string | null => {
  if (!keys) return null
  for (const [otherId, otherKeys] of Object.entries(draft)) {
    if (otherId !== actionId && otherKeys === keys) {
      return ACTION_LABELS[otherId]?.label ?? otherId
    }
  }
  return null
}

const isDefault = (actionId: string): boolean =>
  draft[actionId] === DEFAULT_SHORTCUT_BINDINGS[actionId]

const restoreFocusToRow = (actionId: string) => {
  if (!formRoot) return
  const button = formRoot.querySelector<HTMLButtonElement>(
    `[aria-label*="${ACTION_LABELS[actionId]?.label ?? ''}"]`,
  )
  button?.focus()
}

const handleRecordKeydown = (event: KeyboardEvent) => {
  if (!recordingActionId) return

  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    const actionId = recordingActionId
    recordingActionId = null
    restoreFocusToRow(actionId)
    return
  }

  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) {
    return
  }

  const normalized = normalizeKeyboardEvent(event)
  if (!normalized) return

  const actionId = recordingActionId
  const conflict = conflictFor(actionId, normalized)
  if (conflict) {
    errorMessage = `"${splitKeyCaps(normalized).join(' ')}" is already used by "${conflict}". Unbind it first.`
    recordingActionId = null
    restoreFocusToRow(actionId)
    return
  }

  errorMessage = ''
  draft[actionId] = normalized
  recordingActionId = null
  restoreFocusToRow(actionId)
}

const startRecording = (actionId: string) => {
  errorMessage = ''
  successMessage = ''
  recordingActionId = actionId
}

const unbind = (actionId: string) => {
  errorMessage = ''
  successMessage = ''
  draft[actionId] = null
  if (recordingActionId === actionId) {
    recordingActionId = null
  }
}

const resetOne = (actionId: string) => {
  errorMessage = ''
  successMessage = ''
  const defaultKeys = DEFAULT_SHORTCUT_BINDINGS[actionId] ?? null

  const conflict = conflictFor(actionId, defaultKeys)
  if (conflict) {
    errorMessage = `Cannot reset: default shortcut is already used by "${conflict}".`
    return
  }

  draft[actionId] = defaultKeys
}

const resetAll = () => {
  errorMessage = ''
  successMessage = ''
  draft = { ...DEFAULT_SHORTCUT_BINDINGS }
}

const save = async () => {
  if (isSaving) return false
  if (!anyDirty) return true

  isSaving = true
  errorMessage = ''
  successMessage = ''

  const overrides: ShortcutBindings = {}
  for (const [actionId, keys] of Object.entries(draft)) {
    if (keys !== DEFAULT_SHORTCUT_BINDINGS[actionId]) {
      overrides[actionId] = keys
    }
  }

  try {
    const hasOverrides = Object.keys(overrides).length > 0
    if (!hasOverrides) {
      const prefs = await resetShortcutBindingsApi({})
      onBindingsChanged(resolveShortcutBindings(prefs.shortcutBindings))
    } else {
      const prefs = await updateAccountPreferences({ shortcutBindings: overrides })
      onBindingsChanged(resolveShortcutBindings(prefs.shortcutBindings))
    }
    successMessage = 'Shortcuts saved.'
    return true
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not save shortcuts.',
    )
    return false
  } finally {
    isSaving = false
  }
}

const isActiveView = (): boolean => viewKey(viewStore.activeView) === viewKey(formView)

let isConfirmingDiscard = $state(false)
let discardTimer: ReturnType<typeof setTimeout> | null = null

const requestClose = (): void => {
  if (!anyDirty) {
    viewStore.pop()
    return
  }
  if (!isConfirmingDiscard) {
    isConfirmingDiscard = true
    discardTimer = setTimeout(() => {
      isConfirmingDiscard = false
    }, 3000)
    return
  }
  if (discardTimer) clearTimeout(discardTimer)
  isConfirmingDiscard = false
  viewStore.pop()
}

const saveAndClose = async (): Promise<void> => {
  if (!anyDirty) {
    viewStore.pop()
    return
  }

  if (await save()) {
    viewStore.pop()
  }
}

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (!isActiveView()) {
    return
  }

  // Allow Ctrl+S to save even during recording, rather than capturing it as a shortcut
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    event.stopPropagation()
    if (recordingActionId) recordingActionId = null
    void save()
    return
  }

  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    if (recordingActionId) recordingActionId = null
    void saveAndClose()
    return
  }

  if (recordingActionId) {
    handleRecordKeydown(event)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    if (recordingActionId) {
      handleRecordKeydown(event)
      return
    }
    void requestClose()
    return
  }
}

$effect(() => {
  if (bindings === lastBindings) {
    return
  }

  lastBindings = bindings
  draft = cloneBindings(bindings)
  recordingActionId = null
})

onMount(() => {
  window.addEventListener('keydown', handleGlobalKeydown, true)
  viewStore.registerDirtyGuard(formView, () => anyDirty)
  scrollFormViewToTop(formRoot)
})

onDestroy(() => {
  if (discardTimer) clearTimeout(discardTimer)
  window.removeEventListener('keydown', handleGlobalKeydown, true)
  viewStore.clearDirtyGuard(formView)
})
</script>

<div class="mx-auto w-full px-6 py-8" style="max-width: var(--chat-max-w, 42rem)" bind:this={formRoot}>
  <!-- Header -->
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-[16px] font-semibold text-text-primary">Keyboard Shortcuts</h2>
      <p class="mt-1 text-[13px] text-text-secondary">
        Click a shortcut to re-record it. Press Escape to cancel.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <ActionButton onclick={resetAll} disabled={isSaving}>
        Reset All
      </ActionButton>
      <ActionButton variant={isConfirmingDiscard ? 'danger' : 'secondary'} onclick={() => { requestClose() }}>
        {isConfirmingDiscard ? 'Discard' : viewStore.backLabel ?? 'Back to Chat'}
      </ActionButton>
      <ActionButton variant="primary" disabled={isSaving} onclick={() => { void saveAndClose() }}>
        {isSaving ? 'Saving…' : 'Save & Close'}
      </ActionButton>
    </div>
  </div>

  {#if errorMessage}
    <AlertBanner variant="error" message={errorMessage} ondismiss={() => { errorMessage = '' }} />
  {/if}
  {#if successMessage}
    <AlertBanner variant="success" message={successMessage} ondismiss={() => { successMessage = '' }} />
  {/if}

  <!-- Shortcut groups -->
  <div class="space-y-5">
    {#each groupedRows as group}
      <div>
        <p class="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          {group.name}
        </p>
        <div class="rounded-lg border border-border bg-surface-1/50">
          {#each group.items as row, i}
            {@const keys = draft[row.actionId]}
            {@const isRecording = recordingActionId === row.actionId}
            {@const isDefaultValue = isDefault(row.actionId)}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="group/row flex items-center gap-3 px-3.5 py-2 {i > 0 ? 'border-t border-border/40' : ''} transition-colors hover:bg-surface-2/40"
            >
              <!-- Label -->
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <span class="truncate text-[13px] text-text-primary">{row.label}</span>
                {#if !isDefaultValue}
                  <button
                    type="button"
                    class="shrink-0 rounded px-1 py-0.5 text-[10px] text-accent/60 transition-colors hover:bg-accent/10 hover:text-accent"
                    onclick={() => resetOne(row.actionId)}
                  >
                    reset
                  </button>
                {/if}
              </div>

              <!-- Shortcut cell — fixed width for stable layout -->
              <div class="w-[180px] shrink-0">
                {#if isRecording}
                  <!-- Recording state -->
                  <button
                    type="button"
                    class="flex h-[32px] w-full items-center justify-center rounded-md border-[1.5px] border-accent/50 bg-accent/5"
                    onclick={() => { recordingActionId = null }}
                  >
                    <span class="text-[12px] text-accent">Type a shortcut&#8230;</span>
                  </button>
                {:else}
                  <!-- Idle state -->
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="flex h-[32px] min-w-0 flex-1 cursor-pointer items-center rounded-md border border-transparent px-2 transition-colors hover:border-border/60 hover:bg-surface-0/60"
                      onclick={() => startRecording(row.actionId)}
                      aria-label="Shortcut for {row.label}: {keys ? splitKeyCaps(keys).join(' ') : 'not set'}. Click to change."
                    >
                      <!-- Key caps or empty -->
                      <span class="flex min-w-0 flex-1 items-center gap-[5px]">
                        {#if keys}
                          {#each splitKeyCaps(keys) as cap}
                            <kbd
                              class="inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-[5px] border border-white/[0.06] bg-surface-2 px-[6px] text-[11px] font-medium leading-none text-text-secondary shadow-[0_1px_0_1px_rgba(0,0,0,0.25),0_0_0_0.5px_rgba(0,0,0,0.12)]"
                            >{cap}</kbd>
                          {/each}
                        {:else}
                          <span class="pl-0.5 text-[11px] text-text-tertiary/50">&mdash;</span>
                        {/if}
                      </span>
                    </button>

                    {#if keys}
                      <button
                        type="button"
                        class="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                        aria-label="Remove shortcut for {row.label}"
                        onclick={() => unbind(row.actionId)}
                      >
                        <svg class="h-3 w-3 text-text-tertiary/60 transition-colors hover:text-danger-text" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8"/><path d="M12 4 4 12"/></svg>
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Sticky save bar -->
  <div class="sticky bottom-0 -mx-6 mt-6 flex items-center justify-between border-t border-border bg-bg/80 px-6 py-4 backdrop-blur-sm">
    <div>
      {#if anyDirty}
        <span class="text-[11px] text-text-tertiary">Unsaved changes</span>
      {/if}
    </div>
    <ActionButton variant="primary" disabled={isSaving || !anyDirty} onclick={() => void save()}>
      {isSaving ? 'Saving…' : 'Save'}
    </ActionButton>
  </div>
</div>
