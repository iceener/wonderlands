# UX Audit: Agent, Tool Profile, MCP Server Forms

**Date:** 2026-04-01
**Scope:** AgentForm, ToolProfileForm, McpServerForm, ChatComposer target controls
**Method:** Heuristic evaluation + cognitive walkthrough against 53 identified user scenarios
**Audience:** Developer-users who understand AI agents but have never seen this UI

## Scoring

Each finding is rated on five metrics (1-5 scale):

- **Findability** — Can the user locate the right screen/control?
- **Learnability** — Does the UI teach the concept without docs?
- **Task Efficiency** — How many screens/clicks/scrolls to complete?
- **Feedback Clarity** — Does the UI confirm what happened?
- **Error Recoverability** — Can the user self-correct when confused?

Severity levels:

- **Blocker** — score 1-2 on any metric; user cannot or will not complete the task
- **Friction** — score 3 on multiple metrics; user completes but is confused or slow
- **Polish** — score 4; minor improvement, not urgent

---

## Blocker Findings

### B1. Tool profile shows raw ID instead of human name

**Screens:** AgentForm (tool profile radio list), ToolProfileForm (name field, ID badge)
**Scenarios affected:** 29, 34, 35, 41, 42

The tool profile radio option in the agent form reads:

> `Assistant acc_fed69f97c4a64f5b9154b90014e75a6b`

This is the profile name, but the name itself is the raw account ID. The seed data creates the assistant tool profile with the account ID as its name. A user seeing this for the first time has no way to know what this profile contains or why it exists.

The same ID appears as the profile name inside ToolProfileForm. The info badge below compounds this:

> `Tool profile ID: tpf_assistant_fed69f97c4a64f5b9154b90014e75a6b`

Two different opaque IDs on one screen. Neither communicates what tools are granted.

| Metric | Score | Reason |
|---|---|---|
| Findability | 4 | The radio list is visible |
| Learnability | 1 | Raw IDs teach nothing about what the profile does |
| Task Efficiency | 3 | User must click through to the profile to understand it |
| Feedback Clarity | 2 | After selecting, the info box just restates the ID |
| Error Recoverability | 3 | User can deselect, but can't tell if they picked the right one |

**Recommendation:** Seed data should create profiles with human names like "Assistant Default" or "My Tools". The agent form radio should show a tool count summary (e.g. "Assistant Default — 12 tools from 3 servers") so the user can choose without navigating away.

---

### B2. Two separate save buttons on ToolProfileForm create ambiguous save state

**Screens:** ToolProfileForm
**Scenarios affected:** 19, 20, 21, 22, 23, 24, 25

The form has "Save Profile" (for name/scope/status) and "Save Tool Access" (for tool assignments) as two independent actions. A user who changes the name and toggles a tool, then clicks "Save Tool Access", will lose the name change. Or worse: they click "Save Profile" and assume tool changes are saved too.

No other form in this UI has split saves. The agent form has one "Save Changes" button.

| Metric | Score | Reason |
|---|---|---|
| Findability | 4 | Both buttons are visible |
| Learnability | 2 | Nothing explains they are independent; contradicts the single-save pattern elsewhere |
| Task Efficiency | 2 | User must remember to click both; two round-trips |
| Feedback Clarity | 2 | "Saved tool profile" after first save implies everything is saved |
| Error Recoverability | 2 | Lost changes are silent; no dirty-state warning for the other section |

**Recommendation:** Either unify into one save action, or add explicit dirty-state indicators per section (e.g. a dot or "unsaved changes" label next to each section header). Consider at minimum a warning if the user navigates away with unsaved changes in either section.

---

### B3. MCP server form says "Manage MCP grants from a tool profile, not from this server screen" but gives no path if no tool profile exists yet

**Screens:** McpServerForm (read mode, Tool Access section)
**Scenarios affected:** 1, 2, 44, 45

The Tool Access section shows two buttons: "Manage assistant tool profile" and "New Tool Profile". But "Manage assistant tool profile" is disabled when `assistantToolProfileId` is null (first-time setup). The "New Tool Profile" button navigates away from the server form entirely.

A first-time user who just connected their first MCP server and sees 6 discovered tools has no way to assign them without leaving, creating a profile, then coming back. The UI tells them what NOT to do here but doesn't streamline what TO do.

| Metric | Score | Reason |
|---|---|---|
| Findability | 3 | Buttons exist but one may be disabled |
| Learnability | 2 | "Not from this screen" is a dead end for new users |
| Task Efficiency | 1 | Requires leaving, creating a profile, returning, then navigating to the profile again to assign |
| Feedback Clarity | 3 | The explanation text is clear about the concept |
| Error Recoverability | 4 | User can navigate back |

**Recommendation:** When no tool profile exists, show an inline "Create and assign" affordance that creates a default profile and pre-selects this server's tools in one flow. Alternatively, offer a quick-action: "Create a tool profile with all tools from this server".

---

### B4. Discovered Tools section on MCP server form shows non-interactive checkboxes

**Screens:** McpServerForm (read mode, Discovered Tools section)
**Scenarios affected:** 17, 46

The discovered tools list renders empty checkbox-shaped squares next to each tool name. These are not interactive — they are purely decorative placeholders. But they look exactly like the interactive checkboxes in the ToolProfileForm. A user will try to click them, fail silently, and be confused.

| Metric | Score | Reason |
|---|---|---|
| Findability | 5 | Tools are listed |
| Learnability | 2 | Checkbox shapes imply interactivity that doesn't exist |
| Task Efficiency | 2 | User wastes time clicking non-functional controls |
| Feedback Clarity | 1 | No feedback on click; no explanation that assignment happens elsewhere |
| Error Recoverability | 3 | User isn't stuck, just confused |

**Recommendation:** Either remove the checkbox shapes entirely (use a simple bullet or tool icon), or make the discovered tools section explicitly read-only with a visual treatment that differs from the interactive checkboxes (dimmed, no hover state, perhaps a lock icon or "preview only" label).

---

### B5. No way to see which agents consume a tool profile

**Screens:** ToolProfileForm
**Scenarios affected:** 27, 51

Before editing a tool profile (removing tools, archiving, changing scope), a user needs to know the blast radius — which agents use this profile. The form shows whether it's the assistant default, but not which agents reference it.

| Metric | Score | Reason |
|---|---|---|
| Findability | 1 | Information doesn't exist anywhere in the UI |
| Learnability | N/A | — |
| Task Efficiency | 1 | User must manually check each agent to find references |
| Feedback Clarity | 1 | No indication of downstream effects |
| Error Recoverability | 2 | Changes are saved immediately; no undo |

**Recommendation:** Add a "Used by" section to ToolProfileForm showing linked agents and whether this is the assistant default. This is the most important context for safe editing.

---

### B6. "Default Target" button state is confusing

**Screens:** AgentForm header
**Scenarios affected:** 6, 39, 48

The "Default Target" button appears greyed out when the agent IS the default. This reverses the expected affordance — disabled usually means "you can't do this", but here it means "already done". There is no visual distinction between "this is the default" (a status) and "set as default" (an action).

| Metric | Score | Reason |
|---|---|---|
| Findability | 4 | Button is in the header |
| Learnability | 2 | Disabled state reads as "unavailable" not "already active" |
| Task Efficiency | 4 | One click when available |
| Feedback Clarity | 2 | After setting, the button just becomes disabled with same label |
| Error Recoverability | 3 | No way to unset default from this screen |

**Recommendation:** Split into a status indicator ("Default target" badge/tag) and a separate action ("Set as default" button, hidden when already default). Also: provide a way to clear the default or switch to assistant mode from this screen, not only from account preferences.

---

## Friction Findings

### F1. Agent form is very long — requires significant scrolling

**Screens:** AgentForm (images 1 + 2)
**Scenarios affected:** 29, 30, 31, 32, 33, 34, 35, 36

The form spans: Name → Category + Visibility → Model Configuration (provider + model grid + reasoning radio list of 6 items) → Capabilities & Tool Access (4 native tools + tool profile radio list) → Subagents → Instructions editor → Save button.

On a standard viewport the user must scroll 3-4 screens to go from name to save. The reasoning effort section alone takes nearly a full screen height with 6 radio options. A user editing just the instructions (scenario 30) must scroll past everything to reach it.

| Metric | Score | Reason |
|---|---|---|
| Findability | 3 | Sections exist but are far apart |
| Learnability | 4 | Sections are well-labeled |
| Task Efficiency | 3 | Excessive scrolling for single-field edits |
| Feedback Clarity | 3 | Save button at very bottom, not visible when editing top fields |
| Error Recoverability | 4 | No data loss from scrolling |

**Recommendation:** Consider collapsible/accordion sections so the user can focus on one area at a time. Alternatively, a sticky save button or a sidebar section nav (like settings pages in VS Code or GitHub). Instructions being at the very bottom is a questionable priority order — it is arguably the most-edited field and should be higher or have a quick-jump.

---

### F2. No inline navigation between related forms

**Screens:** AgentForm, ToolProfileForm, McpServerForm
**Scenarios affected:** 41, 42, 43, 44, 45

Cross-form navigation exists but is always one-way and loses context:

- AgentForm → "Manage Selected Profile" opens ToolProfileForm, but there's no breadcrumb or back-to-agent link from ToolProfileForm
- ToolProfileForm → "manage server" opens McpServerForm, same problem
- McpServerForm → "New Tool Profile" opens ToolProfileForm

Each form only has "Back to Chat". A user doing scenario 42 (agent → edit tool profile → return to agent) must use "Back to Chat" and then re-navigate to the agent form. The navigated-from context is lost.

| Metric | Score | Reason |
|---|---|---|
| Findability | 3 | Links exist but return path doesn't |
| Learnability | 3 | User learns by trial that "Back to Chat" is the only exit |
| Task Efficiency | 3 | Round-trip requires re-opening the original form |
| Feedback Clarity | 3 | No breadcrumb or "you came from Agent: Alice" context |
| Error Recoverability | 4 | No data loss, just extra navigation |

**Recommendation:** Add breadcrumb-style navigation or a "Back to [Agent: Alice]" link when the form was opened from another form. Alternatively, open sub-forms in a slide-over panel so the parent form stays visible underneath.

---

### F3. Tool profile trust model is not self-explanatory

**Screens:** ToolProfileForm (MCP Tool Access section)
**Scenarios affected:** 23, 24, 53

Each tool has an "untrusted"/"trusted" toggle. The only explanation is in the section description: "Toggle external MCP tools for this profile." Nothing explains what trusted vs untrusted means at runtime — that trusted tools execute without confirmation while untrusted tools pause for user approval.

The trusted/untrusted badge is also visually subtle (small grey text vs small green text). A user who doesn't understand the runtime confirmation flow will either trust everything (security risk) or trust nothing (friction during chat).

| Metric | Score | Reason |
|---|---|---|
| Findability | 4 | Badge is visible per tool |
| Learnability | 3 | "Trusted" is vague without runtime context |
| Task Efficiency | 4 | Toggle works fine |
| Feedback Clarity | 3 | State is shown but meaning isn't explained |
| Error Recoverability | 4 | Easily toggled back |

**Recommendation:** Add a one-line tooltip or info-text: "Trusted tools run immediately. Untrusted tools pause for your approval during chat." Consider renaming to "auto-approve" / "ask before running" which is more self-describing than "trusted"/"untrusted".

---

### F4. No confirmation or preview before saving tool access changes

**Screens:** ToolProfileForm
**Scenarios affected:** 20, 21, 22, 23, 24

"Save Tool Access" fires individual assign/delete API calls sequentially for every changed tool. There is no preview of what will change (e.g. "Adding 3 tools, removing 1, changing trust on 2"). The dirty indicator (`toolSelectionDirty`) exists in code but isn't surfaced as a diff summary to the user.

For a profile with many tools across multiple servers, the user has no way to review what they changed before committing, especially after scrolling through a long list.

| Metric | Score | Reason |
|---|---|---|
| Findability | 4 | Save button is clear |
| Learnability | 4 | — |
| Task Efficiency | 3 | No bulk preview |
| Feedback Clarity | 3 | "Saved tool access" doesn't say what changed |
| Error Recoverability | 3 | Must manually re-toggle to undo; no undo action |

**Recommendation:** Show a change summary before save (e.g. "+3 assigned, -1 removed, 2 trust changes") either inline or as a confirmation step. Consider making the save button label dynamic: "Save 6 changes" instead of generic "Save Tool Access".

---

### F5. Category (Primary / Specialist / Derived) has no explanation

**Screens:** AgentForm
**Scenarios affected:** 29, 37

The Category segment control offers three options with no description of what they mean or how they affect behavior. Unlike Reasoning Effort (which has per-option descriptions) or Visibility (which is self-explanatory), Category is domain jargon.

| Metric | Score | Reason |
|---|---|---|
| Findability | 5 | Prominent on form |
| Learnability | 2 | No tooltip, description, or hint for any option |
| Task Efficiency | 5 | One click |
| Feedback Clarity | 3 | Selection is clear but meaning isn't |
| Error Recoverability | 5 | Easy to change |

**Recommendation:** Either add short descriptions under each option (like Reasoning Effort does), or add a help tooltip on the "Category" label. If Category is purely organizational metadata with no runtime effect, say so explicitly — "Category is for organizing your agents. It does not affect behavior."

---

### F6. No empty state guidance on first visit to agent form

**Screens:** AgentForm (new agent mode)
**Scenarios affected:** 5, 29

When creating the first agent ever, the form opens with blank fields, the subagents section says "Create another agent first", and the tool profile section may show no profiles. There is no onboarding hint, suggested template, or explanation of what makes a useful agent configuration.

| Metric | Score | Reason |
|---|---|---|
| Findability | 4 | Form is reachable |
| Learnability | 3 | Blank form is intimidating; no guidance on what matters most |
| Task Efficiency | 3 | User must guess reasonable defaults |
| Feedback Clarity | 3 | — |
| Error Recoverability | 4 | Validation catches missing required fields |

**Recommendation:** For new agents, consider pre-filling a sensible template (e.g. name placeholder "My Agent", default model pre-selected, `delegate_to_agent` pre-checked as it already is). Add a short hint: "Start with a name and instructions. You can configure model and tools later."

---

### F7. Composer target bar is dense and hard to parse

**Screens:** ChatComposer (bottom bar in images 1-2)
**Scenarios affected:** 7, 8, 9, 10, 11, 12, 48

The bottom bar reads:

> `Target  Default  Assistant  Agent: Alice  Alice  New thread  gpt-5.4  medium  fast  0%`

This is a flat row of labels and chip-buttons with no visual grouping. "Target" is a label, "Default" / "Assistant" / "Agent: Alice" are selectable chips, then "Alice" appears again (the agent name?), then thread info, model info, and a progress bar — all in one line.

A user trying to understand the current target must parse this entire bar. The selected state ("Agent: Alice" appears slightly highlighted) is subtle. "Default" vs "Assistant" vs "Agent: Alice" as three peer options is conceptually correct but visually undifferentiated.

| Metric | Score | Reason |
|---|---|---|
| Findability | 3 | Bar is always visible but crowded |
| Learnability | 3 | Three target options without explanation of "Default" |
| Task Efficiency | 4 | One click to switch |
| Feedback Clarity | 3 | Selected state is subtle; meaning of "Default" requires prior knowledge |
| Error Recoverability | 5 | Easy to click another option |

**Recommendation:** Visually separate the target selector from the info bar (thread name, model, speed). Consider a dropdown or popover for target selection instead of inline chips. "Default" should show what it resolves to — e.g. "Default (Alice)" or "Default (Assistant)" — so the user knows what will actually happen.

---

### F8. MCP server form edit/read mode transition is disorienting

**Screens:** McpServerForm
**Scenarios affected:** 13, 15, 18

The form has two modes: edit mode (showing input fields) and read mode (showing connection summary + tool access + discovered tools). Clicking "Edit" switches to a completely different layout. Clicking "Save and Refresh" switches back. There's no visual continuity between the two modes — they feel like different pages.

| Metric | Score | Reason |
|---|---|---|
| Findability | 4 | Edit button is clear |
| Learnability | 3 | Mode switch is jarring |
| Task Efficiency | 3 | Must enter edit mode for any connection change |
| Feedback Clarity | 3 | After save, entire layout changes |
| Error Recoverability | 4 | Can re-enter edit mode |

**Recommendation:** Consider inline editing (click on URL to edit it in-place) instead of a full mode switch. Or keep the read mode layout as the base and expand an edit panel within it.

---

### F9. OAuth flow has no inline progress indicator

**Screens:** McpServerForm (authorize flow)
**Scenarios affected:** 2, 14

Clicking "Authorize" opens a popup window for OAuth. The main form shows "Authorizing..." on the button but gives no other indication of what's happening, what the user should do in the popup, or how long it takes. If the popup is blocked, the error is thrown but the user may not connect "popup was blocked" to their browser settings.

| Metric | Score | Reason |
|---|---|---|
| Findability | 4 | Button is clear |
| Learnability | 3 | OAuth is a known pattern but popups are unreliable |
| Task Efficiency | 3 | Depends on external popup flow |
| Feedback Clarity | 3 | "Authorizing..." is minimal; no progress steps shown |
| Error Recoverability | 3 | Can retry, but popup-blocked errors are vague |

**Recommendation:** Show an inline step indicator: "1. Complete authorization in the popup window. 2. Return here after approving." Add explicit guidance when the popup is blocked: "Your browser blocked the popup. Allow popups for this site and try again."

---

## Polish Findings

### P1. Server label duplication in MCP server form header

**Screens:** McpServerForm read mode
**Scenarios affected:** 13, 15

The page title shows the server label ("files"), then the Connection section repeats it with badges ("files BUILT-IN CONNECTED"). The subtitle also says "Manage discovery, connection details, and assistant tool profile." — the phrase "assistant tool profile" in a server management context leaks the wrong abstraction.

**Recommendation:** Remove the label from Connection section header (it's already the page title). Change subtitle to "Manage connection and discovery."

---

### P2. "Manage Selected Profile" link text in AgentForm is confusing when nothing is selected

**Screens:** AgentForm, tool access section
**Scenarios affected:** 41

When no tool profile is selected, the link reads "Create Tool Profile" (correct). When one is selected, it reads "Manage Selected Profile". But "Manage" is vague — does it mean edit the profile's metadata, or edit which tools are in it?

**Recommendation:** Change to "Edit Tool Profile" or "Edit [profile name]" for clarity.

---

### P3. Reasoning effort descriptions are inconsistent between providers

**Screens:** AgentForm, reasoning section

Google provider shows only "Provider default" and "No reasoning" with generic descriptions ("Use Gemini's default thinking behavior" repeated). OpenAI shows 6 granular options with distinct descriptions. This asymmetry is accurate to provider capabilities but makes Google feel broken or incomplete.

**Recommendation:** Add a one-liner explaining the asymmetry: "Google Gemini currently supports default or disabled thinking only." (This already exists in the footnote but is easy to miss.)

---

### P4. ToolProfileForm doesn't refresh tool list after navigating back from server management

**Screens:** ToolProfileForm
**Scenarios affected:** 43

If a user clicks "manage server" to fix a broken MCP connection, then returns to the tool profile, the tool list is stale. The user must manually know to trigger a refresh (and there's no explicit refresh button on the tool access section).

**Recommendation:** Re-fetch MCP tools when the form regains focus or when the user returns from a sub-navigation. Or add a visible "Refresh tools" button in the MCP Tool Access section header.

---

### P5. No search/filter in tool lists when server has many tools

**Screens:** ToolProfileForm (MCP Tool Access)
**Scenarios affected:** 20, 21, 22

The Spotify server shows 6 tools, which is manageable. But servers can expose dozens of tools. With 3 servers x 15 tools each, the user is scrolling through 45 checkboxes with no way to search or filter.

**Recommendation:** Add a text filter at the top of the MCP Tool Access section for profiles with more than ~10 tools total.

---

### P6. No indication of which tools are actually in use (called recently)

**Screens:** ToolProfileForm
**Scenarios affected:** 46, 52

When deciding which tools to keep assigned, the user has no data on which tools are actually being called during chat. All tools look equally important.

**Recommendation:** Low priority, but future consideration: show a "last used" or call count hint per tool to help with cleanup decisions.

---

## Summary Table

| ID | Severity | Screen | Core Problem |
|---|---|---|---|
| B1 | Blocker | AgentForm, ToolProfileForm | Raw IDs instead of human names |
| B2 | Blocker | ToolProfileForm | Two separate save buttons, silent partial saves |
| B3 | Blocker | McpServerForm | Dead end for first-time tool assignment |
| B4 | Blocker | McpServerForm | Non-interactive checkboxes look interactive |
| B5 | Blocker | ToolProfileForm | No visibility into which agents use a profile |
| B6 | Blocker | AgentForm | Default target button state is backwards |
| F1 | Friction | AgentForm | Form too long, excessive scrolling |
| F2 | Friction | All forms | No back-navigation between related forms |
| F3 | Friction | ToolProfileForm | Trust model not explained |
| F4 | Friction | ToolProfileForm | No change summary before saving tool access |
| F5 | Friction | AgentForm | Category options unexplained |
| F6 | Friction | AgentForm | No first-time guidance |
| F7 | Friction | ChatComposer | Target bar dense and hard to parse |
| F8 | Friction | McpServerForm | Edit/read mode transition is jarring |
| F9 | Friction | McpServerForm | OAuth flow lacks inline guidance |
| P1 | Polish | McpServerForm | Label duplication, leaked abstraction in subtitle |
| P2 | Polish | AgentForm | "Manage Selected Profile" is vague |
| P3 | Polish | AgentForm | Provider reasoning asymmetry feels broken |
| P4 | Polish | ToolProfileForm | Stale tool list after sub-navigation |
| P5 | Polish | ToolProfileForm | No search/filter for long tool lists |
| P6 | Polish | ToolProfileForm | No usage data for cleanup decisions |

## Recommended Priority Order

1. **B1** — fix seed names + add tool count to radio (quick win, big clarity gain)
2. **B4** — remove fake checkboxes from discovered tools (quick win)
3. **B2** — unify save or add dirty-state warnings (medium effort, prevents silent data loss)
4. **B3** — add inline quick-create for first tool profile from MCP server screen (medium effort)
5. **B6** — split default target into status badge + action (small effort)
6. **B5** — add "used by" section to tool profile (requires backend query)
7. **F7** — redesign composer target bar grouping (medium effort, high daily visibility)
8. **F2** — add contextual back-links between forms (medium effort)
9. **F1** — collapsible sections or sticky save on agent form (medium effort)
10. **F3-F9** — remaining friction items in any order

---

## Information Architect Review

### 1. Concept Hierarchy

The intended dependency chain — Agent → Tool Profile → MCP Server — is architecturally sound but poorly surfaced. The UI never presents this chain as a visible model. Users must infer it by navigating between three separate forms, each of which only exposes one link in the chain.

**Where it works:** AgentForm's "Capabilities & Tool Access" section does group native capabilities (checkboxes) separately from the tool profile selector (radio), implying that tool access is a distinct, reusable concept. The cross-link to ToolProfileForm ("Manage Selected Profile") reinforces that the profile is a first-class object.

**Where it breaks down:**

- **No top-down overview.** There is no screen where a user can see "Agent Alice → Profile Alpha → Servers X, Y, Z" in a single view. Scenario 46 ("what tools does my agent actually have access to?") requires mentally composing three screens: check which profile the agent references, open that profile, then inspect which servers contribute tools. This is a three-hop lookup for a fundamental question.
- **The MCP Server is an orphan in the hierarchy.** McpServerForm's read mode explicitly says "Manage MCP grants from a tool profile, not from this server screen." This is honest but architecturally confusing — it tells the user they are on the wrong screen without explaining why. The server knows it has tools but refuses to let the user act on them, which breaks the expectation that the object's own screen is where you manage it.
- **Tool Profile → MCP Server direction is implicit.** In ToolProfileForm, tools are "grouped by server," but the server is a visual grouping header, not an explicit dependency declaration. Users see checkboxes under server names but never explicitly say "this profile uses this server." The profile appears to grant individual tools, not reference servers. This subtly teaches a flat model (profile → tools) rather than the layered one (profile → server → tools).

### 2. Navigation Structure

Cross-form links exist but form an asymmetric graph. AgentForm links to ToolProfileForm. ToolProfileForm links to McpServerForm. McpServerForm links back to ToolProfileForm. But several return paths are missing:

- **AgentForm → ToolProfileForm has no return link.** Scenario 42 ("agent → edit tool profile → return to agent") depends entirely on browser back or "Back to Chat", neither of which restores context. If the user makes edits in ToolProfileForm and saves, nothing suggests it returns the user to the agent they came from.
- **McpServerForm → AgentForm is nonexistent.** A user who starts at a server and wants to know which agents are affected (scenario 27 adjacent) has no forward path. They must go back to ToolProfileForm, then somehow to AgentForm, with no "used by" reverse reference on either screen.
- **ChatComposer is a navigation dead end.** The composer shows "Agent: Alice" as a chip but provides no link to AgentForm. The user can see what target is active but cannot inspect or edit it without knowing to navigate to a separate management screen independently.

Users are most likely to be **stranded** in two places: on McpServerForm's read mode (told they cannot act, given a single forward link) and on ToolProfileForm after arriving from AgentForm (no return affordance).

### 3. Naming Taxonomy

- **"Tool Profile" vs. "Tool Access."** Both terms appear across forms. AgentForm has a section called "Capabilities & Tool Access" that contains a tool profile selector. ToolProfileForm has a section called "MCP Tool Access." McpServerForm's read mode has a "Tool Access" section. The term "Tool Access" is doing triple duty as a section header across three screens with different meanings: selecting a profile, granting tools within a profile, and explaining you cannot grant tools here. This will confuse users who search for "tool access" expecting consistent behavior.
- **"Scope" vs. "Visibility."** AgentForm uses "Visibility (Private/Shared)." ToolProfileForm uses "Scope (Private/Shared)." These are the same concept with different labels. Pick one.
- **"Trusted/Untrusted"** toggle on tools is introduced in ToolProfileForm without definition. This is a security-critical concept that appears as a simple toggle with no explanation of what trust means at the point of decision.
- **"Default" / "Assistant" / "Agent: Alice" in ChatComposer** present three target types in one flat row without explaining the taxonomy. "Default" is a pointer that resolves to either an assistant or an agent. "Assistant" is an execution target without agent binding. These are not parallel concepts, yet the chip UI presents them as peers.
- **"Category" in AgentForm** (Primary/Specialist/Derived) is undefined. These labels imply a meaningful taxonomy but nothing in the UI explains what differentiates a "Specialist" from a "Derived" agent or what consequences the choice carries.

### 4. Object Identity

- **Tool profiles lack visible identity cues.** AgentForm's tool profile radio selector shows profile names but no indication of status (Active/Archived), scope, or tool count. A user choosing between profiles has no distinguishing information.
- **MCP Servers in ToolProfileForm** are grouping headers but lack status indicators. If a server is disconnected, the user does not see that while granting tools. Connection status lives on McpServerForm, not here.
- **ChatComposer's "Default" chip** does not reveal what it resolves to. Scenario 48 ("what does Default resolve to?") cannot be answered from the composer. The user must navigate to Account Preferences to discover the answer.

### 5. Mental Model Alignment

The UI accidentally teaches two conflicting models:

1. **The intended model:** Agents use profiles, profiles bundle tool grants from servers. Clean separation of concerns.
2. **The accidentally taught model:** Tools are configured everywhere, and I need to visit the right screen to flip the right switch. This is reinforced by "Tool Access" appearing on three screens, each behaving differently, and by McpServerForm showing a read-only tool list the user cannot touch.

The two independent save buttons on ToolProfileForm further fracture the model. They imply that the profile's identity and its tool grants are separate objects, when conceptually a tool profile *is* its grants.

### 6. Wayfinding

- **No breadcrumbs or contextual titles.** When a user clicks "Manage Selected Profile" from AgentForm, does ToolProfileForm show "Editing Profile Alpha (used by Agent Alice)"? Without this, the user loses the context of why they are on this screen.
- **McpServerForm's two modes** (edit vs. read) are a wayfinding hazard. The user may not understand why they sometimes see an editable form and sometimes a read-only summary. The mode switch criteria are not surfaced.
- **No "you are here" indicator** connects the four forms. The screens are peers in navigation, but the dependency chain means they have a natural order. Nothing signals this order.

### Prioritized Structural Recommendations

1. **Add a dependency summary to AgentForm.** Below the tool profile selector, show an expandable "Resolved Tools" preview listing the servers and tool count the selected profile provides. Solves scenario 46 without additional navigation.
2. **Unify "Scope" and "Visibility"** to a single term across all forms. "Visibility" is more intuitive.
3. **Add contextual return links.** When ToolProfileForm is opened from AgentForm, display a persistent "Back to Agent: Alice" link. Preserve navigation origin as state.
4. **Rename or differentiate "Tool Access" sections.** Use "Tool Profile Selection" on AgentForm, "Tool Grants" on ToolProfileForm, and "Tool Discovery" on McpServerForm.
5. **Show resolution on the Default chip.** ChatComposer's "Default" chip should include a subtitle: "Default → Agent: Alice" so the user never has to leave the composer to answer scenario 48.
6. **Merge ToolProfileForm's two save actions** into a single save. The split creates false object boundaries.
7. **Add reverse references.** ToolProfileForm should show "Used by: Agent Alice, Agent Bob." McpServerForm should show "Referenced by: Profile Alpha." Solves scenario 27 without navigation.
8. **Expose server health in ToolProfileForm.** Show a status dot next to each server group header so users see connection state where they are making grant decisions.
9. **Make ChatComposer target chips tappable** to open the relevant form for inspection.
10. **Define "Trusted/Untrusted"** inline with a help tooltip, and define Category values with brief descriptions.

---

## Interaction Designer Review

### 1. State Management Patterns

The forms exhibit inconsistent dirty-state handling that creates real data-loss risk.

**ToolProfileForm** is the most problematic case. Two independent save buttons ("Save Profile" and "Save Tool Access") partition a single conceptual unit — a tool profile — into two persistence scopes. A user who edits profile metadata, then scrolls down and adjusts tool assignments, then clicks "Save Tool Access" will silently lose their metadata changes. The dirty-detection mechanism on tool access (comparing current vs baseline) is good engineering but poor interaction design when it only covers half the form.

**AgentForm** has a single save button (correct), but the form's length means the button is perpetually off-screen during editing. If a user changes reasoning effort near the top, then navigates away via "Manage Selected Profile" (a cross-link in the middle of the form), there is no indication that unsaved agent changes exist. No dirty-state guard, no "You have unsaved changes" dialog. The cross-links to ToolProfileForm are especially dangerous because they look like inline management actions, not full navigations.

**McpServerForm** avoids dirty-state issues in read mode (nothing editable) but has no recovery path in edit mode. "Connect and Discover Tools" is a destructive-feeling action — it triggers a network connection — yet there is no draft or undo state. If the connection fails, field state may be lost.

**Recommendation:** Implement a unified dirty-state guard across all forms. Any navigation away from a dirty form (including cross-links) should trigger a confirmation dialog. ToolProfileForm should have one save action, not two.

### 2. Progressive Disclosure

**McpServerForm** handles disclosure well. Conditional fields respond to the transport segment, and the collapsible Advanced section hides headers/cwd/env until needed.

**AgentForm** uses almost no progressive disclosure. Every configuration surface — model provider, model selection, reasoning effort (6 verbose options), capabilities, tool profiles, subagents, instructions — is presented simultaneously. This is the classic "long form" anti-pattern: it signals completeness but delivers overwhelm. A first-time user must parse the entire form to understand what is required vs optional.

**ToolProfileForm Phase 2** gets disclosure right at the micro level (bulk toggles, server groupings, counters) but wrong at the macro level. Phase 2 only activates after saving Phase 1, which means a user creating a new profile must save incomplete work to even see what tool assignment looks like. This forces a two-step workflow for a single creation task.

**Recommendation:** AgentForm should use collapsible sections or a tabbed layout. ToolProfileForm should show Phase 2 in a disabled/preview state during creation so users understand the full scope before their first save.

### 3. Feedback Loops

**"Connect and Discover Tools"** on McpServerForm initiates a network operation that could take seconds or fail. The transition from edit mode to read mode on success is jarring — the entire layout changes with no transition animation or explicit success confirmation beyond a toast.

**"Default Target" button** has inverted semantics: disabled when the agent is already the default. Disabled buttons communicate "you cannot do this" but not "this is already done." The user looking to set a default sees a grayed-out button and may assume the feature is unavailable.

**Tool access saves** provide no change summary. When managing dozens of tools, clicking "Save Tool Access" gives no confirmation of what changed — no diff, no count. The dirty detection proves the system knows what changed; it simply does not communicate it.

**ChatComposer target bar** provides no feedback when switching targets. Changing from "Default" to "Agent: Alice" reconfigures the chat context — model, tools, behavior — but the bar treats this as a simple chip selection with no acknowledgment.

**Recommendation:** Add explicit loading/success/error states for all network operations. Replace the disabled "Default Target" button with a non-interactive badge. Show a change summary after tool access saves. Add a brief transition indicator when switching chat targets.

### 4. Consistency

**Segment controls** are used consistently for binary/ternary choices, which is good. However, the reasoning effort selection uses a radio list with descriptions, model selection uses grid cards, and provider selection uses segments — three distinct selection patterns within Model Configuration alone.

**Save button patterns** diverge: AgentForm has "Save Changes"; ToolProfileForm has "Save Profile" + "Save Tool Access"; McpServerForm has "Connect and Discover Tools" / "Save and Refresh." Four different mental models for form submission across four screens.

**Non-interactive checkboxes** in McpServerForm's discovered tools use the same visual vocabulary as interactive checkboxes in ToolProfileForm, breaking the learned association between checkbox appearance and interactivity.

**Recommendation:** Standardize save actions to a single verb pattern ("Save [noun]") across all forms. Replace non-interactive checkboxes with a distinct visual element. Rationalize selection patterns within AgentForm's model configuration.

### 5. Interaction Cost

**Creating an agent with tool access** is the highest-cost workflow. The user must: scroll through AgentForm to the tool profile section → click "Create Tool Profile" (navigating away, potentially losing unsaved agent changes) → complete ToolProfileForm Phase 1 and save → configure tool access in Phase 2 and save again → navigate back to AgentForm (how?) → re-find the tool profile section → select the new profile → scroll to bottom → save. At minimum 8 discrete actions across 2 forms with 3 saves and no guaranteed return path.

**Switching an agent's model** requires scrolling past name and category to Model Configuration, selecting a provider, scanning cards, then scrolling further to set reasoning effort across 6 verbose radio options. For a routine tuning task, this is 2-3 screens of scrolling.

**Recommendation:** Add breadcrumb navigation. Provide a "create and return" flow for tool profiles launched from AgentForm. Consider a quick-settings panel for model/reasoning changes.

### 6. Mode Management

**McpServerForm's edit/read mode split** is the most disorienting mode switch. The entire layout changes, header actions change, and the information architecture shifts. There is no explicit mode indicator — the user must infer mode from form appearance. Worse, read mode offers "Edit" triggering a full layout change, while edit mode offers no "Cancel" to return without submitting.

**ToolProfileForm's phase transition** (Phase 1 to Phase 2 activation on save) is a hidden mode switch. The form physically changes after save — new sections become interactive — but there is no announcement or visual transition.

**Recommendation:** Add an explicit mode indicator to McpServerForm. Provide a "Cancel" action in edit mode. Use a visual transition to mark ToolProfileForm's phase activation.

### Prioritized Interaction Pattern Recommendations

| Priority | Recommendation | Issues Addressed |
|----------|---------------|-----------------|
| P0 | Unify ToolProfileForm into a single save with full dirty-state tracking | B2, silent data loss |
| P0 | Add unsaved-changes guards on all cross-form navigations | F2, data loss via cross-links |
| P1 | Add breadcrumb navigation and "create-and-return" flows between forms | F2, interaction cost |
| P1 | Add loading, success, and error feedback for all network operations | F9, feedback gaps |
| P1 | Replace non-interactive checkboxes with a visually distinct read-only element | B4, consistency |
| P2 | Introduce collapsible sections or tabs in AgentForm | F1, progressive disclosure |
| P2 | Replace disabled "Default Target" button with a "Current Default" indicator | B6, feedback clarity |
| P2 | Add explicit mode indicator and cancel action to McpServerForm | F8, mode management |
| P3 | Show change summary on tool access save | F4, feedback loops |
| P3 | Reduce density in ChatComposer target bar with grouping or overflow | F7, density |

---

## UX Writer Review

### 1. Label Clarity

**"Default Target"** — "Target" is platform jargon leaking an internal abstraction. Developers understand "default" but not what "target" means until they internalize the conceptual model.

> Rewrite button: **"Set as Default"**
> Rewrite success toast: **`"${name}" is now the default agent for new chats.`**

**"CATEGORY" with "Primary / Specialist / Derived"** — These labels carry zero self-evident meaning. No descriptions, no tooltips. "Derived" is especially opaque — derived from what?

> Add inline descriptions:
> - **Primary** — "General-purpose agent, shown first in the target picker"
> - **Specialist** — "Focused on a narrow task, available as a subagent"
> - **Derived** — "Inherits instructions from another agent and extends them"

**"SCOPE" vs. "VISIBILITY"** — Two different labels for the same concept on ToolProfileForm and AgentForm respectively. See §6 Consistency.

**"Reasoning Effort" / "Gemini Thinking"** — Switching the label based on provider is disorienting. The concept is the same; only the engine differs.

> Use a single label: **"Reasoning Level"**. Show the provider-specific mapping in the footer (which already exists).

**"model-visible"** in MCP server stats ("N discovered — N model-visible") — Implementer jargon. Users care whether tools are available to agents, not whether they are "visible to the model."

> Rewrite: **"N discovered · N available to agents"**

### 2. Teaching Copy

**Good:** ToolProfileForm subtitle ("Tool profiles control which MCP tools are available to assistant mode or to specific agents") does real teaching — explains the object's purpose in one sentence.

**Good:** The TOOL ACCESS box on McpServerForm ("Manage MCP grants from a tool profile, not from this server screen") correctly redirects users and prevents a conceptual error.

**Weak:** AgentForm subtitle ("Changes update the agent definition used on future runs") tells the user *when* changes apply but not *what an agent is*. This is the first encounter with the concept.

> Rewrite: **"An agent defines how the AI responds — its instructions, model, and tool access. Changes apply to future runs."**

**Weak:** "Native capabilities change how this agent behaves" is vague. What makes a capability "native"?

> Rewrite: **"Built-in capabilities are actions the agent can perform without an MCP server."**

**Missing:** "Agents exposed as delegation targets in the prompt" (Allowed Subagents) uses the jargon the UI should eliminate.

> Rewrite: **"Other agents this agent can hand off work to during a run."**

### 3. Action Labels

**"Connect and Discover Tools" / "Save and Refresh"** — Good. Dual-action labels tell the user exactly what will happen.

**"Refresh"** (link on tool-access profile selector) — Refresh what? The profile list? The tools?

> Rewrite: **"Reload profiles"**

**"Manage Selected Profile"** — Vague. Does "manage" mean edit metadata or edit tool grants?

> Rewrite: **"Edit profile"** or **"Edit [profile name]"**

**"Back to Chat"** — Consistent and clear across all forms. No change needed.

### 4. Empty States

**"Create another agent first."** (Subagents, empty) — Sounds like an error. Should encourage, not block.

> Rewrite: **"No other agents exist yet. Create one to enable delegation."** Add a "Create Agent" link.

**"No MCP tools discovered for this workspace yet."** — Correct but leaves no next step.

> Rewrite: **"No MCP tools discovered yet. Connect an MCP server to get started."** Link to McpServerForm.

**"Save this tool profile before assigning MCP tools."** — Clear and correctly sequences the workflow. No change needed.

### 5. Status Communication

**"untrusted / trusted"** — Never defined. A developer will ask: trusted by whom? What changes?

> Add tooltip: **"Trusted tools run without confirmation. Untrusted tools require your approval on each call."**

**"needs auth"** badge — Good. Short, scannable, actionable.

**"Active / Archived"** on tool profiles — "Archived" implies reversible removal but consequences aren't stated.

> Add helper: **"Archived profiles are inactive. Agents using this profile will lose MCP tool access."**

### 6. Consistency

| Concept | AgentForm | ToolProfileForm | McpServerForm |
|---|---|---|---|
| Access level | "VISIBILITY" | "SCOPE" | — |
| Private/Shared | Identical | Identical | — |

> **Pick one label.** Recommend **"Visibility"** everywhere — more intuitive than "Scope" for a sharing control.

"Assistant" appears in ChatComposer as a peer target but is never defined in context. The distinction (assistant = no agent binding) is nowhere explained.

> Add tooltip on "Assistant" chip: **"Runs without agent instructions — uses your account's default model and tool profile."**

"MCP tools" vs. "external MCP tools" vs. "MCP tool access" — three variants. Standardize on **"MCP tools"** unless contrasting with native capabilities, in which case use **"external tools"**.

### 7. Tone

Appropriately terse and technical for a developer audience. Two standouts:

- "No reasoning. Fastest, cheapest." — Period-separated fragments respect developer scanning. Good.
- "Each row becomes one argv entry. No shell parsing." — Precise, prevents a common mistake. Excellent.

No tone issues found.

### Prioritized Copy Changes

| Priority | Location | Change |
|---|---|---|
| P0 | AgentForm subtitle | Rewrite to teach what an agent is |
| P0 | Category options | Add inline descriptions for Primary / Specialist / Derived |
| P0 | "untrusted / trusted" | Add tooltip defining the trust model |
| P1 | "Default Target" button + toast | Rename to "Set as Default"; rewrite toast |
| P1 | VISIBILITY vs. SCOPE | Unify to "Visibility" across all forms |
| P1 | "Allowed Subagents" description | Replace jargon with plain language |
| P1 | "Native capabilities" description | Rewrite as "Built-in capabilities" |
| P1 | "model-visible" stat | Rewrite as "available to agents" |
| P2 | Reasoning label | Unify to "Reasoning Level" |
| P2 | "Refresh" link | Clarify as "Reload profiles" |
| P2 | Empty subagents state | Add encouragement + create link |
| P2 | Empty MCP tools state | Add next-step link to server connection |
| P2 | "Archived" status | Add consequence helper text |
| P3 | Assistant chip tooltip | Add one-liner explaining assistant mode |
| P3 | "MCP tools" variants | Standardize terminology |

---

## Developer Experience Review

### 1. Developer Mental Model Fit

Developers building with AI agent platforms carry a strong mental model from infrastructure-as-code: **define a thing, wire it to dependencies, deploy it, test it**. The current form hierarchy (MCP Server → Tool Profile → Agent) correctly reflects the dependency graph, but the UI forces the opposite of how developers think.

When a developer thinks "I want an agent that can send emails," they start from the **goal** (agent behavior) and work backward to the **plumbing** (server connection). The UI forces bottom-up: you must first configure McpServerForm, then ToolProfileForm, then AgentForm. There is no way to start from AgentForm and be guided toward creating missing infrastructure inline. This is the equivalent of requiring someone to write a Dockerfile before they can describe their application.

The Category field (Primary / Specialist / Derived) compounds this. These labels have no visible definition, no tooltip, and no behavioral consequence. A developer encountering them will ask: "Does Specialist change routing logic? Does Derived imply inheritance?" Unknowable from the UI. Undefined taxonomy in a developer tool is worse than no taxonomy — it creates suspicion that a wrong choice has hidden consequences.

The native capabilities section (delegate_to_agent, complete_run, block_run, web_search) presents API flags as unlabeled checkboxes. Developers expect either documentation-grade descriptions or direct links to behavioral specs. A checkbox labeled `block_run` with no context is a guessing game.

### 2. Configuration Transparency

The most significant transparency failure is the **absence of a resolved-state view**. At no point can a developer see: "Agent X uses model Y via provider Z, has access to tools A/B/C from profile P which connects to servers S1/S2, delegates to agents D1/D2, and is the default chat target." This composite state is distributed across three forms with no summary.

ToolProfileForm is especially opaque. The profile's relationship to agents is implicit — there is no "used by" list. A developer renaming or modifying a profile has no way to assess blast radius.

McpServerForm's discovered tools are non-interactive. A developer cannot click a tool to see which profiles grant it or which agents have access. For "can my agent call this tool?", the answer requires manually cross-referencing three screens.

### 3. Iteration Speed

The edit-test-adjust loop is penalized by unnecessary navigation and save round-trips.

**Tweak agent instructions, test in chat:** Open AgentForm → scroll to instructions editor at the bottom → edit → Save → navigate to chat → test → navigate back to AgentForm → scroll down again. No split-pane view, no "save and test" shortcut. Every cycle costs minimum four navigation actions.

**Grant a new tool to an existing agent:** Identify the agent's tool profile (AgentForm) → navigate to ToolProfileForm → find the server group → enable the tool → save tool assignments (second save button) → return to chat. No in-context confirmation that the change propagated.

The ChatComposer target chips are a bright spot — they reduce context-switching for choosing which agent to test. But hovering or clicking a chip should preview the resolved configuration; currently it does not.

### 4. Debuggability

Debugging is where the current design most significantly fails. Consider: "My agent can't see the tool I just configured."

The developer must reconstruct the chain: Is the correct agent selected? → Does the agent reference the right tool profile? (AgentForm) → Is the tool enabled in that profile? (ToolProfileForm) → Is the MCP server connected? (McpServerForm) → Is the tool marked trusted? (back to ToolProfileForm). Five screens, no guided flow, no diagnostic view.

There is no "dry run" or "resolve" action showing: "Here is what this agent can do right now, and here is why." There is no error surface for misconfigurations — a tool profile referencing a disconnected server is silently broken rather than flagged.

The two-phase save on ToolProfileForm creates an insidious debug scenario: a developer may save metadata but forget tool assignments (or vice versa), resulting in a state that looks correct but is functionally incomplete.

### 5. Power User Affordances

The forms offer no power-user escape hatches:

- **No config-as-code.** No JSON/YAML export/import. Developers working with agent platforms expect to version-control configuration.
- **No keyboard shortcuts.** No Cmd+S to save, no Cmd+Enter to save-and-test.
- **No bulk operations.** Enabling ten tools requires ten checkbox clicks. No "grant all from server X" action at the profile level.
- **No duplication.** Creating an agent variant (common in A/B testing prompts) requires manually recreating the entire form. No clone, no template, no diff.
- **No deep-linking.** A developer cannot share a URL to a specific agent configuration with a teammate.

### 6. Cognitive Overhead

The core load problem is **relationship tracking across disconnected screens**. The developer must hold in working memory:

- Which tool profile is assigned to which agent
- Which tools are enabled in which profile
- Which servers expose which tools
- Which agents delegate to which other agents (and alias mappings)
- What "Default" resolves to in the current chat

None of these relationships are visualized. The domain model is a graph, but the UI presents isolated forms. Subagent delegation is particularly heavy: you can select targets and assign aliases, but you cannot see targets' configurations inline. You are assembling a multi-agent system while viewing one node at a time.

### Prioritized DevX Recommendations

1. **Add a resolved-state summary per agent** — a read-only panel showing model, tools (with source server and trust level), profile, delegation targets, and default status. Addresses transparency, debuggability, and cognitive overhead simultaneously.
2. **Introduce an inline instructions editor accessible from chat** — a slide-over or split pane allowing instruction edits without full-page navigation, cutting the edit-test loop from four actions to one.
3. **Merge ToolProfileForm into a single save** — eliminate the two-phase pattern. Profile metadata and tool assignments should commit atomically.
4. **Add a diagnostic/trace mode** — when a tool is missing or unexpected, surface the resolution chain (agent → profile → server → tool status) in a single panel.
5. **Add config export/import (JSON/YAML)** — let developers version-control agent configurations. Table stakes for a developer audience.
6. **Document the Category taxonomy** — either define Primary/Specialist/Derived with visible behavioral consequences or remove the field. Undefined dropdowns erode trust.
7. **Add agent cloning and deep-link support** — reduce setup cost for variants and enable collaborative debugging.
8. **Surface relationship backlinks** — ToolProfileForm should show which agents use it; McpServerForm should show which profiles reference it. Every entity should show its dependents.
