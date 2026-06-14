# `05_04_ui` -> `05_04_api` Migration Tasks

## Goal
Move `05_04_ui` to talk to `05_04_api` directly.

Constraints:

- remove `05_04_ui/server`
- do not add a translation layer or compatibility BFF
- the browser/client must follow backend nouns and backend contracts directly
- uploads/files are handled by `05_04_api`

## Ground Rules
No translation layer means:

- do not preserve `/api/conversation`, `/api/chat`, `/api/reset`, or `/api/cancel`
- do not preserve the current `ConversationSnapshot` contract as the transport contract
- do not preserve the current custom `StreamEvent` union as the transport contract
- the UI may still build view-model state for rendering, but that state must come from `05_04_api` nouns and `05_04_api` event shapes directly

## Backend Assumptions
These statements from `05_04_api/spec/upload-files.md` are the contract direction:

> "This should become the backend contract that `05_04_ui` talks to directly once its local server is removed."

> "Do not put raw file paths into messages or UI state. The UI should only handle `fil_*` ids and API URLs."

> "The API must serve content itself because `05_04_ui` will no longer have its own local server."

These statements from `05_04_api/spec/auth.md` are also part of the contract direction:

> "Browser UI should use server-managed `auth_sessions` with an `HttpOnly` cookie."

> "Tenant selection must stay explicit and separate from authentication."

> "Browser users should reach that cookie-backed state through `POST /v1/auth/login` with email and password."

## Known Backend Readiness Gate
The frontend migration assumes that multi-turn chat continues through `POST /v1/threads/:threadId/interactions`.

That route is already the correct backend-native public surface, but `05_04_api/spec/wire.md` currently says:

> "OpenAI multi-turn execution through `POST /v1/threads/:threadId/interactions` is still broken once prior assistant output is replayed into the next request"

This means:

- the UI should still be designed around that route
- but end-to-end migration signoff depends on that backend path working correctly for real multi-turn execution
- bootstrap, thread hydration, and event streaming can be migrated before this is fixed
- normal turn-2-and-beyond product validation cannot be considered complete until this is fixed

## Current UI Areas Affected
Main frontend areas that currently assume the local server contract:

- `src/lib/services/api.ts`
- `src/lib/services/sse.ts`
- `src/lib/services/attachment-api.ts`
- `src/lib/stores/chat-store.svelte.ts`
- `src/lib/runtime/materialize.ts`
- `shared/chat.ts`
- `vite.config.ts`
- `package.json`
- `tsconfig.json`
- `server/**`

## Task List

### 1. Remove local-server assumptions from the app shell
- [ ] delete `server/**` after the frontend no longer depends on its endpoints
- [ ] remove server build/dev scripts from `package.json`
- [ ] remove server typecheck/build references from `package.json`
- [ ] remove `server/**/*.ts` from `tsconfig.json`
- [ ] remove unneeded server-only dependencies from `package.json`
- [ ] change `vite.config.ts` so dev wiring targets backend routes directly instead of the local Bun server
- [ ] decide dev transport shape:
  - same-origin reverse proxy to `05_04_api`
  - or direct cross-origin requests to `05_04_api`
- [ ] keep the chosen dev setup transparent, meaning no payload rewriting and no fake compatibility endpoints
- [ ] if direct cross-origin dev is used, make sure backend CORS supports browser credentials and every browser-sent auth/tenant header

### 2. Replace the current transport contract with backend nouns
- [ ] stop treating the app state as one `ConversationSnapshot`
- [ ] introduce frontend state based on backend ids:
  - `sessionId`
  - `threadId`
  - `runId`
  - `messageId`
  - `fileId`
- [ ] replace the current `ConversationId` concept with backend ids
- [ ] remove `StreamMode` from the main transport path
- [ ] remove `mock` mode from the UI flow
- [ ] remove `historyCount` from the main transport path unless a future backend read model explicitly supports it
- [ ] remove or repurpose `reasoningEffort`, because the current backend surface exposes `model`, `modelAlias`, `provider`, `temperature`, and `maxOutputTokens`, not the current UI-only `reasoningEffort` field
- [ ] align any model picker to backend-supported request fields instead of the current local-server fields

### 3. Rewrite the frontend API client around `05_04_api`
- [ ] replace `src/lib/services/api.ts` functions with backend-native operations
- [ ] add bootstrap flow for first-run creation using `POST /v1/sessions/bootstrap`
- [ ] add thread read flow using:
  - `GET /v1/threads/:threadId`
  - `GET /v1/threads/:threadId/messages`
- [ ] add interaction flow using `POST /v1/threads/:threadId/interactions`
- [ ] add run control flow using:
  - `GET /v1/runs/:runId`
  - `POST /v1/runs/:runId/cancel`
  - `POST /v1/runs/:runId/resume`
- [ ] handle backend success/error envelopes directly instead of assuming raw JSON payloads
- [ ] centralize API base URL and auth headers in one place
- [ ] use browser auth in the shape described by `05_04_api/spec/auth.md`:
  - `auth_session` cookie for authentication
  - `X-Tenant-Id` for tenant-scoped requests
- [ ] make browser requests include credentials where required by the cookie-backed auth flow
- [ ] show a real email/password login form that calls `POST /v1/auth/login`
- [ ] boot the app by calling `GET /v1/auth/session` before loading chat state
- [ ] keep tenant selection explicit in frontend state instead of hiding it inside session/thread state

### 4. Rebuild boot/hydration flow
- [ ] replace `hydrateConversation()` with boot logic based on backend session/thread reads
- [ ] define how the UI discovers or restores the active tenant before thread bootstrap and thread reads
- [ ] define how the UI remembers the active `sessionId` and `threadId`
- [ ] restore the active thread from URL, storage, or an explicit bootstrap response
- [ ] load initial message history from `GET /v1/threads/:threadId/messages`
- [ ] treat backend thread messages as the durable source of truth for already-completed history
- [ ] stop expecting hydrated assistant messages to contain the legacy `events[]` stream transcript

### 5. Rebuild submit flow around sessions, threads, and runs
- [ ] first turn: use `POST /v1/sessions/bootstrap`
- [ ] subsequent turns: use `POST /v1/threads/:threadId/interactions`
- [ ] treat provider-backed multi-turn support on `POST /v1/threads/:threadId/interactions` as a backend prerequisite for final end-to-end signoff
- [ ] support the backend response shape that returns ids such as:
  - `sessionId`
  - `threadId`
  - `runId`
  - `messageId` / `inputMessageId`
  - `assistantMessageId` when available
- [ ] store the active `runId` in client state
- [ ] stop sending `mode`, `reasoningEffort`, and legacy attachment payloads unless the backend explicitly supports them
- [ ] send backend-native request fields such as `text`, `content`, `model`, `modelAlias`, `provider`, `temperature`, and `maxOutputTokens`

### 6. Replace `/api/chat` SSE with backend event streaming
- [ ] stop using `POST /api/chat` as the streaming transport
- [ ] consume `GET /v1/events/stream` directly
- [ ] subscribe with backend-native filters such as `threadId` and `runId` instead of consuming a broad tenant-wide stream
- [ ] treat SSE `id` as the replay cursor and keep it in client state
- [ ] define how the initial cursor is seeded after the first thread/message hydration pass
- [ ] support reconnect and cursor replay with backend semantics
- [ ] parse named backend events directly instead of assuming the current custom event union
- [ ] track at least these backend event types in the UI:
  - `run.started`
  - `turn.started`
  - `progress.reported`
  - `stream.delta`
  - `stream.done`
  - `generation.completed`
  - `tool.called`
  - `tool.completed`
  - `tool.failed`
  - `message.posted`
  - `run.completed`
  - `run.waiting`
  - `run.failed`
  - `run.cancelled`
- [ ] make reconnect behavior follow backend cursor replay instead of local-server `Last-Event-ID` assumptions
- [ ] define reconciliation rules between hydrated thread history and replayed `message.posted` / run events so reconnect does not duplicate visible state

### 7. Rewrite message rendering to consume backend truth directly
- [ ] stop treating the legacy `StreamEvent` union as the canonical render input
- [ ] decide the new render model:
  - thread messages are durable history
  - domain events are transient live progress
- [ ] build text streaming UI from `stream.delta` and `stream.done`
- [ ] reconcile live streamed text with the later durable `message.posted` assistant message
- [ ] build tool UI from backend tool events instead of legacy `tool_call` / `tool_result`
- [ ] build run status UI from backend run events instead of legacy `complete`
- [ ] remove or redesign any UI block that depends on legacy event types the backend does not emit
- [ ] keep the view model simple: backend messages plus backend events, not translated fake legacy events

### 8. Redesign shared frontend types
- [ ] rewrite `shared/chat.ts` so it no longer describes the removed local-server transport
- [ ] split transport types from presentation types
- [ ] define frontend types for:
  - backend envelopes
  - thread messages
  - file summaries
  - domain events used by the UI
  - UI-only derived blocks if still needed
- [ ] remove local-server-only types such as:
  - `ConversationSnapshot`
  - `StreamMode`
  - legacy `StreamEvent` variants not emitted by the backend
- [ ] keep branded ids if useful, but align them to backend ids instead of conversation-local ids

### 9. Rework attachments and files around backend file ids
- [ ] replace `src/lib/services/attachment-api.ts` upload flow with `POST /v1/uploads`
- [ ] send multipart form data in the shape described by `05_04_api/spec/upload-files.md`
- [ ] store returned backend file summaries, not local image-upload payloads
- [ ] treat file identity as `fil_*` ids plus API URLs
- [ ] stop storing raw server paths or assuming `/api/artifacts/*`
- [ ] replace current image-only assumptions with backend file summaries where possible
- [ ] load message attachments from backend-composed message reads
- [ ] wire message send / interaction start to pass `fileIds`
- [ ] support both:
  - `session_local`
  - `account_library`

### 10. Backend dependencies and blockers
- [ ] wait for production-correct multi-turn behavior on `POST /v1/threads/:threadId/interactions`
- [ ] keep this backend route as the frontend contract anyway; do not invent an alternate UI-only continuation contract
- [ ] wait for backend support from `05_04_api/spec/upload-files.md` for:
  - `POST /v1/uploads`
  - `GET /v1/files/:fileId`
  - `GET /v1/files/:fileId/content`
  - `GET /v1/sessions/:sessionId/files`
  - `GET /v1/files?scope=account_library`
- [ ] wait for backend message reads to include composed attachments
- [ ] wait for backend message/interactions inputs to accept `fileIds`
- [ ] once available, keep the UI aligned to those exact backend shapes instead of inventing frontend-specific attachment contracts

### 11. Rework cancel / waiting / resume UX
- [ ] replace `/api/cancel` with `POST /v1/runs/:runId/cancel`
- [ ] store the currently active `runId` so cancel acts on the real backend run
- [ ] surface `waiting` state when the backend returns or emits wait-related state
- [ ] add resume actions if `run.waiting` becomes part of the visible product flow
- [ ] make failure/cancel UI reflect backend run states directly

### 12. Update components that assume legacy blocks
- [ ] review `BlockRenderer.svelte` against backend event coverage
- [ ] review `ToolBlock.svelte` against backend tool payloads
- [ ] review `ArtifactBlock.svelte` against backend file/file-link reality
- [ ] review `MessageCard.svelte` so persisted thread messages render correctly without legacy assistant event history
- [ ] review attachment UI components so they render backend file summaries and API URLs
- [ ] remove any dead UI affordances that only existed for the local mock/live server

### 13. Clean up tests around the new contract
- [ ] replace tests that mock `/api/conversation`, `/api/chat`, `/api/reset`, and `/api/cancel`
- [ ] add client tests for:
  - bootstrap flow
  - thread hydration
  - interaction submit
  - event-stream replay
  - reconnect with cursor
  - cancel by `runId`
  - attachment upload via `/v1/uploads`
- [ ] update store tests so they assert backend-native ids and event types
- [ ] update SSE tests so they cover named backend events and cursor-based replay
- [ ] remove tests that only defend the deleted local-server contract

### 14. Final cleanup
- [ ] remove dead compatibility code once the UI runs directly against `05_04_api`
- [ ] remove `openai` and other server-only code from the UI package if no longer used client-side
- [ ] remove leftover docs that describe the local Bun server as part of the app architecture
- [ ] document the final dev/start workflow for one backend-driven app

## Recommended Implementation Order
1. Replace transport configuration and API client surface.
2. Replace boot/hydration with backend thread reads.
3. Replace submit/cancel flow with session/thread/run endpoints.
4. Replace SSE consumption with `/v1/events/stream`.
5. Rewrite rendering/state around backend messages + backend events.
6. Remove legacy types and local-server assumptions.
7. Wire uploads/files once the backend upload contract lands.
8. Delete `server/**` and related scripts/config after the UI is fully backend-native.

## Stop Line
The migration is done when all of the following are true:

- `05_04_ui` makes no request to `05_04_ui/server`
- `05_04_ui/server` can be deleted without breaking the product
- the UI talks directly to `05_04_api` routes under `/v1`
- browser auth follows the `auth_session` plus `X-Tenant-Id` model instead of the deleted local-server shortcuts
- the UI renders durable thread history from backend message reads
- the UI renders live progress from backend event streaming
- provider-backed multi-turn continuation through `POST /v1/threads/:threadId/interactions` works end-to-end
- cancel/wait/resume operate on backend `runId`
- uploads and file rendering use backend file ids and backend URLs only
