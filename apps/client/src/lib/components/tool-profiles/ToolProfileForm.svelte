<script lang="ts">
import type {
  BackendToolProfile,
  ToolProfileScope,
  ToolProfileStatus,
} from '@wonderlands/contracts/chat'
import { onDestroy, onMount, tick } from 'svelte'
import {
  assignMcpTool,
  createToolProfile,
  deleteMcpToolAssignment,
  getAccountPreferences,
  getMcpServerTools,
  getToolProfile,
  listMcpServers,
  updateToolProfile,
} from '../../services/api'
import { humanizeErrorMessage } from '../../services/response-errors'
import { getViewStoreContext, viewKey } from '../../stores/view-store.svelte'
import ActionButton from '../../ui/ActionButton.svelte'
import AlertBanner from '../../ui/AlertBanner.svelte'
import FieldInput from '../../ui/FieldInput.svelte'
import SectionCard from '../../ui/SectionCard.svelte'
import SegmentControl from '../../ui/SegmentControl.svelte'
import { scrollFormViewToTop } from '../../utils/scroll-form-view'
import { planToolProfileAccessChanges } from './tool-profile-diff'

interface Props {
  toolProfileId?: string
}

interface ToolProfileFormState {
  name: string
  scope: Extract<ToolProfileScope, 'account_private' | 'tenant_shared'>
  status: Extract<ToolProfileStatus, 'active' | 'archived'>
}

interface McpToolRow {
  serverId: string
  serverLabel: string
  runtimeName: string
  title: string
  description: string | null
  enabled: boolean
  trusted: boolean
  mutable: boolean
}

interface McpToolGroup {
  serverId: string
  serverLabel: string
  tools: McpToolRow[]
  enabledCount: number
}

let { toolProfileId }: Props = $props()

const viewStore = getViewStoreContext()
const getFormView = () => ({
  kind: 'tool-profile-form' as const,
  ...(toolProfileId ? { toolProfileId } : {}),
})

let editingToolProfileId = $state<string | null>(null)
let form = $state<ToolProfileFormState>({
  name: '',
  scope: 'account_private',
  status: 'active',
})
let loadedProfile = $state<ToolProfileFormState | null>(null)
let baselineMcpTools = $state<McpToolRow[]>([])
let mcpTools = $state<McpToolRow[]>([])
let errorMessage = $state('')
let successMessage = $state('')
let isLoading = $state(false)
let isLoadingMcpTools = $state(false)
let isSaving = $state(false)
let isAssistantDefaultProfile = $state(false)
let assistantToolProfileId = $state<string | null>(null)
let formRoot: HTMLElement | undefined = $state()

const toolSelectionDirty = $derived.by(() => {
  const baselineByRuntimeName = new Map(
    baselineMcpTools.map((tool) => [tool.runtimeName, `${tool.enabled}:${tool.trusted}`]),
  )

  for (const tool of mcpTools) {
    const baseline = baselineByRuntimeName.get(tool.runtimeName) ?? 'false:false'
    const current = `${tool.enabled}:${tool.trusted}`
    if (baseline !== current) {
      return true
    }
  }

  return false
})

const metadataDirty = $derived.by(() => {
  if (!editingToolProfileId) return form.name.trim().length > 0
  if (!loadedProfile) return false
  return (
    form.name !== loadedProfile.name ||
    form.scope !== loadedProfile.scope ||
    form.status !== loadedProfile.status
  )
})

const anyDirty = $derived(metadataDirty || toolSelectionDirty)

const mcpToolGroups = $derived.by((): McpToolGroup[] => {
  const grouped = new Map<string, McpToolGroup>()

  for (const tool of mcpTools) {
    let group = grouped.get(tool.serverId)

    if (!group) {
      group = {
        enabledCount: 0,
        serverId: tool.serverId,
        serverLabel: tool.serverLabel,
        tools: [],
      }
      grouped.set(tool.serverId, group)
    }

    group.tools.push(tool)
    if (tool.enabled) {
      group.enabledCount += 1
    }
  }

  return Array.from(grouped.values())
})

const changeSummary = $derived.by(() => {
  if (!toolSelectionDirty) return ''
  const baselineMap = new Map(baselineMcpTools.map((t) => [t.runtimeName, t]))
  let added = 0,
    removed = 0,
    trustChanged = 0
  for (const tool of mcpTools) {
    const base = baselineMap.get(tool.runtimeName)
    if (tool.enabled && !base?.enabled) added++
    else if (!tool.enabled && base?.enabled) removed++
    else if (tool.enabled && base?.enabled && tool.trusted !== base.trusted) trustChanged++
  }
  const parts: string[] = []
  if (added) parts.push(`+${added} assigned`)
  if (removed) parts.push(`-${removed} removed`)
  if (trustChanged) parts.push(`${trustChanged} trust changed`)
  if (metadataDirty) parts.push('profile updated')
  return parts.join(', ')
})

const fetchMcpToolsForProfile = async (profileId: string): Promise<McpToolRow[]> => {
  const servers = await listMcpServers()
  const rows: McpToolRow[] = []

  for (const server of servers) {
    try {
      const result = await getMcpServerTools(server.id, { toolProfileId: profileId })
      for (const tool of result.tools) {
        if (!tool.modelVisible) continue
        rows.push({
          description: tool.description,
          enabled: tool.assignment !== null && tool.assignment !== undefined,
          mutable: true,
          runtimeName: tool.runtimeName,
          serverId: tool.serverId || result.server.id,
          serverLabel: result.server.label,
          title: tool.title?.trim() || tool.remoteName,
          trusted: tool.assignment?.requiresConfirmation === false,
        })
      }
    } catch {
      // skip servers that fail to load
    }
  }

  return rows
}

const loadAllAvailableTools = async (): Promise<void> => {
  isLoadingMcpTools = true
  try {
    const servers = await listMcpServers()
    const rows: McpToolRow[] = []
    for (const server of servers) {
      try {
        const result = await getMcpServerTools(server.id)
        for (const tool of result.tools) {
          if (!tool.modelVisible) continue
          rows.push({
            description: tool.description,
            enabled: false,
            mutable: true,
            runtimeName: tool.runtimeName,
            serverId: tool.serverId || result.server.id,
            serverLabel: result.server.label,
            title: tool.title?.trim() || tool.remoteName,
            trusted: false,
          })
        }
      } catch {
        /* skip */
      }
    }
    mcpTools = rows
    baselineMcpTools = rows.map((row) => ({ ...row }))
  } catch {
    mcpTools = []
    baselineMcpTools = []
  } finally {
    isLoadingMcpTools = false
  }
}

const loadToolAccess = async (profileId: string): Promise<void> => {
  isLoadingMcpTools = true

  try {
    const rows = await fetchMcpToolsForProfile(profileId)
    mcpTools = rows
    baselineMcpTools = rows.map((row) => ({ ...row }))
  } catch {
    mcpTools = []
    baselineMcpTools = []
  } finally {
    isLoadingMcpTools = false
  }
}

const setToolEnabled = (tool: McpToolRow, nextEnabled: boolean): void => {
  if (!tool.mutable) {
    return
  }

  mcpTools = mcpTools.map((row) =>
    row.runtimeName === tool.runtimeName
      ? { ...row, enabled: nextEnabled, trusted: nextEnabled ? row.trusted : false }
      : row,
  )
}

const setToolTrusted = (tool: McpToolRow, nextTrusted: boolean): void => {
  if (!tool.mutable || !tool.enabled) {
    return
  }

  mcpTools = mcpTools.map((row) =>
    row.runtimeName === tool.runtimeName ? { ...row, trusted: nextTrusted } : row,
  )
}

const setServerEnabled = (group: McpToolGroup, nextEnabled: boolean): void => {
  const runtimeNames = new Set(
    group.tools.filter((tool) => tool.mutable).map((tool) => tool.runtimeName),
  )

  mcpTools = mcpTools.map((row) =>
    runtimeNames.has(row.runtimeName)
      ? { ...row, enabled: nextEnabled, trusted: nextEnabled ? row.trusted : false }
      : row,
  )
}

const setServerTrusted = (group: McpToolGroup, nextTrusted: boolean): void => {
  const runtimeNames = new Set(
    group.tools.filter((tool) => tool.mutable && tool.enabled).map((tool) => tool.runtimeName),
  )

  mcpTools = mcpTools.map((row) =>
    runtimeNames.has(row.runtimeName) ? { ...row, trusted: nextTrusted } : row,
  )
}

const hydrateProfile = (profile: BackendToolProfile) => {
  editingToolProfileId = profile.id
  const snapshot: ToolProfileFormState = {
    name: profile.name,
    scope: profile.scope === 'tenant_shared' ? 'tenant_shared' : 'account_private',
    status: profile.status === 'archived' ? 'archived' : 'active',
  }
  form = { ...snapshot }
  loadedProfile = snapshot
}

const saveToolAccessForProfile = async (profileId: string) => {
  const currentRows = await fetchMcpToolsForProfile(profileId)
  const plan = planToolProfileAccessChanges(currentRows, mcpTools)

  for (const assignment of plan.assignments) {
    await assignMcpTool({
      requiresConfirmation: assignment.requiresConfirmation,
      runtimeName: assignment.runtimeName,
      serverId: assignment.serverId,
      toolProfileId: profileId,
    })
  }

  for (const runtimeName of plan.removals) {
    await deleteMcpToolAssignment({
      runtimeName,
      toolProfileId: profileId,
    })
  }
}

const save = async (): Promise<boolean> => {
  if (isSaving) return false
  if (!anyDirty) return true

  const trimmedName = form.name.trim()
  if (!trimmedName) {
    errorMessage = 'Profile name is required.'
    return false
  }

  isSaving = true
  errorMessage = ''
  successMessage = ''

  try {
    let profileId = editingToolProfileId

    // Save metadata if new or dirty
    if (!profileId || metadataDirty) {
      const saved = profileId
        ? await updateToolProfile(profileId, {
            name: trimmedName,
            scope: form.scope,
            status: form.status,
          })
        : await createToolProfile({
            name: trimmedName,
            scope: form.scope,
          })

      hydrateProfile(saved)
      profileId = saved.id
    }

    // Save tool access if dirty (and profile exists)
    if (profileId && toolSelectionDirty) {
      await saveToolAccessForProfile(profileId)
    }

    if (profileId) {
      await loadToolAccess(profileId)
    }
    successMessage = `Saved "${trimmedName}".`
    return true
  } catch (error) {
    errorMessage = humanizeErrorMessage(error instanceof Error ? error.message : 'Could not save.')
    return false
  } finally {
    isSaving = false
  }
}

const isActiveView = (): boolean => viewKey(viewStore.activeView) === viewKey(getFormView())

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

const handleKeydown = (event: KeyboardEvent) => {
  if (!isActiveView()) {
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    void requestClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void saveAndClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void save()
  }
}

onMount(() => {
  editingToolProfileId = toolProfileId?.trim() || null
  void tick().then(() => {
    scrollFormViewToTop(formRoot)
  })

  window.addEventListener('keydown', handleKeydown)
  viewStore.registerDirtyGuard(getFormView(), () => anyDirty)

  isLoading = true

  void (async () => {
    try {
      const preferences = await getAccountPreferences()
      assistantToolProfileId = preferences.assistantToolProfileId
      isAssistantDefaultProfile = preferences.assistantToolProfileId === editingToolProfileId
    } catch {
      assistantToolProfileId = null
      isAssistantDefaultProfile = false
    }

    if (!editingToolProfileId) {
      isLoading = false
      void loadAllAvailableTools()
      return
    }

    try {
      const profile = await getToolProfile(editingToolProfileId)
      hydrateProfile(profile)
      isAssistantDefaultProfile = profile.id === assistantToolProfileId
      await loadToolAccess(profile.id)
    } catch (error) {
      errorMessage = humanizeErrorMessage(
        error instanceof Error ? error.message : 'Could not load this tool profile.',
      )
    } finally {
      isLoading = false
      void tick().then(() => {
        scrollFormViewToTop(formRoot)
      })
    }
  })()
})

onDestroy(() => {
  if (discardTimer) clearTimeout(discardTimer)
  window.removeEventListener('keydown', handleKeydown)
  viewStore.clearDirtyGuard(getFormView())
})
</script>

<div class="mx-auto w-full px-6 py-8" style="max-width: var(--chat-max-w, 42rem)" bind:this={formRoot}>
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-[16px] font-semibold text-text-primary">
        {editingToolProfileId ? 'Edit Tool Profile' : 'New Tool Profile'}
      </h2>
      <p class="mt-1 text-[13px] text-text-secondary">
        Tool profiles control which MCP tools are available to assistant mode or to specific agents.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <ActionButton variant={isConfirmingDiscard ? 'danger' : 'secondary'} onclick={() => { requestClose() }}>
        {isConfirmingDiscard ? 'Discard' : viewStore.backLabel ?? 'Back to Chat'}
      </ActionButton>
      <ActionButton variant="primary" disabled={isSaving} onclick={() => { void saveAndClose() }}>
        {isSaving ? 'Saving…' : 'Save & Close'}
      </ActionButton>
    </div>
  </div>

  {#if isLoading}
    <div class="rounded-lg border border-border bg-surface-1/60 px-4 py-5 text-[13px] text-text-secondary">
      Loading tool profile…
    </div>
  {:else}
    <form
      class="space-y-6"
      onsubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <SectionCard title="Profile">
        <div class="space-y-5">
          <FieldInput
            label="Name"
            value={form.name}
            placeholder="Research Access"
            oninput={(value) => {
              form.name = value
            }}
          />

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Visibility</span>
              <SegmentControl
                options={[
                  { value: 'account_private', label: 'Private' },
                  { value: 'tenant_shared', label: 'Shared' },
                ]}
                value={form.scope}
                onchange={(value) => {
                  form.scope = value
                }}
              />
            </div>

            {#if editingToolProfileId}
              <div>
                <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Status</span>
                <SegmentControl
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'archived', label: 'Archived' },
                  ]}
                  value={form.status}
                  onchange={(value) => {
                    form.status = value
                  }}
                />
              </div>
            {/if}
          </div>

          {#if editingToolProfileId}
            <div class="rounded-md border border-border bg-surface-0 px-3 py-2">
              <p class="text-[11px] text-text-tertiary">
                Tool profile ID:
                <span class="font-mono text-text-secondary">{editingToolProfileId}</span>
                {#if isAssistantDefaultProfile}
                  · used by the current account's assistant default mode
                {/if}
              </p>
            </div>
          {/if}
        </div>
      </SectionCard>

      <SectionCard
        title="MCP Tool Access"
        description="Toggle external MCP tools for this profile. Trusted tools run without confirmation. Untrusted tools pause for your approval during chat."
      >
        {#snippet actions()}
          <button
            type="button"
            class="text-[11px] text-text-tertiary transition-colors hover:text-text-secondary"
            disabled={isLoadingMcpTools}
            onclick={() => { editingToolProfileId ? void loadToolAccess(editingToolProfileId) : void loadAllAvailableTools() }}
          >
            {isLoadingMcpTools ? 'Loading…' : 'Refresh'}
          </button>
        {/snippet}
        {#if isLoadingMcpTools}
          <p class="py-3 text-center text-[12px] text-text-tertiary">Loading MCP tools…</p>
        {:else if mcpToolGroups.length === 0}
          <div class="rounded-md border border-dashed border-border py-3 text-center text-[12px] text-text-tertiary">
            No MCP tools discovered yet.
            <button type="button" class="text-accent-text hover:underline" onclick={() => viewStore.push({ kind: 'mcp-form' })}>
              Connect an MCP server
            </button>
            to get started.
          </div>
        {:else}
          <div class="space-y-3">
            {#each mcpToolGroups as group}
              {@const mutableTools = group.tools.filter((tool) => tool.mutable)}
              {@const mutableEnabledTools = mutableTools.filter((tool) => tool.enabled)}
              {@const hasMutableTools = mutableTools.length > 0}
              {@const allEnabled = hasMutableTools && mutableTools.every((tool) => tool.enabled)}
              {@const anyEnabled = mutableTools.some((tool) => tool.enabled)}
              {@const allTrusted =
                mutableEnabledTools.length > 0 &&
                mutableEnabledTools.every((tool) => tool.trusted)}
              <div class="rounded-md border border-border bg-surface-0">
                <div class="flex items-center gap-2 border-b border-border px-3 py-2">
                  <button
                    type="button"
                    aria-label={allEnabled ? `Unassign all tools from ${group.serverLabel}` : `Assign all tools from ${group.serverLabel}`}
                    class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {allEnabled ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'} {hasMutableTools ? '' : 'opacity-40'}"
                    disabled={!hasMutableTools}
                    onclick={() => { setServerEnabled(group, !allEnabled) }}
                  >
                    <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                  </button>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-[12px] font-medium text-text-primary">{group.serverLabel}</span>
                      <span class="text-[10px] text-text-tertiary">{group.enabledCount}/{group.tools.length} assigned</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors {anyEnabled ? '' : 'invisible'} {allTrusted ? 'border-success/30 bg-success-soft text-success-text hover:border-success/50' : 'border-warning/30 bg-warning-soft text-warning-text hover:border-warning/50'}"
                    disabled={!hasMutableTools}
                    onclick={() => { setServerTrusted(group, !allTrusted) }}
                  >
                    {#if allTrusted}
                      <svg class="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5 2.5 4v4c0 3.5 2.3 6.2 5.5 7 3.2-.8 5.5-3.5 5.5-7V4Z"/><polyline points="5.5 8 7 9.5 10.5 6"/></svg>
                      trusted
                    {:else}
                      <svg class="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5 2.5 4v4c0 3.5 2.3 6.2 5.5 7 3.2-.8 5.5-3.5 5.5-7V4Z"/></svg>
                      asks to confirm
                    {/if}
                  </button>
                  <button
                    type="button"
                    class="shrink-0 text-[10px] text-text-tertiary transition-colors hover:text-text-secondary"
                    onclick={() => viewStore.push({ kind: 'mcp-form', serverId: group.serverId })}
                  >
                    manage server
                  </button>
                </div>
                <div class="border-t border-border">
                  {#each group.tools as tool}
                    <div class="flex items-center gap-2.5 px-3 py-1.5 {tool.enabled ? '' : 'opacity-55'}">
                      <button
                        type="button"
                        aria-label={tool.enabled ? `Unassign ${tool.title}` : `Assign ${tool.title}`}
                        class="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-sm border transition-colors {tool.enabled ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'} {tool.mutable ? '' : 'opacity-40'}"
                        disabled={!tool.mutable}
                        onclick={() => { setToolEnabled(tool, !tool.enabled) }}
                      >
                        <svg class="h-1.5 w-1.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
                      </button>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[11px] text-text-secondary">{tool.title}</div>
                        {#if tool.description}
                          <div class="line-clamp-2 text-[10px] leading-relaxed text-text-tertiary">{tool.description}</div>
                        {/if}
                      </div>
                      <button
                        type="button"
                        class="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors {tool.enabled ? '' : 'invisible'} {tool.trusted ? 'border-success/30 bg-success-soft text-success-text hover:border-success/50' : 'border-warning/30 bg-warning-soft text-warning-text hover:border-warning/50'} {tool.mutable ? '' : 'opacity-40'}"
                        disabled={!tool.mutable || !tool.enabled}
                        onclick={() => { setToolTrusted(tool, !tool.trusted) }}
                      >
                        {#if tool.trusted}
                          <svg class="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5 2.5 4v4c0 3.5 2.3 6.2 5.5 7 3.2-.8 5.5-3.5 5.5-7V4Z"/><polyline points="5.5 8 7 9.5 10.5 6"/></svg>
                          trusted
                        {:else}
                          <svg class="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5 2.5 4v4c0 3.5 2.3 6.2 5.5 7 3.2-.8 5.5-3.5 5.5-7V4Z"/></svg>
                          asks to confirm
                        {/if}
                      </button>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </SectionCard>

      {#if errorMessage}
        <AlertBanner variant="error" message={errorMessage} ondismiss={() => { errorMessage = '' }} />
      {/if}
      {#if successMessage}
        <AlertBanner variant="success" message={successMessage} ondismiss={() => { successMessage = '' }} />
      {/if}

      <div class="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-border bg-bg/80 px-6 py-4 backdrop-blur-sm">
        <div class="flex items-center gap-2">
          {#if changeSummary}
            <span class="text-[11px] text-text-tertiary">{changeSummary}</span>
          {/if}
        </div>
        <ActionButton
          variant="primary"
          disabled={isSaving || !anyDirty}
          onclick={() => {
            errorMessage = ''
            successMessage = ''
            void save()
          }}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </ActionButton>
      </div>
    </form>
  {/if}
</div>
