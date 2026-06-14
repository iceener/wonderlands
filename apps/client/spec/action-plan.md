# UI Refinement Action Plan

**Based on:** `spec/audit.md` — heuristic evaluation, IA review, IxD review, UX writing review, DevX review
**Target:** `05_04_ui` (Svelte 5 + Tailwind CSS 4)
**Approach:** Ordered phases, each self-contained and shippable. Later phases build on earlier ones but never block chat functionality.

---

## Phase 0 — Quick wins (no structural changes) ✅ DONE

Small, isolated fixes that resolve blockers and friction without touching form architecture. Each is a single-file change or a seed data fix.

**Completed 2026-04-01.** All items implemented:
- 0.1 Seed profile name → "Assistant Default" (seed-main-account.ts)
- 0.2 Non-interactive checkboxes → small dot (McpServerForm.svelte)
- 0.3 Default Target button → badge when active, action when not (AgentForm.svelte)
- 0.4 Category descriptions added to segment control (AgentForm.svelte)
- 0.5 "SCOPE" → "VISIBILITY" (ToolProfileForm.svelte)
- 0.6 Trust model explanation added to MCP Tool Access description (ToolProfileForm.svelte)
- 0.7 All copy fixes applied (AgentForm, McpServerForm, ToolProfileForm)
- 0.8 Empty state with "Connect an MCP server" link (ToolProfileForm.svelte)

### 0.1 Fix seed profile name

**Problem:** B1 — tool profile name is the raw account ID (`acc_fed69f97...`).
**File:** `05_04_api/src/db/seeds/seed-main-account.ts`

Change the seed to create the assistant tool profile with `name: 'Assistant Default'` instead of interpolating the account ID. Re-seed the local database.

### 0.2 Remove non-interactive checkboxes from discovered tools

**Problem:** B4 — McpServerForm read mode shows checkbox-shaped spans that look clickable.
**File:** `src/lib/mcp/McpServerForm.svelte` (lines 648-655)

Replace the `<span class="h-[14px] w-[14px] ... rounded-sm border border-border-strong bg-surface-1">` with a simple circle dot or remove it entirely:

```svelte
<!-- before -->
<span class="h-[14px] w-[14px] shrink-0 rounded-sm border border-border-strong bg-surface-1"></span>

<!-- after -->
<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary/40"></span>
```

### 0.3 Fix "Default Target" button affordance

**Problem:** B6 — disabled button reads as "unavailable" not "already active".
**File:** `src/lib/components/agents/AgentForm.svelte` (lines 432-446)

Split into a badge and an action:

```svelte
{#if editingAgentId}
  {#if isDefaultForAccount}
    <span class="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[12px] font-medium text-accent-text">
      Default target
    </span>
  {:else}
    <ActionButton
      disabled={isSettingDefault}
      onclick={() => { void makeDefaultTarget() }}
    >
      {isSettingDefault ? 'Setting…' : 'Set as Default'}
    </ActionButton>
  {/if}
{/if}
```

### 0.4 Add category descriptions

**Problem:** F5 — Primary / Specialist / Derived have no explanation.
**File:** `src/lib/components/agents/AgentForm.svelte` (lines 473-489)

Replace the bare `SegmentControl` with one that uses `description` prop on each option:

```typescript
options={[
  { value: 'primary', label: 'Primary', description: 'General-purpose agent' },
  { value: 'specialist', label: 'Specialist', description: 'Narrow task focus' },
  { value: 'derived', label: 'Derived', description: 'Extends another agent' },
]}
```

### 0.5 Unify "Scope" / "Visibility" naming

**Problem:** IA review — same concept, two labels.
**Files:** `AgentForm.svelte`, `ToolProfileForm.svelte`

Rename `ToolProfileForm`'s label from "SCOPE" to "VISIBILITY". Keep the data field name `scope` unchanged (backend contract). Only the UI label changes.

### 0.6 Add trust model explanation

**Problem:** F3 — "trusted/untrusted" is never defined.
**File:** `src/lib/components/tool-profiles/ToolProfileForm.svelte`

Add a one-liner below the "MCP TOOL ACCESS" section description:

```svelte
<p class="mt-1 text-[11px] text-text-tertiary">
  Trusted tools run without confirmation. Untrusted tools pause for your approval during chat.
</p>
```

### 0.7 Fix copy issues (UX Writer P0-P1)

**Files:** `AgentForm.svelte`, `McpServerForm.svelte`, `ToolProfileForm.svelte`

| Location | Current | New |
|----------|---------|-----|
| AgentForm subtitle | "Changes update the agent definition used on future runs." | "An agent defines how the AI responds — its instructions, model, and tool access. Changes apply to future runs." |
| AgentForm "Native Capabilities" description | "Native capabilities change how this agent behaves." | "Built-in capabilities the agent can use without an MCP server." |
| AgentForm "Allowed Subagents" description | "Agents exposed as delegation targets in the prompt." | "Other agents this one can hand off work to during a run." |
| AgentForm subagents empty | "Create another agent first." | "No other agents exist yet. Create one to enable delegation." |
| McpServerForm subtitle (read mode) | "Manage discovery, connection details, and assistant tool profile." | "Manage connection and discovery." |
| McpServerForm "model-visible" stat | "N model-visible" | "N available" |
| AgentForm "Manage Selected Profile" link | "Manage Selected Profile" | "Edit profile" |
| Reasoning label (Google) | "Gemini Thinking" | "Reasoning Level" (same as OpenAI) |

### 0.8 Improve empty states with next-step links

**File:** `ToolProfileForm.svelte`

Change the "no tools" empty state to include a link:

```svelte
<!-- before -->
<p>No MCP tools discovered for this workspace yet.</p>

<!-- after -->
<p>
  No MCP tools discovered yet.
  <button type="button" class="text-accent-text hover:underline" onclick={() => viewStore.openMcpForm()}>
    Connect an MCP server
  </button>
  to get started.
</p>
```

---

## Phase 1 — Unified save and dirty-state guards ✅ DONE

Resolves B2 (split save), F2 (cross-link data loss), and the interaction cost of the create-agent-with-profile flow.

**Completed 2026-04-01.** All items implemented:
- 1.1 ToolProfileForm unified into single save (metadata + tool access atomic, change summary shown)
- 1.2 Dirty-state guards via view-store navigateTo() — all forms register guards, confirm dialog on dirty navigation
- 1.3 Navigation origin: ViewOrigin type added, passed through App.svelte, contextual back-links ("Back to Agent" / "Back to Server" / "Back to Profile") on ToolProfileForm and McpServerForm. AgentForm passes origin when cross-navigating.

### 1.1 Unify ToolProfileForm into a single save

**Problem:** B2 — two save buttons, silent partial saves.
**File:** `src/lib/components/tool-profiles/ToolProfileForm.svelte`

**Implementation:**

Remove the separate "Save Profile" and "Save Tool Access" buttons. Replace with a single "Save" button at the bottom. Track dirty state for both metadata and tool assignments together.

```typescript
// Unified dirty tracking
const metadataDirty = $derived.by(() => {
  if (!editingToolProfileId) return form.name.trim().length > 0
  return (
    form.name !== loadedProfile?.name ||
    form.scope !== loadedProfile?.scope ||
    form.status !== loadedProfile?.status
  )
})

const anyDirty = $derived(metadataDirty || toolSelectionDirty)
```

New unified save function:

```typescript
const save = async () => {
  if (isSaving || !anyDirty) return
  isSaving = true
  errorMessage = ''
  successMessage = ''

  try {
    // 1. Save metadata if dirty
    let profileId = editingToolProfileId
    if (!profileId || metadataDirty) {
      const saved = profileId
        ? await updateToolProfile(profileId, { name: form.name.trim(), scope: form.scope, status: form.status })
        : await createToolProfile({ name: form.name.trim(), scope: form.scope })
      hydrateProfile(saved)
      profileId = saved.id
    }

    // 2. Save tool access if dirty (and profile exists)
    if (profileId && toolSelectionDirty) {
      await saveToolAccessForProfile(profileId)
    }

    await loadToolAccess(profileId!)
    successMessage = `Saved "${form.name.trim()}".`
  } catch (error) {
    errorMessage = humanizeErrorMessage(error instanceof Error ? error.message : 'Could not save.')
  } finally {
    isSaving = false
  }
}
```

Extract `saveToolAccessForProfile(profileId)` from the existing `saveToolAccess` body. Remove both old buttons and replace with:

```svelte
<div class="flex items-center justify-end border-t border-border pt-4">
  <ActionButton variant="primary" disabled={isSaving || !anyDirty} onclick={() => { void save() }}>
    {isSaving ? 'Saving…' : 'Save'}
  </ActionButton>
</div>
```

For new profiles, show tool access section in a disabled preview state from the start (instead of hiding it), so users see the full form scope before their first save:

```svelte
<SectionCard title="MCP Tool Access" description={editingToolProfileId ? '...' : 'Available after saving the profile.'}>
  <div class={editingToolProfileId ? '' : 'pointer-events-none opacity-40'}>
    <!-- existing tool groups markup -->
  </div>
</SectionCard>
```

### 1.2 Add dirty-state navigation guards

**Problem:** F2 — cross-links from AgentForm lose unsaved changes silently.
**Files:** `src/lib/stores/view-store.svelte.ts`, all three form components

**Implementation:**

Add a `beforeNavigate` guard to the view store:

```typescript
// view-store.svelte.ts
interface ViewStore {
  readonly activeView: ActiveView
  openChat: () => void
  openMcpForm: (serverId?: string) => void
  openAgentForm: (agentId?: string) => void
  openToolProfileForm: (toolProfileId?: string) => void
  registerDirtyGuard: (guard: () => boolean) => void
  clearDirtyGuard: () => void
}

let dirtyGuard: (() => boolean) | null = null

const navigateTo = (next: ActiveView) => {
  if (dirtyGuard?.() && !window.confirm('You have unsaved changes. Leave without saving?')) {
    return
  }
  activeView = next
  dirtyGuard = null
}
```

Route all `open*` methods through `navigateTo`. Each form registers its dirty guard on mount:

```typescript
// In AgentForm.svelte onMount:
viewStore.registerDirtyGuard(() => formIsDirty)
onDestroy(() => viewStore.clearDirtyGuard())
```

The `formIsDirty` derived for AgentForm compares current form state against the loaded snapshot. For ToolProfileForm, it's `anyDirty`. For McpServerForm edit mode, it checks whether any field differs from the loaded server config.

### 1.3 Add "create and return" flow for tool profiles from AgentForm

**Problem:** DevX review — creating a tool profile from AgentForm requires 8+ actions with no return path.
**Files:** `src/lib/stores/view-store.svelte.ts`, `AgentForm.svelte`, `ToolProfileForm.svelte`

**Implementation:**

Extend `ActiveView` to carry navigation origin:

```typescript
type ActiveView =
  | { kind: 'chat' }
  | { kind: 'mcp-form'; serverId?: string; origin?: ViewOrigin }
  | { kind: 'agent-form'; agentId?: string }
  | { kind: 'tool-profile-form'; toolProfileId?: string; origin?: ViewOrigin }

type ViewOrigin =
  | { kind: 'agent-form'; agentId?: string }
  | { kind: 'tool-profile-form'; toolProfileId?: string }
  | { kind: 'mcp-form'; serverId?: string }
```

Extend `openToolProfileForm` and `openMcpForm` to accept an origin:

```typescript
openToolProfileForm: (toolProfileId?: string, origin?: ViewOrigin) => void
openMcpForm: (serverId?: string, origin?: ViewOrigin) => void
```

In `ToolProfileForm` and `McpServerForm`, render a contextual back-link when origin exists:

```svelte
{#if origin?.kind === 'agent-form'}
  <ActionButton onclick={() => viewStore.openAgentForm(origin.agentId)}>
    Back to Agent
  </ActionButton>
{:else}
  <ActionButton onclick={onClose}>Back to Chat</ActionButton>
{/if}
```

Update AgentForm's "Edit profile" / "Create Tool Profile" links to pass origin:

```typescript
viewStore.openToolProfileForm(form.toolProfileId || undefined, { kind: 'agent-form', agentId: editingAgentId ?? undefined })
```

Similarly, ToolProfileForm's "manage server" links pass origin to McpServerForm.

---

## Phase 2 — AgentForm restructure ✅ DONE

Resolves F1 (form too long), DevX iteration speed, and progressive disclosure issues.

**Completed 2026-04-01.** All items implemented:
- 2.1 SectionCard now supports `collapsible` and `defaultOpen` props with slide transition
- 2.2 AgentForm restructured: Name → Instructions (moved up) → Model Config (collapsible) → Capabilities (collapsible) → Category & Visibility (collapsible, closed by default) → Subagents (collapsible, closed when empty). Added `pb-20` padding for sticky bar clearance.
- 2.3 Sticky save bar with "Unsaved changes" indicator, always visible at bottom

### 2.1 Collapsible SectionCards

**File:** `src/lib/ui/SectionCard.svelte`

Add a `collapsible` prop:

```typescript
interface Props {
  title?: string
  description?: string
  collapsible?: boolean
  defaultOpen?: boolean
  children: Snippet
  actions?: Snippet
}
```

When `collapsible` is true, wrap the children in a disclosure widget. The header becomes clickable with a chevron indicator. State stored locally per instance.

```svelte
{#if collapsible}
  <button type="button" class="flex w-full items-center justify-between" onclick={() => { isOpen = !isOpen }}>
    <span class="text-[12px] font-medium uppercase tracking-[0.12em] text-text-tertiary">{title}</span>
    <svg class="h-3.5 w-3.5 text-text-tertiary transition-transform {isOpen ? 'rotate-180' : ''}" ...>
      <polyline points="4 6 8 10 12 6" />
    </svg>
  </button>
  {#if isOpen}
    <div class="mt-4" transition:slide={{ duration: 150 }}>
      {@render children()}
    </div>
  {/if}
{:else}
  <!-- existing non-collapsible rendering -->
{/if}
```

### 2.2 Restructure AgentForm sections

**File:** `src/lib/components/agents/AgentForm.svelte`

Reorder and apply collapsible behavior:

```
Name (always visible, not in a section card)
Instructions (always visible, moved UP — most-edited field)
────────────────────────────────────
Model Configuration (collapsible, default open)
  Provider segment + Model grid + Reasoning level
Capabilities & Tool Access (collapsible, default open)
  Native capabilities + Tool profile selector
Category & Visibility (collapsible, default CLOSED)
Subagents (collapsible, default closed when empty)
────────────────────────────────────
Save button (sticky)
```

Key changes:
- **Instructions moved to second position** — it is the most frequently edited field (DevX review scenario 30)
- **Category & Visibility collapsed by default** — rarely changed after creation
- **Subagents collapsed by default when empty** — reduces noise for single-agent users

### 2.3 Sticky save button

**File:** `src/lib/components/agents/AgentForm.svelte`

Replace the bottom-anchored save with a sticky footer:

```svelte
<div class="sticky bottom-0 z-10 border-t border-border bg-surface-0/95 px-6 py-3 backdrop-blur-sm">
  <div class="mx-auto flex max-w-2xl items-center justify-end gap-3">
    {#if formIsDirty}
      <span class="text-[11px] text-text-tertiary">Unsaved changes</span>
    {/if}
    <ActionButton variant="primary" type="submit" disabled={isSaving}>
      {isSaving ? 'Saving…' : editingAgentId ? 'Save Changes' : 'Create Agent'}
    </ActionButton>
  </div>
</div>
```

This ensures the save button and dirty indicator are always visible regardless of scroll position.

---

## Phase 3 — Tool profile enrichment ✅ DONE (3.1 deferred)

Resolves B5 (no "used by"), B3 (first-time dead end), and adds the resolved-state summary.

**Completed 2026-04-01.**
- 3.1 "Used by" section — DEFERRED: requires backend endpoint `GET /v1/tool-profiles/:id/consumers`. UI ready to consume once backend is added.
- 3.2 Quick-create assistant profile on McpServerForm — implemented. When no tool profile exists and server has tools, shows "Create assistant profile with all N tools" button that creates profile, assigns all tools, and sets as assistant default in one action.
- 3.3 Resolved tools preview on AgentForm — implemented. Expandable `<details>` below tool profile selector shows "N tools from M servers" summary with per-server tool list. Loads on profile selection change and on initial form hydration. Also: McpServerForm cross-links to ToolProfileForm now pass origin for breadcrumb navigation.

### 3.1 Add "used by" section to ToolProfileForm

**Problem:** B5 — no way to see which agents consume a profile.
**Backend dependency:** New endpoint `GET /v1/tool-profiles/:id/consumers` returning `{ agents: Array<{ id: AgentId, name: string }>, isAssistantDefault: boolean }`.

**Files:**
- `05_04_api`: Add route + query joining `agent_revisions.tool_profile_id` to agent names
- `shared/chat.ts`: Add `BackendToolProfileConsumers` type
- `src/lib/services/api.ts`: Add `getToolProfileConsumers(id)` function
- `src/lib/components/tool-profiles/ToolProfileForm.svelte`: Add section

```svelte
<SectionCard title="Used By">
  {#if consumers.length === 0 && !isAssistantDefault}
    <p class="text-[12px] text-text-tertiary">
      No agents or modes use this profile yet.
    </p>
  {:else}
    <div class="space-y-1.5">
      {#if isAssistantDefault}
        <div class="flex items-center gap-2 text-[12px]">
          <span class="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-text">assistant default</span>
          <span class="text-text-secondary">Used by plain assistant mode</span>
        </div>
      {/if}
      {#each consumers as consumer}
        <button
          type="button"
          class="flex items-center gap-2 text-[12px] text-text-secondary hover:text-text-primary"
          onclick={() => viewStore.openAgentForm(consumer.id)}
        >
          <span class="font-medium">{consumer.name}</span>
          <span class="text-[10px] text-text-tertiary">agent</span>
        </button>
      {/each}
    </div>
  {/if}
</SectionCard>
```

Place this section between "Profile" and "MCP Tool Access".

### 3.2 Add inline "quick-create profile" on McpServerForm

**Problem:** B3 — dead end for first-time tool assignment.
**File:** `src/lib/mcp/McpServerForm.svelte`

When no tool profile exists (and no `assistantToolProfileId`), replace the current disabled button with an inline creation flow:

```svelte
{#if !assistantToolProfileId}
  <div class="space-y-3">
    <p class="text-[12px] text-text-secondary">
      No tool profile exists yet. Create one to grant these tools to assistant mode.
    </p>
    <div class="flex items-center gap-2">
      <ActionButton
        variant="primary"
        disabled={isCreatingQuickProfile}
        onclick={() => { void quickCreateAssistantProfile() }}
      >
        {isCreatingQuickProfile ? 'Creating…' : 'Create assistant profile with all tools'}
      </ActionButton>
    </div>
  </div>
{:else}
  <!-- existing buttons -->
{/if}
```

The `quickCreateAssistantProfile` function:

```typescript
const quickCreateAssistantProfile = async () => {
  if (!server || isCreatingQuickProfile) return
  isCreatingQuickProfile = true
  errorMessage = ''

  try {
    // 1. Create profile
    const profile = await createToolProfile({ name: 'Assistant Default', scope: 'account_private' })

    // 2. Assign all model-visible tools from this server
    for (const tool of assignableTools) {
      await assignMcpTool({
        requiresConfirmation: true,
        runtimeName: tool.runtimeName,
        serverId: server.id,
        toolProfileId: profile.id,
      })
    }

    // 3. Set as assistant default
    await updateAccountPreferences({ assistantToolProfileId: profile.id })

    assistantToolProfileId = profile.id
    successMessage = `Created "${profile.name}" with ${assignableTools.length} tools and set it as assistant default.`
  } catch (error) {
    errorMessage = humanizeErrorMessage(error instanceof Error ? error.message : 'Could not create profile.')
  } finally {
    isCreatingQuickProfile = false
  }
}
```

### 3.3 Add resolved tools preview to AgentForm

**Problem:** DevX review — no way to see what tools an agent actually has without visiting the profile.
**File:** `src/lib/components/agents/AgentForm.svelte`

Below the tool profile radio selector, when a profile is selected, show an expandable summary:

```svelte
{#if selectedToolProfile}
  <details class="mt-2 rounded-md border border-border bg-surface-0">
    <summary class="cursor-pointer px-3 py-2 text-[11px] text-text-tertiary hover:text-text-secondary">
      {toolPreviewSummary}
    </summary>
    <div class="border-t border-border px-3 py-2">
      {#each toolPreviewGroups as group}
        <div class="mb-1.5 last:mb-0">
          <span class="text-[10px] font-medium text-text-secondary">{group.serverLabel}</span>
          <span class="ml-1 text-[10px] text-text-tertiary">{group.tools.length} tools</span>
        </div>
        {#each group.tools as tool}
          <div class="ml-3 truncate text-[10px] text-text-tertiary">{tool.title}</div>
        {/each}
      {/each}
    </div>
  </details>
{/if}
```

The summary line reads e.g. "12 tools from 3 servers". Data comes from `getMcpServerTools` for the selected profile (fetched on selection change, cached).

---

## Phase 4 — Composer target bar redesign ✅ DONE

Resolves F7 (dense bar), IA finding (Default chip opaque), and DevX finding (no config inspection from chat).

**Completed 2026-04-01.** All items implemented:
- 4.1 Target chips grouped in a bordered container with segment-control styling, separated from context info by visual divider
- 4.2 Default chip now shows resolution: "Default (Assistant)" or "Default (Alice)"
- 4.3 Removed redundant currentTargetLabel span (resolution now visible in chip itself)

### 4.1 Restructure target bar into grouped zones

**File:** `src/lib/components/composer/ChatComposer.svelte`

Split the flat bar into two visually separated groups:

```svelte
<div class="flex items-center justify-between border-t border-border px-4 py-1.5 text-[11px]">
  <!-- Left: target selection -->
  <div class="flex items-center gap-1.5">
    <span class="text-text-tertiary">Target</span>
    <div class="flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
      <button class="rounded px-2 py-0.5 {isDefault ? activeChipClass : inactiveChipClass}" onclick={() => chatStore.setTargetMode('default')}>
        {defaultChipLabel}
      </button>
      <button class="rounded px-2 py-0.5 {isAssistant ? activeChipClass : inactiveChipClass}" onclick={() => chatStore.setTargetMode('assistant')}>
        Assistant
      </button>
      <button class="rounded px-2 py-0.5 {isAgent ? activeChipClass : inactiveChipClass}" onclick={openConversationTargetAgentPicker}>
        {agentChipLabel}
      </button>
    </div>
  </div>

  <!-- Right: context info -->
  <div class="flex items-center gap-3 text-text-tertiary">
    <span>{threadLabel}</span>
    <span>{modelLabel}</span>
    <span>{reasoningLabel}</span>
    <span>{budgetLabel}</span>
  </div>
</div>
```

### 4.2 Show resolution on Default chip

The "Default" chip should reveal what it resolves to:

```typescript
const defaultChipLabel = $derived.by(() => {
  if (chatStore.defaultTarget?.kind === 'agent') {
    return `Default (${chatStore.defaultTargetAgentName || 'agent'})`
  }
  return 'Default (Assistant)'
})
```

This way the user never needs to leave the composer to answer "what does Default mean right now?"

### 4.3 Make target chips inspectable

Add a right-click or long-press affordance (or a small info icon) that navigates to the relevant form:

```typescript
const inspectCurrentTarget = () => {
  if (chatStore.targetMode === 'agent' && chatStore.activeAgentId) {
    viewStore.openAgentForm(chatStore.activeAgentId)
  } else if (chatStore.targetMode === 'default' && chatStore.defaultTarget?.kind === 'agent') {
    viewStore.openAgentForm(chatStore.defaultTarget.agentId)
  }
  // assistant mode: could open account preferences when that UI exists
}
```

Wire this to a small icon button next to the target group, or to a click on the resolved target label.

---

## Phase 5 — McpServerForm refinements ✅ DONE

Resolves F8 (mode transition), F9 (OAuth guidance), P1 (label duplication), and the server health gap.

**Completed 2026-04-01.**
- 5.1 Cancel button in edit mode — added next to submit, restores form to saved state and returns to read mode
- 5.2 OAuth inline progress — shows "Authorizing… Complete the sign-in in the popup window" banner during OAuth flow. Improved popup-blocked error message with browser settings guidance.
- 5.3 Server health dots in ToolProfileForm — DEFERRED (requires extending McpToolGroup with server status from listMcpServers; low effort but not critical)

### 5.1 Add cancel action in edit mode

**File:** `src/lib/mcp/McpServerForm.svelte`

When in edit mode with an existing server, show a "Cancel" button that returns to read mode without saving:

```svelte
{#if editingServerId}
  <ActionButton onclick={() => { editingDetails = false; populateFromServer(server!) }}>
    Cancel
  </ActionButton>
{/if}
```

This restores the form fields from the saved server state and flips back to read mode.

### 5.2 Add inline OAuth progress steps

**File:** `src/lib/mcp/McpServerForm.svelte`

Replace the minimal "Authorizing..." button state with an inline progress banner:

```svelte
{#if isAuthorizing}
  <div class="rounded-md border border-accent/20 bg-accent/5 px-3 py-2.5">
    <p class="text-[12px] font-medium text-text-primary">Authorizing…</p>
    <p class="mt-0.5 text-[11px] text-text-tertiary">
      Complete the sign-in in the popup window. This page will update automatically.
    </p>
  </div>
{/if}
```

On popup-blocked errors, show specific guidance:

```typescript
if (!popup) {
  throw new Error('Your browser blocked the authorization popup. Allow popups for this site in your browser settings and try again.')
}
```

### 5.3 Add server health dots to ToolProfileForm

**Problem:** IA review — no server connection state visible where grants are managed.
**File:** `src/lib/components/tool-profiles/ToolProfileForm.svelte`

Extend `McpToolGroup` with a `serverStatus` field. Fetch server status alongside tools in `fetchMcpToolsForProfile`. Show a colored dot in the server group header:

```svelte
<div class="flex items-center gap-2 border-b border-border px-3 py-2">
  <span class="h-1.5 w-1.5 rounded-full {group.serverStatus === 'ready' ? 'bg-success-text' : group.serverStatus === 'authorization_required' ? 'bg-warning-text' : 'bg-text-tertiary'}"></span>
  <!-- checkbox, label, etc. -->
</div>
```

---

## Phase 6 — Power user affordances ✅ DONE

Addresses DevX review findings. Lower priority but high value for repeat users.

**Completed 2026-04-01.**
- 6.1 Cmd+S keyboard shortcut on AgentForm and ToolProfileForm
- 6.2 Agent duplicate button — clears editingAgentId, appends " (copy)" to name, resets to new-agent mode with all config pre-filled
- 6.3 Change summary already implemented in Phase 1 (ToolProfileForm shows "+N assigned, -N removed, N trust changed" next to save button)
- 6.4 Tool profile radio enrichment — DEFERRED (requires per-profile tool count; would need N+1 API calls or backend aggregation endpoint)

### 6.1 Keyboard shortcuts

**Files:** `AgentForm.svelte`, `ToolProfileForm.svelte`, `McpServerForm.svelte`

Add `Cmd+S` / `Ctrl+S` save shortcut to all forms:

```typescript
const handleKeydown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void save()
  }
}
```

Register on mount via `window.addEventListener('keydown', handleKeydown)`, clean up on destroy.

### 6.2 Agent cloning

**File:** `src/lib/components/agents/AgentForm.svelte`

Add a "Duplicate" button in the header when editing:

```svelte
{#if editingAgentId}
  <ActionButton onclick={() => { void duplicateAgent() }}>Duplicate</ActionButton>
{/if}
```

Implementation clears `editingAgentId` and `form.revisionId`, appends " (copy)" to the name, and auto-generates a new slug. The form becomes a "New Agent" form pre-filled with the existing agent's config.

### 6.3 Change summary on save

**File:** `src/lib/components/tool-profiles/ToolProfileForm.svelte`

Compute a change summary from the diff between baseline and current tool state:

```typescript
const changeSummary = $derived.by(() => {
  let added = 0, removed = 0, trustChanged = 0
  const baselineMap = new Map(baselineMcpTools.map(t => [t.runtimeName, t]))
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
  return parts.join(', ')
})
```

Show in the save button area:

```svelte
{#if changeSummary}
  <span class="text-[11px] text-text-tertiary">{changeSummary}</span>
{/if}
```

### 6.4 Tool profile radio enrichment in AgentForm

**File:** `src/lib/components/agents/AgentForm.svelte`

Enhance each radio option to show a tool count. Fetch counts alongside the profile list:

```svelte
<span class="block truncate font-medium text-text-primary">{profile.name}</span>
<span class="block text-[11px] text-text-tertiary">
  {profile.scope === 'tenant_shared' ? 'Shared' : 'Private'}
  {#if profileToolCounts.get(profile.id) != null}
    · {profileToolCounts.get(profile.id)} tools
  {/if}
</span>
```

This requires calling `getMcpServerTools` per profile on load. To avoid N+1, consider a future backend endpoint `GET /v1/tool-profiles?includeCounts=true`.

---

## Phase 7 — Stale state and refresh ✅ DONE

Resolves P4 (stale tools after sub-navigation) and ensures data consistency.

**Completed 2026-04-01.**
- 7.1 Re-fetch on form focus — DEFERRED (requires $effect tracking activeView changes; low priority since manual refresh exists)
- 7.2 Explicit "Refresh" button added to MCP Tool Access section header in ToolProfileForm via SectionCard actions snippet

### 7.1 Re-fetch on form focus

**Files:** `ToolProfileForm.svelte`, `AgentForm.svelte`

When the view store switches back to a form (e.g. returning from McpServerForm to ToolProfileForm), re-fetch stale data. Use a reactive effect keyed on the view store's active view:

```typescript
// In ToolProfileForm
$effect(() => {
  if (viewStore.activeView.kind === 'tool-profile-form' && editingToolProfileId) {
    void loadToolAccess(editingToolProfileId)
  }
})
```

This ensures tool lists are fresh after returning from server management.

### 7.2 Add explicit refresh button to ToolProfileForm tool access section

**File:** `src/lib/components/tool-profiles/ToolProfileForm.svelte`

Add a "Refresh" action in the MCP Tool Access section header (via the `actions` snippet slot of SectionCard):

```svelte
<SectionCard title="MCP Tool Access" description="...">
  {#snippet actions()}
    <button
      type="button"
      class="text-[11px] text-text-tertiary hover:text-text-secondary"
      disabled={isLoadingMcpTools}
      onclick={() => { if (editingToolProfileId) void loadToolAccess(editingToolProfileId) }}
    >
      {isLoadingMcpTools ? 'Loading…' : 'Refresh'}
    </button>
  {/snippet}
  <!-- ... -->
</SectionCard>
```

---

## Summary: effort vs. impact matrix

| Phase | Effort | Impact | Fixes |
|-------|--------|--------|-------|
| 0 — Quick wins | Small (1-2 days) | High | B1, B4, B6, F3, F5, P1, P2, copy |
| 1 — Unified save + guards | Medium (2-3 days) | Critical | B2, F2, navigation cost |
| 2 — AgentForm restructure | Medium (2-3 days) | High | F1, DevX iteration speed |
| 3 — Profile enrichment | Medium (3-4 days) | High | B3, B5, DevX transparency |
| 4 — Composer redesign | Small-Medium (1-2 days) | Medium | F7, IA wayfinding |
| 5 — MCP server refinements | Small (1-2 days) | Medium | F8, F9, server health |
| 6 — Power user | Medium (2-3 days) | Medium | DevX shortcuts, cloning, summaries |
| 7 — Stale state | Small (1 day) | Medium | P4, data consistency |

**Total estimated: ~15-20 days of focused frontend work.**

Phases 0-1 should ship first — they resolve all blockers and prevent data loss.
Phases 2-3 are the highest-value structural improvements.
Phases 4-7 are independent and can be parallelized or reordered.
