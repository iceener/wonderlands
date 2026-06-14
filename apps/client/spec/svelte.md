# Svelte 5 Chat Stability Plan

**Target:** `05_04_ui`  
**Area:** chat transcript, optimistic submits, streaming assistant lane, event replay, row identity  
**Purpose:** make the chat UI correct and stable under Svelte 5 by fixing state ownership, keyed rendering, and live/durable handoff rules.

---

## Core Insight

The backend is not the problem.

The frontend instability comes from one architectural mistake:

- we treat `messages` as both **domain truth** and **render truth**

That single decision caused nearly all observed bugs:

- old assistant rows re-animating
- optimistic user rows blinking on backend confirmation
- durable and live rows fighting for the same identity
- late terminal events from old runs killing the current lane
- keyed `{#each}` remount cascades

For this app, the winning design is:

- **durable transcript is one state domain**
- **optimistic rows are another**
- **live assistant execution is a third**
- **rendered rows are only a projection**

That is the main Svelte 5 lesson for our case.

---

## Implemented First Slice

These fixes are now in the app:

- optimistic user messages keep a stable render key through `tmp:* -> msg_*` confirmation
- durable assistant rows inherit live-lane identity through a **per-message** stable key map, not a global handoff override
- late terminal events from an older run no longer finalize a newer unbound live lane
- SSE event batches now coalesce projected-message rebuilds at the store level

What is intentionally true now:

- durable message ids can change from backend reconciliation, but their render identity does not
- live assistant rows are still ephemeral, but only the matching durable assistant row may take over their visual continuity
- old assistant rows no longer receive newer live keys

---

## The 5 Non-Negotiable Invariants

These are the rules that should drive all implementation decisions.

### 1. Transcript truth is durable-only

The durable thread transcript comes from:

- `GET /threads/:id/messages`
- durable transcript events like `message.posted`

It does **not** come from:

- live SSE deltas
- run snapshots
- optimistic submit state

### 2. One submit creates one live lane

A submit creates exactly one root live assistant lane.

That lane may later bind to:

- `interaction.runId`
- `run.created`

But it must never be hijacked by unrelated events.

### 3. Row keys must represent row identity, not transport state

Keys are not a convenience field. In Svelte they define component lifetime.

For our app:

- durable transcript row key = durable row identity
- optimistic row key = local submit identity
- live assistant row key = live lane identity

No row may permanently inherit another row’s key.

### 4. Foreign terminal events must be ignored

If the current live lane belongs to run `B`, then:

- `run.completed` for run `A`
- `run.failed` for run `A`
- `run.cancelled` for run `A`

must not affect the live lane for run `B`.

This is the correctness rule that matters most.

### 5. Projection must be pure

The rendered message list must be a pure function of:

- durable transcript
- optimistic rows
- live assistant lane

Do not patch the rendered list in place from multiple sources.

---

## What Svelte 5 Is Telling Us

Svelte 5 is not causing the bugs. It is exposing them clearly.

### Why keyed rows are unforgiving

In a keyed `{#each}`:

- same key => same component instance
- different key => destroy and recreate component instance

That means any accidental key mutation causes:

- blink
- lost local row state
- typewriter restart
- iframe remount
- hover/action state reset

### Why local row state is risky when identity is wrong

Components like:

- `MessageCard.svelte`
- `BlockRenderer.svelte`

hold local state such as:

- `streamSeen`
- `messageWasStreaming`
- completed text latches
- action bar state

That state is safe only when the key truly means “same visual row”.

### Why `$effect` cannot save a broken ownership model

Effects are fine for:

- subscriptions
- scroll side effects
- dev logging

Effects are not the right place to synchronize:

- transcript refresh
- live SSE state
- optimistic submits
- recovery snapshots

If the ownership model is wrong, more `$effect` logic only hides the bug.

---

## The Specific Anti-Patterns In Our Current Code

These are the patterns we should actively eliminate.

### Anti-pattern 1: one mutable mixed `messages` array

Current shape:

- durable transcript rows
- optimistic rows
- live assistant rows

all end up in the same mutable `state.messages`.

That means:

- transcript refresh rewrites the same list that SSE is mutating
- recovery code fights with optimistic state
- list rendering becomes the accidental source of truth

### Anti-pattern 2: key mutation on identity transitions

Examples we have already seen:

- `tmp:* -> msg_*` for optimistic user message confirmation
- `live:* -> msg_*` for assistant handoff

This causes real remounts in Svelte, not just data updates.

### Anti-pattern 3: active run inferred too loosely

The current logic can still do versions of:

- “if we do not have an active run, accept the run id from this event”

That is unsafe.

For this app, run ownership must be explicit, not inferred from whichever event arrives first.

### Anti-pattern 4: durable rows temporarily acting live

A durable assistant row should never become the current live lane just because:

- it is the latest assistant row
- it shares a run id
- it inherited a temporary key

Historical transcript must stay historical.

### Anti-pattern 5: full projection on every delta

Rebuilding the full projected row list on every `stream.delta` is wasteful.

It may not always be the root bug, but it increases:

- churn
- remount risk
- debug difficulty

---

## The Right Mental Model For Our App

The best model for our case is:

### 1. Durable transcript

“What the thread now officially contains.”

This is backend truth.

### 2. Optimistic user row

“What the user just sent, before durable confirmation fully lands.”

This is local UI truth.

### 3. Live assistant lane

“What the current root run is doing right now.”

This is execution truth.

### 4. Render rows

“What we want to show right now.”

This is only a projection of the three domains above.

This is the structure that fits both:

- our backend event model
- Svelte 5’s keyed rendering model

---

## The Right File Structure

We do **not** need many competing stores.

We need:

- one orchestrating chat session store
- pure reducers
- pure projection
- minimal persistence helpers

```text
src/lib/chat/
  model.ts
  invariants.ts
  debug.ts
  projection/
    project-message-rows.ts
  reducers/
    apply-submit-start.ts
    apply-backend-event.ts
    apply-thread-messages.ts
    apply-run-snapshot.ts
    apply-run-terminal.ts
    apply-wait-state.ts
  commands/
    hydrate-thread.ts
    submit-message.ts
    cancel-run.ts
    resume-run.ts
    branch-thread.ts
    edit-message.ts
  persistence/
    persisted-chat-state.ts
  store/
    chat-session-store.svelte.ts
```

### Keep `src/lib/stores/chat-store.svelte.ts`

But only as:

- compatibility facade
- re-export
- migration bridge

The current monolith should shrink, not stay as the main implementation.

---

## The State Model We Actually Need

### Durable transcript state

```ts
type DurableTranscriptState = {
  byId: Record<MessageId, DurableMessage>
  order: MessageId[]
}
```

Properties:

- durable only
- keyed by backend `message.id`
- no `live:*` render identity
- no optimistic-only fields

### Optimistic submit state

```ts
type OptimisticUserMessage = {
  submissionId: string
  renderKey: string
  backendMessageId: MessageId | null
  createdAt: string
  text: string
  attachments: MessageAttachment[]
}
```

Important rule:

- backend confirmation updates `backendMessageId`
- it does **not** change `renderKey`

That is how we avoid blink.

### Live assistant lane

```ts
type LiveAssistantLane = {
  submissionId: string
  renderKey: string
  runId: RunId | null
  createdAt: string
  status: MessageStatus
  finishReason: MessageFinishReason | null
  text: string
  blocks: Block[]
}
```

Important rules:

- one active root lane per thread view
- lane is created on submit
- lane binds to one root run
- lane can be replaced only by its matching durable assistant row

### Active run state

```ts
type ActiveRunState = {
  runId: RunId | null
  status: BackendRun['status'] | null
  pendingWaits: BackendPendingWait[]
  resolvingWaitIds: Set<string>
}
```

### Thread session state

```ts
type ActiveThreadState = {
  threadId: ThreadId | null
  sessionId: SessionId | null
  title: string | null
  eventCursor: number
}
```

---

## Row Identity Contract

This is the part that matters most for Svelte.

### Durable rows

- render key: `message:${messageId}`
- never changes

### Optimistic user rows

- render key: `pending-user:${submissionId}`
- never changes during `tmp -> msg_*` confirmation

### Live assistant rows

- render key: `live-assistant:${submissionId}`
- remains stable for the whole streaming lifetime

### Assistant handoff bridge

One narrowly scoped bridge is allowed:

- when the live assistant lane is replaced by its matching durable assistant row

Rules:

- only for that exact lane
- only for the current handoff
- never reused by older durable assistant rows
- never stored as durable historical identity

This is the only safe use of a temporary handoff key.

---

## Event Ownership Matrix

This is the implementation contract reducers must enforce.

### `message.posted`

Updates:

- durable transcript
- optimistic user confirmation if user-authored

Must not:

- mutate the live lane into a durable row

### `run.created`

Updates:

- live lane binding
- active run metadata

Must not:

- create a live lane by itself if there is no active submit context

### `run.started`, `run.resumed`

Updates:

- active run status
- live lane status

Must not:

- touch durable transcript

### `stream.delta`, `stream.done`, `generation.completed`

Updates:

- live lane text/blocks
- maybe budget usage

Must not:

- mutate durable rows

### `tool.*`, `web_search.progress`

Updates:

- live lane blocks
- wait state where relevant

Must not:

- mutate durable transcript

### `run.waiting`

Updates:

- active run state
- wait state
- live lane state

### `run.completed`, `run.failed`, `run.cancelled`

Updates:

- only the matching active lane

Must verify:

- `event.runId === activeRun.runId`

If not:

- ignore for current lane
- maybe retain as diagnostic/recovery data only

This directly prevents the bug where run `N` finishes and destroys run `N+1`’s UI lane.

---

## REST Ownership Matrix

### `GET /threads/:id/messages`

Use for:

- initial hydrate
- reconnect recovery
- post-terminal durable convergence

Do not use for:

- per-delta streaming updates

### `GET /runs/:id`

Use for:

- hydrate active run state
- recovery when SSE disconnects
- explicit reconcile after uncertainty

Do not use for:

- regular transcript truth

### Interaction response

Use for:

- binding the current submission to a run
- immediate post-submit metadata

This should be treated as the start of a live lane lifecycle, not as a transcript update.

---

## What To Optimize For In This Refactor

Not “clean architecture” for its own sake.

The refactor should optimize for:

- correctness under late/out-of-order-but-valid UI timing
- zero blink on message confirmation
- zero historical row reanimation
- no foreign run can kill the current lane
- easier reasoning in dev tools
- pure reducers that are easy to test

If a design is more “abstract” but makes those harder, it is worse for this app.

---

## The Best Refactor Order

### Step 1. Lock the invariants in tests

Before moving more files, make sure tests explicitly cover:

- optimistic user row keeps stable render key through confirmation
- old `run.completed` does not affect the current live lane
- live assistant row hands off without remount flash
- historical durable assistant row never becomes live again

This prevents another round of accidental regressions.

### Step 2. Extract projection first

Move row projection into:

- `project-message-rows.ts`

This gives one place to reason about:

- row ordering
- row identity
- lane handoff

### Step 3. Make the lane explicit

Introduce `submissionId` + `LiveAssistantLane` as first-class state.

This is the main fix for the run ownership bugs.

### Step 4. Split reducers by ownership

Extract reducers for:

- transcript replacement
- SSE event application
- run snapshot recovery
- terminal handling
- wait handling

### Step 5. Keep the store thin

The Svelte rune store should orchestrate:

- API calls
- reducer invocation
- persistence
- public getters

It should not contain business logic inline.

---

## Best Practices That Fit Our Case

These are the best practices most relevant to this app.

### Prioritized

- Separate durable truth, optimistic truth, and live truth.
- Let render rows be projection only.
- Treat keys as component identity contracts.
- Make run ownership explicit and narrow.
- Ignore foreign terminal events for the active lane.
- Do not mutate render rows from multiple sources.
- Keep local component latches attached only to stable row identity.
- Preserve optimistic row render identity through server confirmation.
- Use dev-only lifecycle logging for rows and lanes.
- Batch projection work where possible.

### Additional

- Prefer immutable reducer outputs over patchy in-place list edits.
- Keep handoff logic local and temporary.
- Store only recoverable state, not stale UI artifacts.
- Make recovery paths explicit, not implicit.
- Keep virtualization separate from transcript truth.

---

## Debugging Requirements

The refactor should preserve strong dev diagnostics.

Required debug views:

- durable transcript rows
- optimistic rows
- live assistant lane
- projected rows
- active run binding

Required lifecycle logs:

- row mount
- row update
- row destroy
- row render key
- row durable id
- row run id

Required reducer logs:

- event type
- event run id
- active run id before reduce
- resulting lane/transcript summary

For this app, debug instrumentation is not optional. It is how we verify identity correctness.

---

## Definition of Done

This refactor is done when:

- user rows do not blink on backend confirmation
- assistant rows do not disappear/reappear on handoff
- old assistant rows never reanimate
- late terminal events cannot kill a newer lane
- no duplicate-key crashes occur
- hydrate/reconnect produces the same visible truth as continuous session use
- the main store is substantially smaller and easier to reason about
- reducers can be tested without Svelte component runtime

---

## Non-Goals

- redesign backend event schemas
- redesign block materialization
- redesign message visuals
- remove virtualization

This plan is specifically about making the current product stable, correct, and Svelte-5-safe.
