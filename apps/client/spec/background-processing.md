# Background Processing in the Browser UI

Last updated: 2026-03-31

This document describes the client-side work needed so `05_04_ui` behaves correctly when runs continue after the browser is closed.

The corresponding runtime plan lives in `05_04_api/spec/background-processing.md`.

## Goal

Once the server has accepted a turn, the browser should be able to disappear without losing the run.

On reopen, the UI should:

- restore the active thread and run ids
- trust backend run state
- reconnect to the committed event stream when appropriate
- refresh durable thread messages when the run has already completed
- never require the user to resubmit the same prompt

## Current Reality

### What the UI already has

The store already persists enough state to support background convergence:

- `sessionId`
- `threadId`
- `runId`
- `eventCursor`
- a persisted live assistant snapshot

The UI also already knows how to:

- hydrate a thread from durable `GET /v1/threads/:threadId/messages`
- read `GET /v1/runs/:runId`
- reconnect SSE from a cursor
- reconcile on stream failure

### Where the browser-close story still breaks down

There are two important asymmetries.

#### 1. First-turn no-file submit still uses bootstrap plus execute

Current no-file first-turn flow:

1. `POST /v1/sessions/bootstrap`
2. persist ids locally
3. open thread SSE
4. `POST /v1/runs/:runId/execute`

That means the first turn still depends on a second browser request after bootstrap returns.

#### 2. Hydration still abandons "old" pending/running runs locally

During `hydrate()`, the store reads the persisted run and then applies a 30-second stale threshold:

- if the run is still `pending` or `running`
- and `updatedAt` is older than 30 seconds
- the store clears local run state

That heuristic is incompatible with intentional background execution.

Once the server truly owns execution, an older active run is not necessarily stale. It may simply be:

- still running
- already completed while the browser was closed
- waiting on a durable pause

## Deep Technical Analysis

### The client does not need a new transport model

The existing model is already good enough:

- durable messages are loaded from thread reads
- transient live state comes from committed SSE events
- `eventCursor` gives replay continuity

The main missing piece is not transport. It is ownership.

The current store sometimes still behaves as if:

- the browser is the primary owner of active execution

But for background processing the correct model is:

- the browser is only an observer plus control surface
- the server owns progress once the turn has been accepted

### The stale-run cutoff is the biggest UI correctness bug

With real background execution, clearing a `pending` or `running` run after 30 seconds becomes wrong.

It can cause:

- loss of loading/waiting state
- missed stream reconnection
- disappearance of a valid run that the backend still considers active
- failure to render the final assistant output if the worker completed while the browser was gone

That heuristic existed as a defensive workaround for old stuck-run behavior.

Once the API slice is fixed, the client should stop making that assumption and trust `GET /v1/runs/:runId`.

### The first-turn branch is the second UI problem

The store currently has three materially different submit paths:

1. first turn without files:
   - bootstrap
   - execute
2. first turn with files:
   - create session
   - create thread
   - thread interaction
3. later turns:
   - thread interaction

Only path 1 has the bootstrap/execute gap.

Even if the API fixes that gap through worker auto-execution, this branch is still more complex than the others and keeps the UI coupled to execution ownership details.

## Recommended UI Plan

Use the same phased approach as the API.

### Phase 1: Client correctness on reopen

Keep the current submit surface, but make hydration background-safe.

#### Required changes

1. Remove the 30-second stale-run reset for `pending` and `running` runs.
2. On hydrate, always fetch `GET /v1/runs/:runId` when a persisted run exists.
3. If the backend says the run is:
   - `completed`, `failed`, or `cancelled`:
     - finalize from durable state
     - refresh thread messages
   - `waiting`:
     - hydrate waits
     - keep reconciliation active
     - preserve the waiting assistant snapshot
   - `pending` or `running`:
     - restore the live assistant snapshot
     - reconnect SSE from the stored cursor
     - keep reconciliation active

#### Important behavior change

The store should no longer decide that an old active run is invalid just because it is old.

Only the backend should decide whether the run is:

- still active
- terminal
- requeued
- abandoned and recovered

### Phase 2: Remove the first-turn browser-owned execute step

Once the API contract is ready, the UI should stop doing:

- `bootstrap`
- then `executeRun`

Recommended target:

- one first-turn request that already returns `RunExecutionOutput`

That would let the UI unify first-turn submit with later submit behavior.

## Submit-Flow Plan

### Short term

Keep the current first-turn branch, but treat `/runs/:runId/execute` as non-authoritative:

- the worker may already have started the run
- the execute response should be treated as one convergence signal, not the only source of truth

### Medium term

Switch first-turn submit to a single server-owned surface.

Preferred target:

- upgraded `POST /v1/sessions/bootstrap` returning execution output

This is better than client-side session/thread bootstrap choreography because it keeps the first turn atomic from the product perspective.

## UX Scope

### In scope

- background completion after browser close
- truthful reopen behavior
- no duplicate prompt submission
- durable final assistant output after reopen

### Explicitly out of scope for the first slice

- switching away from an active thread while it keeps running in the background
- browser notifications
- thread list badges for background active runs
- a new activity center

The current thread-switch guard can stay in place for now.

## Tests Required

### Store tests to add or change

1. Hydrating a persisted `pending` bootstrap run older than 30 seconds does not clear run state.
2. Hydrating a persisted `running` run older than 30 seconds reconnects SSE instead of resetting.
3. Reopening after bootstrap succeeded but before explicit execute still converges when the backend worker completed the run.
4. Reopening while a background run is still active resumes from cursor replay and later terminal events.
5. Remove or rewrite any tests that encode the stale-run reset as expected behavior.

### Existing tests that should continue to pass

- waiting-run resume flows
- SSE replay / convergence flows
- durable transcript hydration
- delegated child activity rendering

## Rollout Order

1. Ship the API correctness change so bootstrap runs can self-start in the worker.
2. Remove stale-run abandonment in the UI and always trust backend run state on hydrate.
3. After that is stable, converge first-turn submit onto a single execution-owning route.

## Success Criteria

The feature is done when all of the following are true:

1. User submits the first turn.
2. Browser closes immediately after the server accepts the request.
3. The backend continues and completes the run without another browser request.
4. On reopen, the UI restores the same thread.
5. The final assistant message is visible without resubmitting the prompt.
