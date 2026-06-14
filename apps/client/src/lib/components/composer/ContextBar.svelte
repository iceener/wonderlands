<script lang="ts">
import { onDestroy } from 'svelte'

import TiptapPromptEditor from '../../prompt-editor/TiptapPromptEditor.svelte'
import {
  getAccountPreferences,
  getMcpServerTools,
  getThreadMemory,
  listMcpServers,
  type ThreadMemoryRecord,
  type ThreadMemoryReflection,
  type ThreadMemoryResponse,
  updateThreadMemory,
} from '../../services/api'
import { chatStore } from '../../stores/chat-store.svelte'
import { formatTokens } from './context-bar-summary'

type MemorySaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

let showPanel = $state(false)
let memoryData = $state<ThreadMemoryResponse | null>(null)
let memoryLoading = $state(false)
let memoryDrafts = $state<Record<string, string>>({})
let saveStates = $state<Record<string, MemorySaveState>>({})
let saveErrors = $state<Record<string, string>>({})

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const draftVersions = new Map<string, number>()
const SAVE_DEBOUNCE_MS = 600

const contextWindow = $derived(chatStore.contextWindow)
const budget = $derived(chatStore.contextBudget)
const isStreaming = $derived(chatStore.isStreaming)
const memoryActivity = $derived(chatStore.memoryActivity)
const resolvedContextWindow = $derived(budget?.contextWindow ?? contextWindow)

const inputEstimateTokens = $derived(budget?.estimatedInputTokens ?? 0)
const liveOutputTokens = $derived(budget?.liveOutputTokens ?? 0)
const usedTokens = $derived(inputEstimateTokens + liveOutputTokens)
const remainingTokens = $derived(
  resolvedContextWindow ? Math.max(0, resolvedContextWindow - usedTokens) : 0,
)
const usedPercent = $derived(
  resolvedContextWindow && usedTokens > 0
    ? Math.min(100, Math.round((usedTokens / resolvedContextWindow) * 100))
    : 0,
)
const remainingPercent = $derived(100 - usedPercent)

const barColor = $derived(
  usedPercent >= 90 ? 'bg-danger' : usedPercent >= 70 ? 'bg-warning' : 'bg-accent',
)

let toolInfo = $state<{ count: number; servers: number; estimatedTokens: number } | null>(null)
let toolInfoLoading = $state(false)

const loadToolInfo = async () => {
  toolInfoLoading = true
  try {
    const prefs = await getAccountPreferences()
    const profileId = prefs.assistantToolProfileId
    if (!profileId) {
      toolInfo = { count: 0, servers: 0, estimatedTokens: 0 }
      return
    }
    const servers = await listMcpServers()
    let totalTools = 0
    let totalServers = 0
    let estimatedTokens = 0
    for (const server of servers) {
      try {
        const result = await getMcpServerTools(server.id, { toolProfileId: profileId })
        const assigned = result.tools.filter((t) => t.modelVisible && t.assignment)
        if (assigned.length > 0) {
          totalServers++
          totalTools += assigned.length
          for (const tool of assigned) {
            // Rough estimate: tool name ~10 tokens + description ~30 tokens + schema ~50 tokens
            const schemaSize = tool.inputSchemaJson
              ? JSON.stringify(tool.inputSchemaJson).length
              : 0
            const descSize = tool.description?.length ?? 0
            estimatedTokens += Math.ceil(10 + descSize / 4 + schemaSize / 4)
          }
        }
      } catch {
        /* skip */
      }
    }
    toolInfo = { count: totalTools, servers: totalServers, estimatedTokens }
  } catch {
    toolInfo = null
  } finally {
    toolInfoLoading = false
  }
}

const memoryLabel = $derived(
  memoryActivity === 'observing'
    ? 'Observing…'
    : memoryActivity === 'reflecting'
      ? 'Reflecting…'
      : null,
)

const formatOptionalTokens = (n: number | null | undefined): string => {
  if (typeof n !== 'number') return '—'
  return formatTokens(n)
}

const clearPendingSaves = () => {
  for (const timer of saveTimers.values()) {
    clearTimeout(timer)
  }

  saveTimers.clear()
  draftVersions.clear()
}

const clearLocalMemoryState = () => {
  clearPendingSaves()
  memoryData = null
  memoryDrafts = {}
  memoryLoading = false
  saveErrors = {}
  saveStates = {}
  showPanel = false
}

onDestroy(() => {
  clearPendingSaves()
})

const getObservationRecordKey = (recordId: string): string => `obs:${recordId}`
const getObservationItemKey = (recordId: string, index: number): string =>
  `${getObservationRecordKey(recordId)}:${index}`
const getReflectionRecordKey = (recordId: string): string => `ref:${recordId}`

const readDraftVersion = (key: string): number => draftVersions.get(key) ?? 0

const bumpDraftVersion = (key: string) => {
  draftVersions.set(key, readDraftVersion(key) + 1)
}

const setSaveState = (key: string, state: MemorySaveState, errorMessage: string | null = null) => {
  saveStates = {
    ...saveStates,
    [key]: state,
  }

  if (errorMessage) {
    saveErrors = {
      ...saveErrors,
      [key]: errorMessage,
    }
    return
  }

  if (!(key in saveErrors)) {
    return
  }

  const nextErrors = { ...saveErrors }
  delete nextErrors[key]
  saveErrors = nextErrors
}

const getSaveLabel = (key: string): string | null => {
  switch (saveStates[key]) {
    case 'pending':
    case 'saving':
      return 'Saving…'
    case 'saved':
      return 'Saved'
    case 'error':
      return 'Could not save.'
    default:
      return null
  }
}

const getDraftValue = (key: string, fallback: string): string => memoryDrafts[key] ?? fallback

const setDraftValue = (key: string, value: string) => {
  memoryDrafts = {
    ...memoryDrafts,
    [key]: value,
  }
}

const syncObservationDrafts = (record: ThreadMemoryRecord) => {
  for (const [index, observation] of record.content.observations.entries()) {
    setDraftValue(getObservationItemKey(record.id, index), observation.text)
  }
}

const syncReflectionDraft = (record: ThreadMemoryReflection) => {
  setDraftValue(getReflectionRecordKey(record.id), record.content.reflection)
}

const upsertObservationRecord = (updated: ThreadMemoryRecord) => {
  if (!memoryData) {
    return
  }

  memoryData = {
    ...memoryData,
    observations: memoryData.observations.map((record) =>
      record.id === updated.id ? updated : record,
    ),
  }
  syncObservationDrafts(updated)
}

const upsertReflectionRecord = (updated: ThreadMemoryReflection) => {
  if (!memoryData) {
    return
  }

  memoryData = {
    ...memoryData,
    reflection: updated,
  }
  syncReflectionDraft(updated)
}

const scheduleSave = (saveKey: string, runner: () => Promise<void>) => {
  const existingTimer = saveTimers.get(saveKey)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  setSaveState(saveKey, 'pending')
  const timer = setTimeout(() => {
    saveTimers.delete(saveKey)
    void runner()
  }, SAVE_DEBOUNCE_MS)
  saveTimers.set(saveKey, timer)
}

const saveObservationRecord = async (recordId: string) => {
  if (!memoryData || !chatStore.threadId) {
    return
  }

  const record = memoryData.observations.find((entry) => entry.id === recordId)
  if (!record) {
    return
  }

  const threadId = chatStore.threadId
  const saveKey = getObservationRecordKey(record.id)
  const startedVersion = readDraftVersion(saveKey)
  const observations = record.content.observations.map((item, index) => ({
    text: getDraftValue(getObservationItemKey(record.id, index), item.text),
  }))

  if (observations.some((item) => item.text.trim().length === 0)) {
    if (readDraftVersion(saveKey) === startedVersion) {
      setSaveState(saveKey, 'error', 'Observation text cannot be empty.')
    }
    return
  }

  setSaveState(saveKey, 'saving')

  try {
    const updated = await updateThreadMemory(threadId, record.id, {
      kind: 'observation',
      observations,
    })

    if (chatStore.threadId !== threadId || updated.kind !== 'observation') {
      return
    }

    upsertObservationRecord(updated)

    if (readDraftVersion(saveKey) === startedVersion) {
      setSaveState(saveKey, 'saved')
    }
  } catch {
    if (chatStore.threadId === threadId && readDraftVersion(saveKey) === startedVersion) {
      setSaveState(saveKey, 'error', 'Could not save observation.')
    }
  }
}

const saveReflectionRecord = async (record: ThreadMemoryReflection) => {
  if (!chatStore.threadId) {
    return
  }

  const threadId = chatStore.threadId
  const saveKey = getReflectionRecordKey(record.id)
  const startedVersion = readDraftVersion(saveKey)
  const reflection = getDraftValue(saveKey, record.content.reflection)

  if (reflection.trim().length === 0) {
    if (readDraftVersion(saveKey) === startedVersion) {
      setSaveState(saveKey, 'error', 'Reflection text cannot be empty.')
    }
    return
  }

  setSaveState(saveKey, 'saving')

  try {
    const updated = await updateThreadMemory(threadId, record.id, {
      kind: 'reflection',
      reflection,
    })

    if (chatStore.threadId !== threadId || updated.kind !== 'reflection') {
      return
    }

    upsertReflectionRecord(updated)

    if (readDraftVersion(saveKey) === startedVersion) {
      setSaveState(saveKey, 'saved')
    }
  } catch {
    if (chatStore.threadId === threadId && readDraftVersion(saveKey) === startedVersion) {
      setSaveState(saveKey, 'error', 'Could not save reflection.')
    }
  }
}

const handleObservationChange = (record: ThreadMemoryRecord, index: number, markdown: string) => {
  setDraftValue(getObservationItemKey(record.id, index), markdown)
  const saveKey = getObservationRecordKey(record.id)
  bumpDraftVersion(saveKey)
  scheduleSave(saveKey, () => saveObservationRecord(record.id))
}

const handleReflectionChange = (record: ThreadMemoryReflection, markdown: string) => {
  const saveKey = getReflectionRecordKey(record.id)
  setDraftValue(saveKey, markdown)
  bumpDraftVersion(saveKey)
  scheduleSave(saveKey, () => saveReflectionRecord(record))
}

$effect(() => {
  chatStore.threadId
  clearLocalMemoryState()
})

const togglePanel = async () => {
  showPanel = !showPanel
  if (showPanel && toolInfo === null) {
    void loadToolInfo()
  }
  const threadId = chatStore.threadId
  if (showPanel && !memoryData && threadId) {
    memoryLoading = true
    try {
      const nextMemory = await getThreadMemory(threadId)
      if (chatStore.threadId === threadId) {
        memoryData = nextMemory
      }
    } catch {
      if (chatStore.threadId === threadId) {
        memoryData = null
      }
    } finally {
      if (chatStore.threadId === threadId) {
        memoryLoading = false
      }
    }
  }
}

const refreshMemory = async () => {
  const threadId = chatStore.threadId
  if (!threadId) return
  memoryLoading = true
  try {
    const nextMemory = await getThreadMemory(threadId)
    if (chatStore.threadId === threadId) {
      memoryData = nextMemory
    }
  } catch {
    if (chatStore.threadId === threadId) {
      memoryData = null
    }
  } finally {
    if (chatStore.threadId === threadId) {
      memoryLoading = false
    }
  }
}
</script>

<div class="relative flex items-center gap-2">
  {#if resolvedContextWindow && budget}
    <button
      type="button"
      class="group flex items-center gap-1.5 text-[11px] text-text-tertiary transition-colors hover:text-text-secondary"
      title={`Context used: ${formatTokens(usedTokens)} / ${formatTokens(resolvedContextWindow)}. Room left: ${formatTokens(remainingTokens)}. Current input: ${formatTokens(inputEstimateTokens)}. Current output: ${formatTokens(liveOutputTokens)}.`}
      onclick={togglePanel}
    >
      <div class="h-1 w-12 overflow-hidden rounded-full bg-surface-2">
        <div class={`h-full rounded-full transition-all duration-300 ${barColor}`} style:width="{usedPercent}%"></div>
      </div>
      <span>{usedPercent}%</span>
      {#if memoryLabel}
        <span class="flex items-center gap-1">
          <span class="caret-blink h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
          {memoryLabel}
        </span>
      {/if}
    </button>
  {:else if memoryLabel}
    <span class="flex items-center gap-1 text-[11px] text-text-tertiary">
      <span class="caret-blink h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
      {memoryLabel}
    </span>
  {/if}

  {#if showPanel}
    <div class="fixed inset-x-2 bottom-14 z-20 sm:absolute sm:inset-x-auto sm:bottom-full sm:right-0 sm:mb-0 sm:w-[34rem]">
      <div class="max-h-[min(70vh,32rem)] overflow-y-auto rounded-lg border border-border bg-surface-0 shadow-lg">
        <div class="flex items-center justify-between border-b border-border px-3 py-2">
          <span class="text-[12px] font-medium text-text-primary">Context & Memory</span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-[11px] text-text-tertiary hover:text-text-secondary"
              onclick={refreshMemory}
            >
              Refresh
            </button>
            <button
              type="button"
              class="text-[11px] text-text-tertiary hover:text-text-secondary"
              onclick={() => { showPanel = false }}
            >
              Close
            </button>
          </div>
        </div>

        {#if budget && resolvedContextWindow}
          <div class="border-b border-border px-3 py-2">
            <div class="grid gap-3 text-[11px] sm:grid-cols-2">
              <div class="min-w-0">
                <div class="text-text-secondary">Context used</div>
                <div class="mt-0.5 text-[14px] font-medium tabular-nums text-text-primary">
                  {formatTokens(usedTokens)} / {formatTokens(resolvedContextWindow)}
                </div>
                <div class="mt-0.5 text-[10px] text-text-tertiary">
                  Current input plus any streaming output.
                </div>
              </div>
              <div class="min-w-0 text-left sm:text-right">
                <div class="text-text-secondary">Room left</div>
                <div class="mt-0.5 text-[14px] font-medium tabular-nums text-text-primary">
                  {formatTokens(remainingTokens)}
                </div>
                <div class="mt-0.5 text-[10px] text-text-tertiary">
                  {remainingPercent}% free in the current context window.
                </div>
              </div>
            </div>
            <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div class={`h-full rounded-full transition-all duration-300 ${barColor}`} style:width="{usedPercent}%"></div>
            </div>
            <div class="mt-3 space-y-1 text-[10px] text-text-tertiary">
              <div>Current input: {formatOptionalTokens(budget.estimatedInputTokens)}</div>
              <div>Current streaming output: {formatTokens(liveOutputTokens)}</div>
              <div>
                Last completed call:
                {#if typeof budget.actualInputTokens === 'number' || typeof budget.actualOutputTokens === 'number'}
                  {formatOptionalTokens(budget.actualInputTokens)} in / {formatOptionalTokens(budget.actualOutputTokens)} out
                {:else}
                  —
                {/if}
              </div>
              <div>
                Last cache hit:
                {#if typeof budget.cachedInputTokens === 'number'}
                  {formatTokens(budget.cachedInputTokens)}
                {:else}
                  —
                {/if}
              </div>
              {#if memoryLabel}
                <div>{memoryLabel}</div>
              {/if}
            </div>
          </div>
        {/if}

        <div class="border-b border-border px-3 py-2">
          <div class="text-[11px] text-text-secondary">MCP Tools</div>
          {#if toolInfoLoading}
            <p class="mt-0.5 text-[10px] text-text-tertiary">Loading…</p>
          {:else if toolInfo && toolInfo.count > 0}
            <div class="mt-0.5 text-[10px] text-text-tertiary">
              {toolInfo.count} tool{toolInfo.count === 1 ? '' : 's'} enabled from {toolInfo.servers} server{toolInfo.servers === 1 ? '' : 's'} · ~{formatTokens(toolInfo.estimatedTokens)} tokens in context
            </div>
          {:else}
            <p class="mt-0.5 text-[10px] text-text-tertiary">No MCP tools enabled.</p>
          {/if}
        </div>

        <div class="px-3 py-2">
          {#if memoryLoading}
            <p class="text-[11px] text-text-tertiary">Loading memory…</p>
          {:else if !memoryData || (memoryData.observations.length === 0 && !memoryData.reflection)}
            <p class="text-[11px] text-text-tertiary">No observations yet.</p>
          {:else}
            {#if memoryData.reflection}
              {@const reflectionRecord = memoryData.reflection}
              {@const reflectionSaveKey = getReflectionRecordKey(reflectionRecord.id)}
              <div class="mb-3">
                <div class="flex items-center justify-between text-[11px] font-medium text-text-secondary">
                  <span>Reflection (gen {reflectionRecord.generation})</span>
                  {#if getSaveLabel(reflectionSaveKey)}
                    <span class={saveStates[reflectionSaveKey] === 'error' ? 'text-danger-text' : 'text-text-tertiary'}>
                      {getSaveLabel(reflectionSaveKey)}
                    </span>
                  {/if}
                </div>
                <div class="mt-1 sd-memory-editor">
                  <TiptapPromptEditor
                    value={getDraftValue(reflectionSaveKey, reflectionRecord.content.reflection)}
                    placeholder="Reflection"
                    ariaLabel="Editable reflection memory"
                    onMarkdownChange={(markdown) => handleReflectionChange(reflectionRecord, markdown)}
                  />
                </div>
                {#if saveErrors[reflectionSaveKey]}
                  <p class="mt-1 text-[10px] text-danger-text">{saveErrors[reflectionSaveKey]}</p>
                {/if}
              </div>
            {/if}

            {#if memoryData.observations.length > 0}
              <div class="text-[11px] font-medium text-text-secondary">
                Observations ({memoryData.observations.length})
              </div>
              {#each memoryData.observations as observationRecord, observationRecordIndex (observationRecord.id)}
                {@const observationSaveKey = getObservationRecordKey(observationRecord.id)}
                <div class="mt-2 rounded-md border border-border bg-surface-1 px-2 py-2">
                  <div class="flex items-center justify-between text-[10px] text-text-tertiary">
                    <span>Record {observationRecordIndex + 1}</span>
                    {#if getSaveLabel(observationSaveKey)}
                      <span class={saveStates[observationSaveKey] === 'error' ? 'text-danger-text' : 'text-text-tertiary'}>
                        {getSaveLabel(observationSaveKey)}
                      </span>
                    {/if}
                  </div>
                  <div class="mt-1 space-y-2">
                    {#each observationRecord.content.observations as observation, observationIndex (`${observationRecord.id}:${observationIndex}`)}
                      <div class="sd-memory-editor">
                        <TiptapPromptEditor
                          value={getDraftValue(
                            getObservationItemKey(observationRecord.id, observationIndex),
                            observation.text,
                          )}
                          placeholder={`Observation ${observationIndex + 1}`}
                          ariaLabel={`Editable observation ${observationIndex + 1}`}
                          onMarkdownChange={(markdown) =>
                            handleObservationChange(observationRecord, observationIndex, markdown)}
                        />
                      </div>
                    {/each}
                  </div>
                  {#if saveErrors[observationSaveKey]}
                    <p class="mt-1 text-[10px] text-danger-text">{saveErrors[observationSaveKey]}</p>
                  {/if}
                </div>
              {/each}
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .sd-memory-editor :global(.sd-prompt-shell) {
    min-height: auto;
  }

  .sd-memory-editor :global(.sd-prompt-editor .ProseMirror) {
    min-height: 0;
    padding-block: 0.4rem;
    font-size: 11px;
    line-height: 1.5;
  }
</style>
