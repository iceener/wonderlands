# `#` File Picker / Mention Tasks

## Goal
Add a `#`-triggered file picker to the TipTap prompt editor that:

- searches workspace files from the user's resolved workspace
- can also surface durable attachments
- inserts file mentions inline into the prompt
- keeps attachment-backed mentions connected to submit-time `fileIds`
- promotes picked attachment images into real composer attachments for vision analysis
- stops bare filenames like `file.md` from being rendered as links

## Constraints
- Keep the current markdown-first prompt boundary.
- Do not overload `/v1/files` for workspace filesystem search.
- Resolve workspace roots server-side from the authenticated account and tenant.
- Activate `/` slash commands only at a text boundary; a slash inside an active `#path`, URL, or ordinary token remains literal.
- Preserve normal markdown heading behavior for `# ` at the start of a line.

## Search Contract
Implement the file search flow using the ranking model described for the ACP picker:

- cached index per canonical workspace root
- TTL: 30 seconds
- max cached indexes: 5
- hard-coded directory exclusions for noisy/generated folders
- ignore `.gitignore` and `.cursorignore`
- pre-compute lowercase path/name plus depth and extension
- top-K selection instead of sorting the full result set

### Query Modes
- Empty query: return files ordered by recency and shallow/short paths, with small extension boosts.
- Multi-part query: every space-separated part must match; score all parts and strongly boost the final filename term.
- Single-term query: score filename and full path independently; filename matches outrank matches found only in directory names.
- Path query: normalize leading, repeated, and Windows-style separators; match slash-delimited components in order and reward exact/prefix paths.
- Recency is a secondary tie-breaker only and must never outrank a materially better filename or path match.
- Return file records only; traversed directories are searchable as path components, not selectable results.

### Result Model
Every result should carry enough data for:

- inline mention insertion
- highlight rendering
- source-aware handling

Minimum fields:

- `source`: `workspace` or `attachment`
- `label`
- `relativePath`
- `matchIndices`
- `extension`
- `depth`
- `fileId?`
- `sizeBytes?`

## Task List

### 1. Fix the markdown linkification bug first
- [x] update the markdown renderer so bare filenames like `file.md` and `#file.md` do not autolink
- [x] keep explicit `https://...` links clickable
- [x] add tests for:
  - `file.md`
  - `#file.md`
  - `https://example.com`

### 2. Define the file mention model
- [x] create a dedicated TipTap file mention node for the prompt editor
- [x] support two sources:
  - workspace files
  - durable attachments
- [x] define node attributes:
  - `source`
  - `label`
  - `relativePath?`
  - `fileId?`
- [x] render the node as an inline atom/chip inside the editor
- [x] define markdown serialization and parsing so the node round-trips through the current editor boundary
- [x] decide the canonical text form for serialized mentions
  - current syntax: inline code references like `` `#src/index.ts` ``

### 3. Add backend workspace-file search
- [x] add a dedicated backend route for file-picker search
- [x] resolve the current account workspace from tenant/account state
- [x] search inside the account `vault/` root
- [x] do not trust client-provided raw paths
- [x] decide whether filesystem entries under `vault/attachments/` are shown directly or only through durable attachment results
  - current rule: skip `vault/attachments/` from workspace indexing and surface those only as durable attachment results

### 4. Port the ranking/indexing algorithm
- [x] add an index manager with TTL and capped cache size
- [x] canonicalize workspace roots before cache lookup
- [x] traverse the workspace while respecting ignore files and hard-coded excludes
- [x] store pre-computed lowercase path and filename values on indexed entries
- [x] store depth, extension, and source metadata on indexed entries
- [x] implement empty-query scoring
- [x] implement multi-part scoring
- [x] implement single-term scoring
- [x] apply extension boosts
- [x] return top-K results using heap-based selection
- [x] return `matchIndices` for UI highlighting
- [ ] prewarm the index when a session/workspace becomes active, if useful

### 5. Merge attachments into picker results
- [x] include durable attachments in the same picker result stream
- [x] support:
  - account-library files
  - session-visible files when a session exists
- [x] decide how attachment results participate in ranking relative to workspace files
- [x] make attachment results visually distinguishable in the picker
- [x] dedupe attachment/workspace collisions where the same visible label appears multiple times
- [x] filter out broken/orphaned attachment records whose blobs are missing from storage
  - this avoids surfacing DB rows that later fail at `/v1/files/:id/content`

### 6. Build a dedicated frontend file-picker service
- [x] add a debounced frontend search service for `#`
- [x] debounce requests by 80ms
- [x] protect against stale responses and out-of-order updates
- [x] do not reuse the current slash command search scorer
- [x] support loading, empty, and error states

### 7. Build the `#` picker UI
- [x] add a dedicated picker UI for file-search results
- [x] support keyboard navigation:
  - ArrowUp
  - ArrowDown
  - Enter
  - Escape
- [x] render fuzzy match highlights from `matchIndices`
- [x] show source-aware metadata for workspace files vs attachments
- [x] keep the picker anchored to the composer flow

### 8. Wire `#` into the composer
- [x] add a `#` trigger beside the existing `/` trigger
- [x] capture the active editor and replacement range for `#query`
- [x] open the file picker when `#` becomes active
- [x] update the picker query as the user types
- [x] insert a workspace file mention node on selection
- [x] insert an attachment mention node on selection
- [x] keep normal heading syntax working when the user types `# ` instead of a mention
- [x] special-case picked attachment images
  - current rule: selecting an attachment image adds it to the composer attachment tray instead of inserting a `#` chip, so it is treated like a normal vision attachment

### 9. Attach submit-time file ids for attachment mentions
- [x] when an attachment-backed mention is selected, register its `fileId` for submit
- [x] include attachment-mention `fileIds` in the interaction submit path
- [x] dedupe `fileIds` against files already present in the attachment tray
- [x] define what happens if an attachment mention is deleted before submit
  - resolved: `getReferencedFileIds()` scans the editor at submit time; deleted mentions are simply not included
- [x] keep workspace file mentions text-only unless a later backend contract adds structured workspace refs
- [x] keep image attachments on the real attachment path when selected from the picker
  - note: tray-backed image selections should not rely on mention parsing at submit time

### 10. Render sent messages correctly
- [x] ensure sent user messages render file mentions predictably
- [x] ensure mention text is not turned into links by markdown rendering
- [x] decide whether message rendering needs a custom mention renderer or whether serialized text is sufficient
  - current rule: serialized `` `#...` `` references are rendered as dedicated inline file tokens in message markdown

### 11. Test coverage
- [x] backend tests for:
  - empty query ranking
  - multi-part ranking
  - single-term ranking
  - depth penalties
  - extension boosts
  - attachment merge behavior
- [x] frontend tests for:
  - `#` trigger activation
  - picker debounce behavior
  - picker keyboard navigation
  - workspace mention insertion
  - attachment mention insertion
  - submit-time `fileIds` from attachment mentions
  - mention removal before submit
- [x] renderer tests for bare filenames not autolinking
- [x] add coverage for:
  - serialized file mention round-trip
  - message-side file token rendering
  - adding pre-uploaded picker attachments into the composer tray

## Open Decisions
- [x] pick the final serialized mention syntax
- [x] decide whether `vault/attachments/` is searched as plain workspace content, durable attachments only, or both
- [x] decide whether the existing palette shell is extended or whether the `#` picker gets its own dedicated UI/store
- [ ] decide whether workspace image files should support an explicit import/upload action so they can also become real vision attachments
- [x] define cleanup behavior if a non-image attachment mention is deleted before submit
  - resolved: same as above — submit-time scan excludes deleted mentions; no special cleanup needed
