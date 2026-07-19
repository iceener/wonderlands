# Wonderlands Context Assembly v2

> **Continuation document for future coding agents.** This file is the durable implementation brief for redesigning context assembly in `/Users/overment/wonderlands`. If prior conversation context has been compacted or lost, read this document first, then inspect the referenced source files and current git diff before changing code.

**Status:** design proposal; not yet implemented  
**Repository:** `/Users/overment/wonderlands`  
**Primary scope:** `apps/server/src/application/**`  
**Visualization:** `report.html`

---

## 1. Mission

Build a context assembly system that is:

- **Extensible:** a new source such as location, calendar, device state, account preferences, or project state can be added without editing a central monolith in many places.
- **Deterministic:** the same durable inputs and assembler version produce the same manifest and provider-neutral request.
- **Policy-safe:** secrets and server-only state cannot accidentally become model-visible.
- **Provenance-aware:** every model-visible element records where it came from, when it was captured, and whether it was transformed or summarized.
- **Budget-adaptive:** context is selected according to model window, output reserve, priority, freshness, and compressibility.
- **Conflict-aware:** current state, user corrections, external sources, inferred observations, and summaries have explicit precedence rules.
- **Observable:** each run persists a redacted context manifest explaining what was included, transformed, dropped, or rejected.
- **Provider-neutral:** selection and policy happen before OpenAI/Google/OpenRouter translation.
- **Backward-compatible during migration:** existing agent behavior must remain stable until parity tests prove the replacement.

“Flawless” does not mean lossless or omniscient. Summaries are lossy, integrations can be stale, and token budgets force omission. The practical target is **auditable, reproducible, safe, and continuously evaluated**.

---

## 2. Non-goals

Do not use this work to:

- Rewrite the run scheduler, event store, provider adapters, memory subsystem, or file storage wholesale.
- Replace durable thread/run/item models.
- Introduce dynamic runtime plugins or dependency injection frameworks.
- Put database access into layer renderers.
- Send all available data to the model “just in case.”
- Treat request metadata as model-readable context.
- Change visible agent behavior without characterization tests and an explicit migration flag.

---

## 3. Current implementation

### Main flow

```text
POST /threads/:threadId/interactions
  → message + run/job created
  → scheduler drives run
  → loadThreadContext()
  → assembleThreadInteractionRequest()
  → provider-neutral AiInteractionRequest
  → OpenAI / Google / OpenRouter adapter
```

### Current source map

| Responsibility | Current file |
|---|---|
| Durable context loading | `apps/server/src/application/interactions/load-thread-context.ts` |
| Ordered layer assembly | `apps/server/src/application/interactions/assemble-thread-interaction-request.ts` |
| Layer and budget types | `apps/server/src/application/interactions/context-bundle.ts` |
| Run items → AI messages | `apps/server/src/application/interactions/build-run-interaction-request.ts` |
| Tool request construction | `apps/server/src/application/interactions/interaction-tooling.ts` |
| Capability-derived guidance | `apps/server/src/application/interactions/capability-prompt.ts` |
| Attachment reference guidance | `apps/server/src/application/interactions/attachment-ref-prompt.ts` |
| Attachment descriptors | `apps/server/src/application/files/attachment-ref-context.ts` |
| File content exposure | `apps/server/src/application/files/file-context.ts` |
| Garden guidance | `apps/server/src/application/garden/garden-agent-context.ts` |
| Context compaction | `apps/server/src/application/runtime/execution/context-compaction.ts` |
| Observation extraction | `apps/server/src/application/memory/observe-summary.ts` |
| Reflection synthesis | `apps/server/src/application/memory/reflect-run-local-memory.ts` |
| Execution entry | `apps/server/src/application/runtime/execution/drive-run.ts` |

### Existing ordered layers

The current assembler creates these layers in order:

1. `system_prompt` — reserved, empty
2. `agent_profile`
3. `capability_guidance`
4. `garden_context`
5. `attachment_ref_rules`
6. `tool_context`
7. `session_metadata` — reserved, empty
8. `summary_memory`
9. `run_local_memory` — reflection
10. `run_local_memory` — observations
11. `run_transcript`
12. `visible_message_history` — fallback only
13. `attachment_ref_context`
14. `file_context`
15. `pending_waits` — reserved, empty

Stable layers are hashed as a prefix. Volatile layers form the turn-specific suffix. Tool schemas and response format are counted as request overhead.

### Current strengths to preserve

- Explicit ordering in one assembly function.
- Strong provider-neutral AI message types.
- Stable/volatile budget accounting and prefix hash.
- Extensive tests in `apps/server/test/assemble-thread-interaction-request.test.ts`.
- Provider-specific adapters remain isolated.
- Durable projection of messages, calls, results, and reasoning.
- Attachment references are stable and server-resolved.
- Compaction respects pending wait boundaries.

### Current problems

1. `load-thread-context.ts` and `assemble-thread-interaction-request.ts` are each roughly 450 lines.
2. Adding a source usually requires edits to loader types, loader orchestration, formatter functions, layer union, assembly order, and tests.
3. Loading performs writes/AI work through observation and reflection; it is not a read-only deterministic phase.
4. Reflection and observations share the same layer ID, reducing diagnostics.
5. Visibility is implicit. The types do not structurally distinguish model-readable, request-only, and server-only information.
6. Provenance, freshness, sensitivity, authority, and supersession are not first-class.
7. Priority and omission are mostly encoded by compaction rather than a general planner.
8. Empty reserved layers add noise.
9. There is no persisted per-run explanation of why each context element was selected or dropped.
10. Conflicting facts from memory, user correction, telemetry, and integrations have no shared resolution policy.

---

## 4. Target architecture

Use an explicit two-phase pipeline:

```text
Prepare durable state
  → Collect typed facts
  → Build candidate artifacts
  → Validate policy/freshness
  → Resolve conflicts and deduplicate
  → Plan against token budget
  → Order selected artifacts
  → Build provider-neutral request
  → Persist redacted manifest
  → Adapt to provider
```

### Why two phases

- **Facts** may require database/blob/integration I/O.
- **Contributors** must be pure transformations from facts to candidate artifacts.
- **Planner** must operate on candidates without performing I/O.
- **Provider adapters** must not decide semantic priority or privacy.

---

## 5. Proposed directory layout

Create incrementally under:

```text
apps/server/src/application/context/
├── contracts.ts
├── context-facts.ts
├── collect-context-facts.ts
├── prepare-context-state.ts
├── registry.ts
├── assemble-context.ts
├── planner.ts
├── policy.ts
├── conflicts.ts
├── manifest.ts
├── budget.ts
├── contributors/
│   ├── agent-profile.ts
│   ├── capability-guidance.ts
│   ├── garden-context.ts
│   ├── attachment-rules.ts
│   ├── mcp-tool-context.ts
│   ├── summary-memory.ts
│   ├── reflection-memory.ts
│   ├── observation-memory.ts
│   ├── run-transcript.ts
│   ├── visible-history-fallback.ts
│   ├── attachment-context.ts
│   ├── file-context.ts
│   └── request-tooling.ts
└── lifecycle/
    ├── compact-context.ts
    ├── observe-summary.ts
    └── reflect-memory.ts
```

Do not move every existing file immediately. New modules can initially delegate to existing formatters, then ownership can move after parity is established.

---

## 6. Core contracts

The exact names may change, but preserve these concepts.

### Context facts

`ContextFacts` is a read-only snapshot of durable state needed by contributors.

```ts
export interface ContextFacts {
  run: RunRecord
  agentProfile: AgentProfileContext | null
  visibleMessages: SessionMessageRecord[]
  visibleFiles: VisibleFileContextEntry[]
  liveTailItems: ItemRecord[]
  summary: ContextSummaryRecord | null
  activeReflection: MemoryRecordRecord | null
  observations: MemoryRecordRecord[]
  attachmentRefs: AttachmentRefDescriptor[]
  gardenContext: GardenAgentContext | null
  pendingWaits: RunDependencyRecord[]
  activeTools: ToolSpec[]
  nativeTools: AiProviderNativeToolName[]
  mcpMode: AgentMcpMode
  mcpCatalog: McpCodeModeCatalog | null
  capturedAt: string
}
```

Facts are not automatically model-visible.

### Artifact payload

Use a discriminated union so messages and request controls share provenance and budget accounting without pretending they are the same thing.

```ts
export type ContextArtifactPayload =
  | { kind: 'messages'; messages: AiMessage[] }
  | { kind: 'tools'; tools: AiToolDefinition[] }
  | { kind: 'native_tools'; tools: AiProviderNativeToolName[] }
  | { kind: 'request_options'; options: ContextRequestOptions }
  | { kind: 'metadata'; metadata: Record<string, string> }
```

### Context artifact

```ts
export interface ContextArtifact {
  id: string
  layer: ContextLayerKind
  source: ContextSource
  payload: ContextArtifactPayload

  visibility: 'model' | 'request'
  sensitivity: 'public' | 'private' | 'restricted' | 'secret'
  volatility: 'stable' | 'volatile'
  requirement: 'mandatory' | 'preferred' | 'optional'
  priority: number

  authority: ContextAuthority
  capturedAt: string
  expiresAt: string | null
  estimatedTokens: number

  dedupeKey: string | null
  conflictKey: string | null
  supersedes: string[]
  dependencies: string[]

  transformation:
    | { kind: 'none' }
    | { kind: 'truncated'; originalBytes: number; includedBytes: number }
    | { kind: 'summarized'; sourceRefs: string[]; summarizerVersion: string }
    | { kind: 'redacted'; fields: string[] }

  provenance: ContextProvenance
}
```

### Provenance

```ts
export interface ContextProvenance {
  sourceType:
    | 'user_message'
    | 'assistant_message'
    | 'tool_result'
    | 'agent_revision'
    | 'memory_summary'
    | 'memory_observation'
    | 'memory_reflection'
    | 'file'
    | 'garden'
    | 'integration'
    | 'runtime'
  sourceIds: string[]
  sourceVersion: string | null
  createdByRunId: string | null
}
```

### Contributor

Contributors are pure and synchronous unless a strong reason is documented.

```ts
export interface ContextContributor {
  id: string
  order: number
  build(input: ContextContributorInput): ContextArtifact[]
}
```

The registry must be explicit and statically imported:

```ts
export const contextContributors = [
  agentProfileContributor,
  capabilityGuidanceContributor,
  gardenContextContributor,
  attachmentRulesContributor,
  mcpToolContextContributor,
  summaryMemoryContributor,
  reflectionMemoryContributor,
  observationMemoryContributor,
  runTranscriptContributor,
  visibleHistoryFallbackContributor,
  attachmentContextContributor,
  fileContextContributor,
  requestToolingContributor,
] as const
```

Do not use global mutable registration. Explicit ordering is easier to audit and test.

---

## 7. Context authority and conflict policy

Define authority centrally. Initial precedence:

1. **Current explicit user correction**
2. **Current authoritative integration state**
3. **Current user message or attachment**
4. **Recent tool result from an authoritative source**
5. **Agent configuration/instructions** for behavioral policy, not user facts
6. **Recent visible conversation**
7. **Durable user-authored preference**
8. **Reflection**
9. **Observation**
10. **Compacted summary**
11. **Old inferred state**

Rules:

- Authority applies only within the same semantic `conflictKey`.
- Fresh current location may supersede old observed location, but not a durable home-address preference.
- User corrections should supersede derived memory and record that supersession.
- Contradictions from similarly authoritative sources should both survive with an explicit conflict note; do not silently pick one.
- Agent instructions must never override higher-level platform safety rules.
- Summaries and observations must carry source references and must not become more authoritative than their source.

Implement resolution as a pure function with table-driven tests.

---

## 8. Freshness policy

Each time-sensitive contributor must define expiry behavior.

Example defaults:

| Source | Suggested freshness |
|---|---:|
| Current location | 30–120 seconds |
| Battery/network state | 1–5 minutes |
| Calendar | fetched for requested time range; stamp retrieval time |
| Email/Linear state | stamp retrieval time; normally minutes |
| Agent revision | stable until revision changes |
| Garden configuration | stable until site/revision update |
| Conversation messages | durable, no expiry |
| Observation/reflection | no hard expiry, but lower authority with age |

Expired artifacts are either:

- rejected,
- included with an explicit stale label, or
- refreshed before candidate construction.

The policy must be contributor-specific and visible in the manifest.

---

## 9. Privacy and visibility invariants

These are non-negotiable:

1. `secret` artifacts cannot have `visibility: 'model'` or `visibility: 'request'` unless an explicit allowlisted secret-forwarding mechanism exists.
2. Authentication headers, API keys, OAuth tokens, cookies, password fields, storage keys, and encryption keys must be rejected by policy.
3. Account email/name and tenant membership are server-only unless a product requirement explicitly introduces a safe profile contributor.
4. Request correlation metadata is request-visible but not model-readable prose.
5. Every contributor declares sensitivity; missing sensitivity is a type/build failure.
6. Persisted manifests are redacted and must never contain raw binary data, full file contents, secrets, or encrypted reasoning payloads.
7. Add an automated forbidden-key scan for candidate payloads and final provider-neutral requests.

---

## 10. Budget planner

The planner receives candidates and a budget:

```ts
interface ContextBudget {
  contextWindow: number
  reservedOutputTokens: number
  requestOverheadTokens: number
  availableInputTokens: number
}
```

### Selection order

1. Validate mandatory dependencies and privacy.
2. Include mandatory artifacts.
3. Reject the request with a clear error if mandatory artifacts exceed budget; do not silently drop current user input or agent safety instructions.
4. Resolve conflicts and deduplicate.
5. Rank preferred and optional candidates by utility.
6. Apply allowed transformations: truncate, summarize, reduce image detail, collapse verbose tool output.
7. Fill remaining budget.
8. Produce selected and rejected lists with reasons.

### Initial requirement classes

**Mandatory**

- Active agent instructions and platform safety context
- Current user turn
- Unresolved function/tool state required for correctness
- Required delegated handoff state
- Request/tool definitions needed to continue the current run

**Preferred**

- Recent visible conversation
- Explicitly referenced attachments
- Latest summary
- Current authoritative integration facts relevant to the task
- Active reflection/observations with high relevance

**Optional**

- General Garden guidance when no Garden task is likely
- Unreferenced files
- Old observations
- Verbose capability prose already represented in tool descriptions

### Utility score

Start simple and deterministic:

```text
utility =
  requirementWeight
  + priority
  + relevanceScore
  + authorityScore
  + freshnessScore
  - tokenCostPenalty
```

Do not introduce an LLM-based selector initially. First ship a deterministic planner. LLM relevance ranking can be evaluated later behind a feature flag.

### Stable prefix

Stable/volatile classification continues to matter for caching:

- The stable prefix hash must include selected stable messages and request overhead.
- A contributor must not mark frequently changing data as stable.
- Selection order must not vary due to database row ordering.
- Sort all multi-record facts explicitly before artifact creation.

---

## 11. Memory and compaction

### Separate preparation from loading

Replace the current hidden side effects in `loadThreadContext()` with an explicit preparation stage:

```text
prepareContextState()
  1. ensure projection
  2. compact if needed
  3. observe new summary if enabled
  4. reflect eligible memory if enabled

collectContextFacts()
  1. read prepared projection
  2. read latest summary
  3. read memory records
  4. read agent/files/Garden/dependencies
  5. perform no writes
```

This makes fact collection reproducible after preparation.

### Compaction invariants

- Never compact child runs unless a separate child policy is designed.
- Never cross unresolved dependency boundaries.
- Preserve current user turn and unresolved calls/results.
- Persist `throughSequence` and source item IDs.
- Summary artifacts must declare transformation provenance.
- If summary token cost is not smaller than source head cost, keep the source items.
- Version summarizer prompts and algorithms.
- A manifest must indicate when original history was replaced by summary context.

### Memory invariants

- Observations are derived, not authoritative user facts.
- Reflection cannot silently supersede explicit user messages.
- Each observation/reflection must retain source summary/run references.
- Distinguish layer IDs:
  - `reflection_memory`
  - `observation_memory`
- Do not reuse `run_local_memory` for both in the new model.

---

## 12. Attachments and generated files

Preserve existing message-scoped attachment refs:

```text
image[1]
  → {{attachment:msg_...:kind:image:index:1}}
  → fil_...
```

Required behavior:

- File ID is durable identity.
- Friendly ordinal is scoped to a specific message.
- Full attachment token is safe for model reasoning and server resolution.
- Tool arguments must receive a real `fil_*` or resolvable full token, never a guessed path/URL.
- File artifacts record MIME type, size, message/run linkage, and exposure mode.
- Text truncation records original/included bytes.
- Image inlining records detail and estimated token cost.
- Generated image files linked to a run/session remain discoverable in later context.
- Delegated image work must explicitly carry relevant file IDs.

Potential follow-up: create descriptors for assistant/run-generated attachments, not only user message-linked files, so references to multiple prior generated images are deterministic rather than inferred from markdown order.

---

## 13. Tooling and MCP

Tool availability is request context, not ordinary prose.

- Continue filtering tools through agent revision/tool policy.
- Keep direct MCP tools as provider function schemas.
- In MCP code mode, omit direct MCP schemas and include the code-mode inventory contributor.
- Tool schema token cost must participate in budget planning.
- Capability guidance should not duplicate full tool descriptions.
- Tool calls/results required to continue a run are mandatory transcript artifacts.
- Unknown or unavailable tools must fail before provider invocation.

---

## 14. Provider adaptation

The planner outputs one provider-neutral assembly:

```ts
interface AssembledContext {
  messages: AiMessage[]
  tools: AiToolDefinition[]
  nativeTools: AiProviderNativeToolName[]
  requestOptions: ContextRequestOptions
  metadata: Record<string, string>
  manifest: ContextManifest
}
```

Provider adapters may:

- Convert message/content types.
- Convert tools and response format.
- Normalize images/files according to provider capability.
- Map reasoning settings.
- Add provider-specific cache/conversation options.

Provider adapters may not:

- Decide semantic priority.
- Read new database context.
- Bypass privacy policy.
- Silently drop mandatory artifacts.
- Reorder context without a documented provider requirement.

Add provider parity tests asserting that mandatory provider-neutral artifacts survive adaptation.

---

## 15. Context manifest

Persist a redacted manifest for each provider request/turn.

```ts
export interface ContextManifest {
  version: 'context/v2'
  assemblerVersion: string
  runId: string
  threadId: string | null
  turn: number
  generatedAt: string
  provider: string
  model: string

  budget: {
    contextWindow: number
    reservedOutputTokens: number
    requestOverheadTokens: number
    selectedInputTokens: number
    calibratedInputTokens: number | null
  }

  selected: ContextManifestEntry[]
  transformed: ContextManifestEntry[]
  dropped: ContextManifestEntry[]
  rejected: ContextManifestEntry[]
  conflicts: ContextConflictRecord[]

  stablePrefixHash: string
  finalMessageCount: number
  finalToolCount: number
}
```

Each entry records IDs, source IDs, layer, token estimate, authority, freshness, sensitivity class, transformation and selection reason—but not raw content.

Suggested drop reasons:

- `expired`
- `superseded`
- `duplicate`
- `conflict_lower_authority`
- `token_budget`
- `missing_dependency`
- `policy_rejected`
- `provider_unsupported`
- `not_relevant`

Expose manifests only through authenticated, tenant-scoped debug/observability APIs.

---

## 16. Migration plan

### Phase 0 — Freeze behavior with tests

Before refactoring:

- Add a golden test for exact current layer order.
- Add snapshots/structural assertions for current message output with:
  - plain conversation,
  - summary + live tail,
  - reflection + observations,
  - image + text attachment,
  - Garden context,
  - MCP direct and code modes,
  - delegated tool call/results.
- Add privacy tests for forbidden keys.
- Record current budget reports for fixtures.

Do not proceed until these tests are stable.

### Phase 1 — Extract pure contributors without behavior change

- Create `application/context/contracts.ts` and contributor modules.
- Keep existing `ThreadContextData` as input initially.
- Move existing `to*Messages()` functions into contributors one by one.
- Create an explicit ordered registry matching the current 15-layer order.
- Keep empty reserved layers during parity, then remove in a later intentional change.
- Have `assembleThreadInteractionRequest()` delegate to the registry.
- Assert byte/structure parity of provider-neutral request and budget report.

### Phase 2 — Introduce artifacts and manifests

- Wrap contributor outputs in `ContextArtifact`.
- Add provenance, sensitivity, volatility, priority, and requirement.
- Initially select every artifact to preserve behavior.
- Generate a manifest in shadow mode without persisting it.
- Compare artifact-derived output with legacy output in tests.
- Persist redacted manifests after schema/repository review.

### Phase 3 — Split preparation and read-only collection

- Create `prepareContextState()` for compaction/observe/reflect.
- Create `collectContextFacts()` with no writes.
- Update `drive-run.ts` to call preparation, then collection, then assembly.
- Keep `GET /threads/:threadId/budget` read-only by using preparation options that do not mutate state.
- Add determinism tests: collecting facts twice after preparation returns equivalent normalized facts.

### Phase 4 — Add policy, conflicts, and deterministic planning

- Implement privacy validation first.
- Add dependency validation and dedupe.
- Add conflict resolution.
- Add mandatory/preferred/optional planning.
- Run planner in shadow mode and compare proposed drops with legacy inclusion.
- Add a feature flag/config version to switch selected accounts or test fixtures to v2 planning.

### Phase 5 — Add new sources

Only after v2 parity and manifesting:

- Add mobile/device context.
- Add account/user preference context.
- Add calendar/email/Linear context where product requirements justify it.
- Add generated-file descriptors.
- Every source requires freshness, authority, sensitivity, budget, and conflict policies.

### Phase 6 — Remove legacy assembly

Remove the old path only when:

- v2 has run in production shadow mode,
- manifests explain all meaningful differences,
- evals show no quality regression,
- privacy checks pass,
- token/cost impact is accepted,
- rollback remains available for at least one release.

---

## 17. Test strategy

### Unit tests

- One focused test file per contributor.
- Artifact validation and sensitivity rules.
- Freshness boundaries.
- Conflict precedence table.
- Dedupe and supersession.
- Planner under exact, insufficient, and abundant budgets.
- Deterministic order regardless of source row order.
- Manifest redaction.

### Integration tests

- Durable thread → prepared state → facts → artifacts → request.
- Compaction with live tail.
- Pending waits around compaction boundaries.
- User-uploaded and generated files.
- Tool calls/results and delegated child result delivery.
- MCP direct versus code mode.
- Provider adaptation parity.

### Security tests

Search candidate and final request structures for forbidden key/value classes:

- `authorization`
- `apiKey`, `api_key`
- `accessToken`, `refreshToken`
- `cookie`, `password`, `secret`
- blob/storage keys
- encrypted credential payloads

Use allowlists, not only denylists, for secret-bearing records.

### Golden/evaluation fixtures

Maintain representative fixtures:

1. New thread, text only
2. Long thread before/after compaction
3. User correction contradicting old memory
4. Fresh location contradicting old observed location
5. Multiple attached images with editing request
6. Generated image edited in a later turn
7. Garden file task
8. Tool approval/wait
9. Parent → child delegation → parent continuation
10. Tight context window requiring omission

Evaluate answer quality, included sources, token count, latency, and privacy.

---

## 18. Acceptance criteria

The redesign is complete only when all are true:

- [ ] Existing behavior has characterization tests.
- [ ] Every context contributor lives in a focused module.
- [ ] Registry order is explicit and tested.
- [ ] Fact collection is read-only after explicit preparation.
- [ ] Every artifact has provenance, sensitivity, volatility, requirement, priority, authority, freshness, and token estimate.
- [ ] Secrets cannot become provider-visible through type/policy paths.
- [ ] Conflict and dedupe behavior is deterministic and tested.
- [ ] Mandatory context cannot be silently dropped.
- [ ] Budget planning explains all omissions.
- [ ] Reflection and observation have distinct layer IDs.
- [ ] Provider adapters preserve mandatory provider-neutral artifacts.
- [ ] A redacted manifest is persisted per provider request/turn.
- [ ] Manifests are tenant-scoped and inspectable.
- [ ] Shadow-mode comparison shows accepted parity/differences.
- [ ] Production rollout has a feature flag and rollback path.
- [ ] Adding a new source requires one contributor, optional fact loader, registration, and focused tests—not edits throughout the assembler.

---

## 19. Implementation protocol for future agents

When resuming this work:

1. Read this file and `report.html`.
2. Run `git status --short --branch` before editing. The repository may contain unrelated work; do not stage or overwrite it.
3. Read the current versions of the source files listed in section 3. Do not assume line numbers or prior diffs still match.
4. Check recent commits for partial context-v2 work.
5. Run existing context assembly tests before changing behavior.
6. Work phase-by-phase. Do not jump to dynamic planning before parity and manifests.
7. Keep commits narrow. Never mix unrelated Garden, deployment, mobile, or provider work.
8. Update this document after each completed phase:
   - mark completed tasks,
   - record decisions,
   - list new files,
   - document deviations,
   - add migration/rollback notes.
9. Include exact test commands and results in commit/PR notes.
10. Do not claim production completion until the acceptance checklist is satisfied.

### Suggested verification commands

```bash
cd /Users/overment/wonderlands

npm run typecheck:server
npm run test:server -- --run test/assemble-thread-interaction-request.test.ts
npm run test:server
npm run typecheck
```

The full suite may contain unrelated failures in an active working tree. Always run focused tests and report unrelated failures explicitly rather than hiding them.

---

## 20. First implementation task

The safest first coding task is **Phase 0 + the beginning of Phase 1**:

1. Add exact layer-order and parity tests.
2. Create `application/context/contracts.ts`.
3. Extract `agent-profile` contributor.
4. Add it to an explicit registry.
5. Keep the legacy assembler output identical.
6. Prove request and budget parity with focused tests.
7. Commit only that slice.

Do not begin with mobile context, an LLM selector, database schema changes, or provider adapter changes.

---

## 21. Open decisions

Resolve these with explicit ADRs or comments before implementation reaches planning:

- Where should context manifests be persisted: event store, dedicated table, observability outbox, or run result metadata?
- Should manifests store content hashes for replay verification?
- Which platform safety instructions occupy the currently empty `system_prompt` layer?
- Which artifacts may be summarized versus only truncated or dropped?
- Should relevance initially be rule-based only, or can embeddings be used after deterministic v2 ships?
- How should mobile context be authenticated, scoped, and expired?
- Should generated assistant/run files receive message-scoped attachment refs?
- How long should manifests be retained?
- Which debug surfaces can display private provenance safely?

Until decided, choose conservative defaults: deterministic rules, minimal retention, no raw content in manifests, and no new model-visible personal data.

---

## 22. Multi-agent execution plan

The parent agent acts as **Cora**, the permanent coordinator/integrator. Cora owns shared contracts, the static registry, central assembly/runtime integration, merge order, release gates, and this document. No implementation agent may modify shared integration files unless its briefing explicitly delegates them.

Permanent reviewers:

- **Quinn — Quality:** characterization fixtures, deterministic replay, parity comparisons, and rollout evaluation.
- **Sable — Security:** privacy policy, manifest redaction, tenancy, and fail-closed validation.

Execution waves:

| Wave | Goal | Parallel roles | Gate before next wave |
|---|---|---|---|
| 0 | Freeze legacy behavior | request characterization, lifecycle characterization, privacy baseline | deterministic tests pass twice |
| 1 | Extract pure contributors | contract foundation first; then profile, Garden/MCP, files, memory/transcript, and request-tooling contributors | request, layers, budget and stable-prefix parity |
| 2 | Add typed artifacts | contributor metadata, policy validation, pure manifest builder, artifact parity tests | shadow artifacts cannot alter sent requests |
| 3 | Split lifecycle | preparation agent, read-only facts collector, determinism reviewer, coordinator integration | collector and budget GET proven read-only |
| 4 | Add deterministic decisions | privacy/freshness policy, conflict engine, token planner, shadow evaluator | no mandatory artifact can be dropped |
| 5 | Persist manifests | repository/schema agent, authenticated query agent, security review | redaction and cross-tenant tests pass |
| 6 | Roll out v2 | provider parity, feature configuration, cohort evaluation | accepted quality/cost/latency/privacy thresholds |
| 7 | Add sources | one vertical-slice agent per new source | source-specific freshness, authority, budget and consent rules |
| 8 | Remove legacy | coordinator only after one release with tested rollback | all acceptance criteria complete |

### Agent-awareness contract

Every spawned agent briefing must state:

1. Overall Context Assembly v2 mission and current rollout mode.
2. Agent identity, wave, specific deliverable, and baseline integration commit.
3. Cora, Quinn, Sable, and all wave peers with their ownership boundaries.
4. Files the agent owns and files it must not modify.
5. Inputs from prior waves and the exact export/handoff expected by the next wave.
6. Determinism, privacy, parity, and no-unrelated-refactor constraints.
7. Required focused tests and stop conditions.

Each agent must hand back its commit SHA, changed files, exact test results, assumptions, unresolved risks, security notes, and integration prerequisites. Parallel agents branch from the same coordinator baseline; contributors never self-register. Cora merges foundations first, leaf modules second, and shared integration last.

### Rollback ladder

- **R0:** characterization-only baseline.
- **R1:** legacy assembler before contributor delegation.
- **R2:** contributor parity with artifacts disabled.
- **R3:** compatibility loader before lifecycle split.
- **R4:** planner shadow mode before v2 selection is sent.
- **R5:** manifest storage present but persistence disabled.
- **R6:** cohort v2 with immediate configuration rollback to legacy.
- **R7:** default v2 while retaining legacy for one release.

During implementation, update this section with completed waves, baseline commit SHAs, accepted deviations, and exact rollback configuration.

### Execution status — 2026-07-19

Completed and integrated:

- **Wave 0:** legacy request, lifecycle, and privacy characterization.
- **Wave 1:** all 15 ordered layers extracted into pure statically registered contributors with exact request/budget/hash parity.
- **Wave 2:** strict typed artifacts, provenance metadata, policy evaluation, request-control artifacts, and deterministic redacted shadow manifests.
- **Wave 3:** explicit state preparation, immutable read-only fact collection, and a write-free thread budget route.
- **Wave 4:** deterministic privacy/freshness/dependency policy, conflict/deduplication engine, and mandatory-first token planner running in shadow mode.
- **Wave 5:** tenant-scoped manifest repository, migration `0035_context_manifests.sql`, pre-provider persistence, and authenticated thread manifest inspection.
- **Wave 6 (safe rollout controls):** `CONTEXT_ASSEMBLY_MODE=legacy|v2_shadow`, `CONTEXT_MANIFEST_PERSIST`, and `CONTEXT_V2_ACCOUNT_ALLOWLIST`. Defaults are `legacy` and persistence disabled. Unknown/active modes fail closed.

Current rollback configuration:

```text
CONTEXT_ASSEMBLY_MODE=legacy
CONTEXT_MANIFEST_PERSIST=false
CONTEXT_V2_ACCOUNT_ALLOWLIST=
```

Validated baseline after Wave 6: 105 server test files / 661 tests passed in the implementing agent; coordinator verification covered 69 rollout/config/execution/provider tests plus full server/client typechecks.

Intentionally not activated yet:

- Active `v2` request selection. The planner is shadow-only until selected artifacts can be projected into an active request with granular mandatory current-turn/tool-state guarantees.
- New personal/integration sources such as device state, location, calendar, and email.
- Legacy removal, which requires production shadow evidence and one release with tested rollback.
