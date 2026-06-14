# Multiagent UI Design

Last updated: 2026-03-30

Companion to `05_04_api/spec/multiagent.md`. This document covers the UI/UX layer — how tool calls, delegation, approvals, and agent activity should render in the chat interface as the backend moves from single-agent to multiagent execution.

---

## Current State

The chat UI renders assistant messages as a flat list of blocks:

```
TextBlock
ToolInteractionBlock   (expandable: header → input/output)
ToolInteractionBlock
TextBlock
```

Each `ToolInteractionBlock` has:

- a header line: icon + tool name + status badge
- an expandable panel: Input (syntax-highlighted JSON), Output, and confirmation buttons when awaiting approval
- three confirmation actions: Accept & trust, Accept once, Reject
- inline resolving feedback ("Approving…") and error recovery

This works for single-agent, sequential tool calls. It breaks under multiagent.

---

## What Multiagent Changes

### 1. Scale

An orchestrator delegates to researcher + writer. Each runs 5+ tools. The user sees 15+ flat tool blocks with no grouping. Most of this is background work the user never asked to see.

### 2. Hierarchy

Tool calls belong to different agents at different depths. A flat list erases that context. The user cannot tell which tools belong to which agent.

### 3. Concurrency

Researcher and writer run in parallel (`async_join`). Their tool calls interleave in a flat list. The user sees:

```
✓ web_search          (researcher)
✓ read_file           (writer)
✓ fetch_url           (researcher)
? send_email          (writer)       ← needs approval
✓ summarize           (researcher)
```

No visual grouping. Confusing.

### 4. Cross-agent approvals

A child agent needs tool confirmation. The approval must surface up the hierarchy to the user without losing context of which agent is asking and why. Today, approvals only exist at the top level.

---

## Design Principles

### Show the forest, not every tree

The user cares about agent-level progress, not individual tool calls inside a subagent. Completed agent work should collapse to a single summary line. Details on demand.

### Approvals are interrupts

Approvals are the only reason background work needs to surface to the user. They must be prominent regardless of which agent or depth they come from. Never bury an approval inside a collapsed group.

### Agent attribution is mandatory

When multiple agents are active, every tool call and every approval must identify which agent owns it. "send_email needs approval" is ambiguous. "writer › send_email needs approval" is not.

### Parallel work should look parallel

Concurrent delegations should render as separate groups, not interleaved tool calls. Visual separation maps to the execution model.

### Completed work compresses

Once an agent finishes, its 5-10 tool calls should collapse to one line. The user can expand to audit, but the default state after completion is compressed.

---

## Three Levels of Disclosure

### Level 1 — Agent summary (always visible)

One line per delegated agent. Shows status, tool count, duration.

```
✓ researcher  Completed · 3 tools · 1.4s
⟳ writer  Running · 2 tools
```

Collapsed by default once complete. Stays expanded while running or if a child tool needs approval.

### Level 2 — Agent's tool list (on expand)

Current ToolBlock headers, nested under the agent.

```
▼ writer  Running · 2 tools
    ✓ read_file
    ? send_email  Needs approval
```

### Level 3 — Tool detail (on deep expand)

The current ToolBlock expanded panel. Input, Output, confirmation buttons. Unchanged from today.

```
    ▼ send_email  Needs approval
      INPUT
      { "to": "demo@example.com", ... }
      [Accept & trust]  [Accept once]  [Reject]
```

---

## Resolved Decisions

Engineering answers to the open questions from the first draft. These are now binding constraints for the UI architecture.

### D1. Single SSE stream, filtered by rootRunId

One stream per active interaction. No per-child-run connections.

Critical constraint: child runs are private with `threadId = null` (multiagent.md:549). The current event stream filters by `sessionId`/`threadId`/`runId` (`domain-event-repository.ts:11`). Filtering by `threadId` alone misses all child-run events. The stream subscription must use `rootRunId` (preferred) or `sessionId` to capture root + child events together.

Implication for the UI: `connectThreadEventStream` in `chat-store.svelte.ts` currently connects by threadId. Before multiagent ships, this must accept a `rootRunId` filter option. All events — root tool calls, delegation lifecycle, child tool calls, child confirmations — arrive on one stream and are routed by `runId`.

### D2. Agent identity resolved from delegation events, not per-tool

Tool events already carry `runId` (`run-tool-execution.ts:180`, `shared/chat.ts:369`). Agent identity is NOT added to every `tool.*` event.

Instead, `delegation.started` / `child_run.created` events carry `childAgentSlug` and `childAgentName` (to be added to `delegation-service.ts:335`). The UI builds a `runId → { agentSlug, agentName }` map from these events and resolves agent attribution by looking up the tool event's `runId`.

Implication for the UI: materialize.ts must maintain a `Map<RunId, AgentIdentity>` populated from delegation events. Root-run tool events have no agent prefix (single-agent behavior). Child-run tool events get their agent name from the map.

### D3. Two waits, one user-actionable

Storage has two waits:

- **Parent wait** (`type = 'agent'`): "I am blocked on child completion." Auto-resolved when child finishes. The user never touches this.
- **Child wait** (`type = 'tool_confirmation'`): "This child tool needs approval." The user resolves this directly.

`pendingWaits` on the parent run does NOT flatten child waits. The UI discovers child approvals from `tool.confirmation_requested` events arriving on the shared SSE stream (possible because of D1 rootRunId filtering).

Implication for the UI: the chat store needs a new concept — a cross-run approval tracker. The current `pendingToolConfirmation` getter only looks at the parent run's waits. Multiagent adds child-run waits discovered from the event stream. The approval is resolved against the child run's resume endpoint (`POST /v1/runs/:childRunId/resume`), not the parent's.

The ToolBlock confirmation flow (Accept & trust / Accept once / Reject) is unchanged. What changes is which `runId` the approval targets and how the pending wait is discovered.

### D4. Delegation structure from run graph reads, not message transcripts

The parent thread transcript stays flat. Child runs are private and have no `session_messages`. DelegationBlock state is NOT persisted inside the parent message transcript.

On page load, hydration follows two paths:

1. **Thread messages** → flat blocks (text, root-level tools, `delegate_to_agent` tool calls)
2. **Run graph** → delegation tree (which agents were delegated to, their status, tool counts, durations)

DelegationBlocks are built from run graph data. Child tool detail is fetched on expand via a child-run read API.

Implication for the UI: DelegationBlock has two modes:

- **Summary** (hydrated from run graph): agent name, slug, status, tool count, duration. No child ToolBlocks. This is the collapsed view.
- **Detailed** (fetched on expand): full child ToolInteractionBlocks with input/output. Loaded lazily from a child-run detail endpoint.

During live streaming, child tool events populate the detailed view in real-time. On page reload, only the summary is available until the user expands.

### D5. Parent-level cancel only, backend cascades

The cancel button targets the root run only. One `POST /v1/runs/:rootRunId/cancel`. The backend cascades to joined child runs (multiagent.md:570). The UI shows child cancellation progress as `run.cancelled` events arrive on the stream.

No per-child cancel in v1. No UI for "cancel researcher but keep writer running."

Note: the current backend cancel is limited — foreground running runs cannot yet be cancelled (`cancel-run.ts:72`). This is a backend prerequisite, not a UI issue.

### D6. document.title badge only, no browser notifications

When a child agent needs approval and the user is in another tab, update the page title:

```
(1) Approval needed — Chat
```

When the user returns, auto-expand the relevant DelegationBlock and ToolBlock (existing `$effect` pattern). No `Notification` API, no audio, no toast outside the chat area.

---

## Approval Flow: Single-Agent vs Multiagent

### Single-agent (current, unchanged)

```
SSE: tool.confirmation_requested (runId = root)
  → chat store adds to pendingWaits
  → ToolBlock auto-expands, shows buttons
  → user clicks Accept once
  → POST /v1/runs/:rootRunId/resume
  → SSE: tool.confirmation_granted
  → ToolBlock transitions to running
```

### Multiagent (new)

```
SSE: delegation.started (runId = root, childRunId = child, childAgentSlug = "writer")
  → materialize creates DelegationBlock
  → agentMap.set(childRunId, { slug: "writer", name: "Writer" })

SSE: tool.confirmation_requested (runId = child, toolName = "send_email")
  → materialize routes to DelegationBlock.childBlocks by runId
  → cross-run approval tracker registers the pending wait
  → DelegationBlock auto-expands
  → ToolBlock inside DelegationBlock auto-expands, shows buttons
  → header shows: ? writer › send_email  Needs approval

User clicks Accept once
  → POST /v1/runs/:childRunId/resume   (child run, not parent)
  → SSE: tool.confirmation_granted (runId = child)
  → ToolBlock transitions to running
  → child run continues

SSE: child_run.completed (runId = child)
  → DelegationBlock status → completed, auto-collapses
  → parent agent wait auto-resolves (backend)
  → parent run resumes
```

Key difference: the resume targets `childRunId`, not `rootRunId`. The chat store must track which run owns each pending approval.

---

## Component Architecture

### New block type: `DelegationBlock`

Represents a `delegate_to_agent` tool call. Wraps the child agent's activity.

```typescript
interface DelegationBlock extends BaseBlock<'delegation'> {
  agentName: string
  agentSlug: string
  childRunId: RunId
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  toolCount: number
  childBlocks: ToolInteractionBlock[]   // populated from stream or lazy fetch
  childBlocksLoaded: boolean            // false = summary only, true = detail available
  duration?: number
}
```

Visual states:

| Status | Header | Default expand |
|--------|--------|----------------|
| pending | `◌ researcher  Pending` | No |
| running | `⟳ researcher  Running · 2 tools` | Yes |
| completed | `✓ researcher  Completed · 5 tools · 1.4s` | No |
| failed | `✕ researcher  Failed · 3 tools` | Yes |
| cancelled | `— researcher  Cancelled` | No |

Exception: always auto-expand if any child tool is `awaiting_confirmation`.

### Existing ToolBlock — unchanged

Leaf-level tool calls. When nested inside a DelegationBlock, the header gains agent attribution:

```
? writer › send_email  Needs approval      (inside DelegationBlock)
? send_email  Needs approval               (root-level, no DelegationBlock)
```

The attribution prefix is derived from the parent DelegationBlock's `agentName`, not from the ToolBlock itself. The ToolBlock component receives an optional `agentName` prop from its parent.

### Block type union — extended

```typescript
export type Block =
  | TextBlock
  | ThinkingBlock
  | ToolInteractionBlock
  | ArtifactBlock
  | ErrorBlock
  | DelegationBlock
```

### Materialize pipeline

Currently: `SSE events → flat Block[]`

New responsibilities:

1. **Agent map** — maintain `Map<RunId, { agentSlug: string, agentName: string }>` from `delegation.started` / `child_run.created` events
2. **Event routing** — tool events with `runId` matching a child run are routed into the corresponding DelegationBlock's `childBlocks`, not the flat root list
3. **Lifecycle tracking** — `child_run.created` → DelegationBlock status `running`; `child_run.completed` → `completed`; `run.cancelled` → `cancelled`
4. **Confirmation routing** — `tool.confirmation_requested` with a child `runId` updates the child ToolBlock inside the DelegationBlock and triggers auto-expand

### Chat store — cross-run approval tracker

Current `pendingToolConfirmation` returns the first pending wait from the root run. This must extend to include child-run waits discovered from the event stream.

New concept: `pendingApprovals: Array<{ runId, waitId, toolName, agentSlug? }>`

- Root-run approvals: `agentSlug` is null (single-agent behavior)
- Child-run approvals: `agentSlug` from the agent map

The approval resolution methods (`approvePendingWait`, `trustPendingWait`, `rejectPendingWait`) must accept a `runId` parameter to target the correct run's resume endpoint.

### Stream subscription

Current: `connectThreadEventStream(threadId)` filters by thread.

New: must support `rootRunId` filtering to capture child-run events. The backend event repository needs a `rootRunId` filter before this works (`domain-event-repository.ts:11`).

Transition path: keep `threadId` filtering for single-agent. Add `rootRunId` filtering when the backend supports it. The UI switches based on whether the active run has delegations.

### Hydration on page load

1. `GET /v1/threads/:threadId/messages` → flat message blocks (unchanged)
2. `GET /v1/runs/:rootRunId/graph` (new) → delegation tree with child run summaries
3. Materialize merges both: thread messages provide text + root tool blocks, run graph provides DelegationBlock summaries
4. On DelegationBlock expand → `GET /v1/runs/:childRunId/detail` (new) → child tool blocks with input/output

This keeps the default page load fast (no child detail fetched) while allowing drill-down.

---

## Phased UI Delivery

### Phase A — Agent attribution (before Phase 6)

Add optional `agentName` prop to ToolBlock. When present, the header shows:

```
? writer › send_email  Needs approval
```

When absent, renders as today. Zero breaking changes. Purely additive.

Also add `document.title` update when any pending approval exists.

Backend dependency: none. The prop is unused until delegation events exist.

### Phase B — Stream + materialize foundation (with Phase 6)

- Switch stream subscription to `rootRunId` filtering
- Add agent map to materialize pipeline
- Route child-run events into DelegationBlocks
- Add cross-run approval tracker to chat store
- Approval resolution targets `childRunId` when resolving child-agent waits

Backend dependency: `rootRunId` filter on event stream. `delegation.started` / `child_run.created` events with `childAgentSlug` and `childAgentName`. `child_run.completed` / `run.cancelled` events.

### Phase C — DelegationBlock component (with Phase 6)

New Svelte component. Collapsible agent group with summary header. Renders child ToolBlocks inside. Auto-expand on child approval. Auto-collapse on completion.

Backend dependency: same as Phase B.

### Phase D — Hydration + lazy detail (with Phase 6/7)

Run graph read API for delegation tree. Child-run detail API for lazy expand. Merge with thread message hydration on page load.

Backend dependency: `GET /v1/runs/:runId/graph` and `GET /v1/runs/:childRunId/detail` endpoints.

### Phase E — Parallel groups + cancel (with Phase 7)

Visual parallel grouping for concurrent DelegationBlocks. Cancel button cascades through root run only. Show child cancellation progress from stream events.

Backend dependency: worker execution, cancel cascade implementation.

---

## Backend Prerequisites (summary for engineering)

Before the UI can ship multiagent rendering, the backend must provide:

1. **rootRunId filter on the event stream** — threadId filtering misses private child runs. This is the hard blocker.

2. **Agent metadata on delegation events** — `childAgentSlug` and `childAgentName` on `delegation.started` / `child_run.created`. Currently missing from `delegation-service.ts:335`.

3. **Child-run lifecycle events on the shared stream** — `child_run.created`, `child_run.completed`, `run.cancelled` must appear in the rootRunId-filtered stream.

4. **Child tool events on the shared stream** — `tool.execution_started`, `tool.confirmation_requested`, etc. from child runs must flow through the same rootRunId-filtered stream.

5. **Run graph read endpoint** — returns the delegation tree for a root run (child runs with status, agent identity, tool counts). Needed for page-load hydration.

6. **Child-run detail endpoint** — returns tool blocks with input/output for a specific child run. Needed for lazy expand.

Items 1-4 are required for live streaming. Items 5-6 are required for page-load hydration and can follow.

---

## Summary

The current ToolBlock is correct for leaf-level tool calls and does not need further changes. The multiagent UI is an additive layer:

1. **Agent attribution** on tool headers (Phase A, no backend dependency)
2. **Stream + materialize foundation** for cross-run event routing (Phase B, needs rootRunId filter)
3. **DelegationBlock** component for grouped agent activity (Phase C, needs delegation events)
4. **Lazy hydration** from run graph + child-run detail (Phase D, needs new read endpoints)
5. **Parallel groups + cancel cascade** (Phase E, needs worker)

The ToolBlock confirmation flow (Accept & trust / Accept once / Reject with resolving state) extends to child-agent approvals with one change: the resume call targets `childRunId` instead of `rootRunId`. Everything else — keyboard shortcuts, inline feedback, error recovery — works as-is.
