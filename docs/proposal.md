# Chronicle

*Self-Healing Project Memory*

Canonical proposal based on the team source supplied September 26, 2026, updated with the user’s agreed scope and design decisions. The unmodified original is archived in [sources/final-proposal.txt](sources/final-proposal.txt). The conversation history and superseded directions are recorded in [decisions.md](decisions.md).

**Presentation requirements: 60 seconds for the first round, targeting about 15 seconds of chat followed by roughly 45 seconds of visualization; five minutes if the team reaches the top six.** Both use one shared Living Ledger view, with compact results and optional evidence/integration inspections. See [demo-flow.md](demo-flow.md) for the canonical structure, both timings, and research references. The full flow remains the product scope; every branch need not be shown in the first round.


## One-line description

Chronicle is a memory harness that tracks facts contributed by different people on a shared project, resolves conflicting information using an evolving policy, and learns from human corrections, made inspectable through the Living Ledger and its recorded replay.

## The problem

Long-running projects accumulate facts from many people, and those facts conflict. One teammate says the launch is Friday; another says it moved to Monday.
Most systems either retain both claims without resolving the disagreement or apply a fixed rule that never improves. Neither captures how teams learn whose information to trust, under which circumstances, over time.
Chronicle preserves those lessons and applies them to future conflicts.

## Overall MVP

The MVP is one complete, working loop:
New fact → detected conflict → policy-based resolution → human correction → saved precedent and policy update → improved resolution on a new conflict.
The Living Ledger makes the process visible and shows which facts, policy, and precedent influenced each decision.

### 1. Shared project memory

- Ingest facts from multiple named sources. The default model review extracts supported date, owner, budget, and status claims with exact source passages; validation precedes fact persistence.
- Store facts in MongoDB Atlas with their project, subject, source, timestamp, and supporting text.
- Preserve conflicting and superseded claims so the history remains inspectable.

### 2. Conflict detection and resolution

- Use a constrained semantic review to propose incompatible claims about the same subject, attribute, and applicable scope. Validate source evidence and relationships, separate non-overlapping applicability periods and currencies, and compare dates conservatively before passing stored candidates to the existing Python engine.
- Apply a resolution policy stored as data in MongoDB, considering source authority, recency, and applicable precedents.
- Use Voyage AI embeddings and Atlas Vector Search to retrieve candidate precedents.
- Check whether a precedent applies before using it. Similarity alone does not establish relevance or authority.
- Leave a conflict unresolved when the evidence does not justify a choice.

### 3. Learning from corrections

- Allow a human to override a resolution and provide a short reason.
- Save every explicit human answer as a linked decision. Create a reusable authority precedent only when the user opts into the clearly labeled scope checkbox, which starts unchecked and can name any recorded claimant source.
- Validate the lesson against the stored subject, attribute, scope, and project; generic scopes narrow to subject and attribute. Update the relevant policy while preserving every previous version. Keep multiple lessons and report the one actually applied; newer authority supersedes older same-scope authority for use.
- Apply the learned precedent to a subsequent, different conflict and cite it.
This is learning through persistent precedents and policy updates. A project-specific exception must not silently become a universal rule.

### 4. Living Ledger visualization

The user-facing entry is a minimal, usable floating terminal with the plain Chronicle name and no logo. Keep compact, consistent terminal margins and fixed text sizes as the window grows; use viewport layout for normal work and reserve scene scaling for replay. Identify example contributors as Maya [Marketing] and Alex [Engineering], keeping names separate from authority roles. Sent messages and attachments enter history immediately with a separate pending reply; the composer clears on send but remains editable during generation. A next-message draft survives completion or failure; the submitted draft is restored on failure only if no newer draft exists. Normal prompts receive an answer before any camera movement; an explicit **Replay internals** action reveals a compact network with the terminal near 20% of the view. Keep all destinations and routes visible in the overview; directed close views frame the relevant service and its immediate connections, with readable depth/perspective. Track the actual request's operations with glowing packets, including confirmed document, fact, and decision saves. Render conversation Markdown and support arbitrary prompts with adjacent company and model dropdowns, including the authorized signed-in Codex demo connection and API-token adapters. Use one shared perspective camera that automatically follows the recorded flow, reveals stacked service processes when relevant, and finishes by flattening and zooming back into the working terminal. Depth is enabled without a user toggle (system reduced motion is respected). Pause/scrub remain available; Replay step reruns the selected visual beat then pauses. Keep aligned 3D connections across conversation, execution, and memory/retrieval layers and a clear input → operation → output caption for narration. Automatic camera following is the default with no mode selector. Optional drag panning pauses playback; Play restores automatic following. Desktop demo playback is the validation target. Show MongoDB Atlas, Voyage AI, Atlas Vector Search, and the Python resolution engine from recorded backend receipts; label services not called in the selected turn; only current recorded transfers are drawn and animated. Keep transfers at a readable pace. Each arrival triggers one slower descent through the service layers and ascent back to the surface. Confirmations continue the same moving dot while updating state; the next transfer begins when the dot returns to the top. Keep one persistent dot and teleport it between wire endpoints and the fixed stack corner; do not interpolate a diagonal connecting flight. Use the 250 ms teleport beat for a 125 ms fade-out and 125 ms fade-in, changing position at zero opacity without a visibly frozen hold. Use a continuous camera glide with a steady angle and gentle zoom instead of restarting easing at each handoff. Horizontal camera tilt is reduced by 25%: overview yaw −9°, service yaw −16.5°, and optional drag yaw ±4.5°; vertical tilt is unchanged. Drive packet motion and step advancement from one playback clock; caption changes must not restart the first part of a transfer or bounce. Combine a write request, backend receipt, and confirmation into one visible save step while retaining their original events and order. Keep one bounce across consecutive operations at a service. Local terminal captions continue the incoming transfer without an in-chat bounce, processing delay, or camera return; retain the last service camera until the next service, then flatten back into the terminal at the end. Use the same layer offsets for packet motion and sheet depth, with only 2 px clearance outside the sheet edge. Turn the bounce slightly before the lowest sheet (80% of the full descent) so the packet glow does not visibly overshoot. Run the service-stack bounce at 1.25× its original speed (2.4 s becomes 1.92 s), retaining the one-second transfers and 250 ms teleport fades. These are base choreography timings: long autoplay recordings proportionally accelerate the shared playback clock to fit roughly 45 seconds including the final terminal return. Shorter recordings retain their natural duration; Replay step retains the base pace. Keep the service-by-service journey, fixed-size active-service heading and readable input → operation → output caption, with results gated on packet arrival. Derive each visible connection from the preceding and destination stations; route the engine-to-Voyage connection around the model card. Keep the dot outside sheet edges so upper layers cannot hide it. Reveal service results when the packet arrives, and the answer when replay returns it. Identify older browser-only recordings and explain that a new conflict is needed to capture connected Voyage calls. Each step maps to actual trace events; do not insert illustrative embedding/search steps. Model replay displays captured request context and measured response metadata, with missing details identified on older turns. Service inspection retains receipts across the combined review/correction cycle, reveals them only after arrival, and explains why retrieval has no recorded call when applicable. Refine stations as actual service functions become available. See [demo-flow.md](demo-flow.md#user-directed-spatial-architecture).

Show a single Replay internals action for the latest completed cycle in the active chat. A conflict cycle requiring human input is complete only after every queued conflict has a saved human answer (including an explicit leave-unresolved answer); combine the original review and all linked correction traces into that one replay. Pending, failed, and deferred conflict cycles have no replay action. The person selector contains only Maya [Marketing] and Alex [Engineering]. Do not show a “Review the next release brief” suggestion button; follow-up documents can still be attached normally.

Human conflict answers use the currently selected composer identity (for example Maya [Marketing]), separately from the selected fact’s author; never hardcode “You” or relabel old anonymous records. An explicit conflicting revision of an already decided subject (for example “actually the launch should be October 2”) saves the new claim and opens a fresh source-of-truth question even when a prior lesson applies. Calendar-only launch dates are supported. Keep the prior decision and policy history; save the new scoped choice only after an explicit answer. Simple lookups use the latest saved human answer without treating old disagreement as a new unresolved question. Conflict questions adapt to the current request and its relevant recorded claims. Start chats and resets with an empty composer; load the demo document only through Use example memo. Automatically prompt only for the latest response in the active chat, never an older unanswered conflict after an unrelated reply. The constrained model review proposes claims and relationships; questions are built from validated, relevant evidence groups after the engine runs. Unrelated requests get no question. Multiple conflicts in one response queue one question at a time with stable conflict IDs, and each answer saves independently without adding question messages to the transcript. Keep claim/source options grounded in stored evidence, retain manual reopening on the original response, and do not ask again when a saved human answer covers the same facts or a scoped lesson was applied. The default connected flow uses validated model extraction and semantic review; the connected Python engine owns decisions on stored claims. The bounded reviewer is not a claim of universal project understanding.

Hide provider/model names and “Local rules” in reply metadata. Show “✓ Decision saved to memory” only for a completed turn with a recorded decision-save confirmation; during replay reveal it only once that confirmation is reached. Pending replies and failed saves must not show this status. The decision-save badge is reserved for explicit saved human answers/corrections (including leave-unresolved) and automatic conflict resolutions that apply a scoped lesson. Ordinary replies, greetings, acknowledgements, fact ingestion/lookups, and provisional choices awaiting review must not receive a decision badge merely because the conversation was persisted. Keep provider selection and technical replay inspection available.

The terminal provides persistent conversations through a compact chat picker and New chat. Each chat keeps its transcript and model history separate while sharing project memory and scoped lessons. Below the typing area, the composer toolbar places the paperclip before source identity and aligns company/model controls to the right; the example memo action lives beside Reset demo. Typing areas size automatically with their contents, without manual resize handles. Contrast is modestly increased while retaining the minimal dark palette.

- Display facts as nodes colored by source.
- Visibly connect conflicting claims and show their resolution.
- Reflect actual backend events: new facts, conflicts, overrides, precedents, and policy updates.
- Let users select a resolution to open a “Why this decision?” panel.
- Highlight the facts and precedent that influenced the decision, alongside the policy version and explanation.
- After a correction, visibly connect the next resolution to the precedent it used.
The frontend displays the actual decision trace. Explanations must match the evidence the backend used.

## How the parts fit together

| Component | Responsibility |
| --- | --- |
| Ingestion and semantic review | Save original sources; propose typed claims and relationships in one constrained model task; validate supporting quotes and stable evidence IDs |
| Conflict engine | Resolve validated conflicting candidates using the stored policy; retain decision authority in Python |
| Precedent retrieval | Find applicable past corrections for the conflict engine |
| Correction flow | Persist human feedback, create precedents, and version policy updates |
| Living Ledger | Display stored facts, events, relationships, and decision explanations |

The conflict engine owns resolution. The model proposes evidence and provisional review prose; retrieval supplies candidate precedents. The frontend appends the authoritative engine/recorded-human summary and displays the resulting decisions. Runtime order is original source save → model review/extraction → validated facts save → retrieval/engine → authoritative summary → saved response. Exact saved-human-answer lookups skip the model.
Before building independently, the team agrees on shared identifiers and a resolution payload containing:
- Project and conflict IDs
- Supporting fact IDs
- Selected fact or unresolved status
- Applied precedent ID, if any
- Policy version used
- Brief explanation
Backend events deliver these records to the frontend. Database credentials remain on the backend.

## MVP demo

Use one persistent view for both presentation lengths. The main view communicates the initial decision, human correction, and later reuse. Optional inspections add evidence, memory changes, scope checks, and integration depth for the longer slot; there is no separate presentation mode.

- Maya [Marketing] uploads a realistic launch memo for review. Its rollout section happens to target Friday. Chronicle notices a conflict with a previously learned Engineering readiness update that says Monday; the reviewer did not supply both sides or explicitly ask for conflict detection. The terminal gives the review first. After the human answer is saved, one optional internal replay exposes the document/fact saves, evidence lookup, conflict, and correction.
- Chronicle initially selects Friday under its starting policy while the review flags the conflicting evidence and its source. The completed cycle’s replay later shows why.
- A compact question temporarily occupies the composer area to ask which source to use, with concise claim/source options, a directly editable context textbox, and an upward-opening context-files control above the options. Existing draft text, attachments, and source remain cached and return unchanged when answered or skipped. Navigation remains usable; there is no modal or backdrop. The user can choose a claim, leave it unresolved, add context, or defer without answering. A human chooses Engineering and explicitly checks the initially unchecked project-scoped launch-authority option. Chronicle saves the override, creates a precedent, and updates the scoped policy.
- A fresh run reviews Maya’s next-release brief against Alex [Engineering]’s separately stored planning notes while retaining the saved lesson. Do not supply both conflicting claims in the review prompt.
- Chronicle resolves it using the learned precedent. Selecting the resolution highlights the earlier correction and explains why it applies.
The intended integrated MVP uses a controlled but natural document-review scenario, with database writes, retrieval, resolutions, and policy updates running through the real application. The current local prototype boundary and live-provider status are documented in [demo-flow.md](demo-flow.md#current-prototype-boundary).

## MVP completion criteria

Before expanding scope:
- The full loop works against the designated Atlas Hackathon Sandbox.
- Facts, corrections, precedents, and policies persist across fresh runs.
- The graph and explanation panel match the stored decision trace.
- A relevant new conflict uses the precedent; an out-of-scope conflict does not blindly reuse it.
- The demo can be reset and repeated reliably.
- Newly saved precedents are available for retrieval before the next demo step.
- A working recording exists, with time reserved for rehearsal and submission.
These are focused correctness checks. A formal evaluation framework is outside the MVP.

## If we have time

Start stretch work only after the integrated MVP meets the completion criteria. Add one feature at a time and preserve a working demo.

### Priority 1: Before/after policy comparison

Show exactly which policy fields changed after a correction.
- Demo value: makes learning concrete and inspectable.
- Scope: a compact comparison of the relevant fields and policy versions.

### Priority 2: Interactive scoped exception

Let the presenter introduce a project-specific exception, then show a contrasting case where it does not apply.
- Demo value: demonstrates that Chronicle learns within appropriate boundaries.
- Scope: one rehearsed exception and one contrasting case. Basic scope correctness remains an MVP requirement.

### Priority 3: Highlight affected decisions

When a fact changes, highlight a few dependent decisions or outputs that need review.
- Demo value: shows the consequences of correcting project memory.
- Scope: explicit dependencies and review flags. Automatically repairing those outputs is a separate extension.

### Priority 4: Automatic importance-aware recall

Infer important project knowledge from ordinary activity, decisions, blockers, dependencies, and corrections, and surface it for a later task.
- Demo value: demonstrates useful recall as project history grows, without requiring users to say “remember this.”
- Scope: attempt only with substantial integration time remaining. It must use the same resolved facts and policy system.
A stretch feature belongs in the live demo only when it works end to end and makes the demonstration clearer or more convincing.

## Future work

- Learning memory-selection priorities from project activity and feedback.
- Formal evaluations of resolution accuracy, important-memory recall, and inappropriate precedent reuse.
- Validated repair of downstream plans after facts change.
- Large-history scaling, including billion-token archives, supported by measured retrieval quality, latency, and cost.
These are potential next steps to mention in the pitch, not claims about the MVP.

## Why this fits the theme

Chronicle targets Long Horizon Engineering by maintaining coherent project memory across changing facts and fresh sessions.
It also explores Recursive Harnessing because the resolution policy is a versioned artifact that changes in response to human feedback.
The central proof is changed behavior: a correction persists, influences a later resolution, and remains traceable to its source.

## Tech stack

- MongoDB Atlas: facts, conflicts, resolutions, precedents, policy versions, and event history.
- Atlas Vector Search: retrieval of candidate precedents.
- Voyage AI: embeddings for conflict queries and precedents; embedding every fact is not implemented.
- Living Ledger frontend: terminal, correction interaction, decision explanations, and recorded spatial replay.
- MongoDB Agent Skills and MCP Server: development assistance connected to the team's Atlas environment.

## Setup prerequisites

Before project implementation, complete the agreed MongoDB Agent Skills and MCP setup and provision the cluster through the Atlas Hackathon Sandbox link from the organizer's email. Configure Voyage AI next.
Keep credentials out of the public repository and frontend.

## Team responsibilities

1. Self-Healing Memory Engine — Elmir: conflict detection; resolution using facts, policy, and candidate precedents; applicability checks (similarity alone does not establish relevance); correction-to-precedent conversion; scoped policy updates; structured explanations. Interface: takes facts + current policy + candidate precedents, returns a resolution with supporting IDs and an explanation; takes a previous resolution + human feedback, returns a new precedent and a proposed policy version. Develops against sample inputs, no database or frontend dependency to start.
2. Backend & Data Platform — Sahil: Atlas Sandbox connection, collections, and indexes; persistence for facts, conflicts, resolutions, precedents, and policies; API endpoints and input validation; event streaming to the frontend; consistent saving of related changes; hosts and runs Danny's retrieval module server-side. Interface: agreed API requests, responses, and event formats.
3. Living Ledger frontend — Maxime: the graph, correction controls, the “Why this decision?” panel, and evidence highlighting. Consumes backend snapshots and events, can build against recorded fixtures before the real backend exists. If time allows once this is done and stable: improve Danny's retrieval (better ranking, edge cases), never a competing second implementation, and importance-aware recall (Priority 4), both optional, both switchable off if unstable.
4. Precedent retrieval, then orchestration — Danny: core, not extra, this is what makes the “improved resolution on a new conflict” step of the MVP loop possible at all. Early: build retrieval, Voyage AI embeddings + Atlas Vector Search query logic, taking a conflict + project ID and returning scored candidate precedents, hand off to Sahil to host. Once the other three pieces have real interfaces: shift into orchestration, the workflow calling ingestion → retrieval → resolution → persistence in order, the correction flow, fresh-run/reset logic, seeded demo scenarios, end-to-end checks, the fallback recording, and the Cerebral Valley submission.

## Team

Team 419: Elmir, Sahil, Maxime, Danny. [Add full last names before submitting.]



## Appendix: Pipeline

See the supplied [pipeline flowchart](demo-flow.md#canonical-flowchart).



## Appendix: Sequencing

The approximate clock time below is the team’s original planning reference, not a recurring deadline. Follow the phase order according to actual progress.

- Phase 1, now until roughly 12:30 — parallel build, no dependencies. Elmir builds resolution logic against sample data. Sahil sets up Atlas, collections, and API scaffolding. Maxime builds the Living Ledger graph against fake data. Danny builds the retrieval module (Voyage AI embeddings + Atlas Vector Search) standalone, this is core, not extra.
- Phase 2, first connection point — protect this block, it's the core loop. Danny hands his retrieval module to Sahil to host. Elmir's resolution engine calls real retrieval instead of sample precedents. Maxime connects the graph to real backend events instead of fixtures.
- Phase 3 — Danny shifts into orchestration once the other three have real interfaces: wires ingestion → retrieval → resolution → persistence into one working flow, builds the correction/override path end to end.
- Phase 4 — full team tests the complete loop together against the MVP completion criteria: the loop runs on the real Atlas Sandbox, state persists across fresh runs, the graph matches the real decision trace, a relevant new conflict actually uses the precedent, an out-of-scope one doesn't.
- Phase 5 checkpoint — only once the MVP criteria are met: Maxime may improve Danny's retrieval (never a competing second version) or attempt importance-aware recall (Priority 4), both switchable off if unstable. Danny builds the seed demo scenario and the fallback recording.
- Final block — record the demo video. Submit: confirm the repo is public and all four names are added on Cerebral Valley.

## Appendix: Roles & agent prompts


### Elmir — Self-Healing Memory Engine

Build the resolution logic for a conflict-resolution harness (any language/framework is fine, expose it as a function or small service). Core object: a Fact with fields text, source, timestamp, topic. Given a new fact plus a list of existing facts on the same topic, detect whether they conflict. If they do, resolve using a weighted policy (source authority, recency), and for now call a stub function get_matching_precedent(fact_text) that returns None, Danny is building the real version in parallel, wire it in once it's ready. Build the correction path: given a previous resolution and human feedback, produce a new precedent object and a proposed policy update. Every resolution should return which rule or precedent it used, plus a short explanation. Develop entirely against sample data, you don't need the database or frontend to start.

### Sahil — Backend & Data Platform

Set up a MongoDB Atlas Sandbox cluster using the hackathon email link. Create three collections: facts, precedents, resolution_policy. Install the MongoDB Agent Skills and MCP Server to query the database directly from this session. Build API endpoints (`POST /facts`, `GET /state`, `POST /state`, `POST /state/correct`, and `POST /override`) with input validation. Human learning corrections use `POST /state/correct`; `/override` is only a key-value note with no learning effect. Both state POST routes require `context.scope` and `context.subject`. Persist the original resolution, correction, precedent and policy versions. See [the integration contract](../INTEGRATION.md) for payloads. Build a lightweight event stream (polling endpoint or websocket) so the frontend can read live state changes. Once Danny's retrieval module is ready, host and run it server-side as part of this service, agree on its function signature with him ahead of time so the handoff is a small integration, not a rewrite.

### Maxime — Living Ledger frontend

The following original role prompt describes ownership and graph behavior. Its dashboard/v0 suggestion is superseded by the terminal-first, explicit-replay design above and in [demo-flow.md](demo-flow.md); do not use it to reintroduce a dashboard or a logo.

Build a live graph visualization for a memory harness demo, using fake data for now. Nodes represent facts, colored by source. When two facts conflict, draw a visible link between them highlighted in a warning color. Wire the human correction interaction to `POST /state/correct` with `context.scope` and `context.subject`, never `/override`. Build a “Why this decision?” panel: selecting a resolution shows the facts, precedent, and policy version that influenced it. When a human overrides a resolution, animate the incorrect node flashing, then show a new precedent node appearing, with connections redrawn. Try v0 first: 'Build a live graph dashboard showing nodes as facts, colored by source, with conflict links, an explanation panel on click, and an animation when a human corrects a resolution.' Get this working against fake data before connecting to Sahil's real API.

### Danny — Precedent retrieval (core, build this first, not extra)

This is what makes the MVP's 'improved resolution on a new conflict' step possible, without it the harness can never demonstrate that it learned anything. Set up Voyage AI: create an account, generate an API key, install the client. Build embed_text(text) returning an embedding, and a function find_matching_precedent(conflict_text, project_id) that embeds the input and returns the closest candidate precedents with their IDs, similarity scores, and scope metadata, standalone, against a small list of fake precedents, no need to wait on Sahil's database. Hand this function's signature to Sahil early so he can plan the hosting integration. Once it works, hand off to him, then shift into orchestration: wire ingestion → retrieval → resolution → persistence into one real end-to-end flow, build the seeded demo scenario, and prepare the fallback recording.

## Connected implementation (September 26)

The terminal uses `/state` and `/state/correct` through the local Vite `/api` bridge, with workspace save/load under `/api/ledger/*`. Sahil’s `app.main:app` hosts the UI routes. `OrchestrationService` calls `DannyPrecedentRetriever` upstream and passes candidates into Elmir’s adapter; the adapter must not issue a second retrieval. Atlas persists a project-scoped `workspaces` snapshot plus `precedents` vectors; original results, human decisions and policy versions are retained. Voyage queries and document embeddings, Atlas search candidates, and engine decisions carry measured receipts into replay. The verified service loop selected Friday, learned Engineering readiness, then retrieved the saved precedent and selected Thursday on a different release; a budget conflict remained unresolved. Reload/restart persistence was checked. The connected reviewer now proposes source-backed date, owner, budget, and status claims and semantic relationships, bounded to 80 stored facts and eight new claims. Exact quotes, stored IDs and typed compatibility are checked before persistence/resolution; unavailable analysis is reported without invented facts. Multiple conflicts queue within one response and save independently. Generalized authority learning is explicit opt-in; all prior records remain inspectable. Service receipts are returned per request rather than streamed, and multi-user deployment is outside this localhost integration. Shorter replies, exact saved-answer lookups without generation, one model task per ordinary review, and Voyage client reuse reduce avoidable latency; timing still requires rehearsal. `CHRONICLE_MEMORY_REVIEW=0 npm run dev` restores the limited parser path without replacing the engine/retrieval modules.


Memory-review reliability: the signed-in Codex path enforces a JSON response schema and identifies the current request separately from prior conversation. A bounded check flags likely omitted explicit assertions; incomplete analysis stays visible and never invents missing facts. This is an omission alarm, not proof of comprehensive extraction. Validate written calendar dates, including leap years, before accepting typed date claims. Preserve requested source translations, summaries, and rewrites alongside a separate authoritative memory decision. Resolve synthetic multi-conflict IDs when rendering composer questions; keep one replay after all required answers are saved. Report upstream rate limits without exposing provider details. QA may pace requests for service quotas, but the application must not add artificial waits or silently repeat model calls.

Reported-source reliability: explicit reporting sentences retain the named claimant department separately from the submitter (`submittedBy`); a message submitted by Maya does not invent Alex as the author of “Engineering says Monday.” Exact reporting quotes and submitter provenance are checked at extraction and backend persistence. Date shorthand such as “Engineering says Thursday” can borrow its subject only from an unambiguous immediately preceding sentence in the same source, retained as `contextQuote`. Missing/rejected assertions make checking incomplete; show omitted passages and ask for an explicit source, subject, and value. An explicit statement such as “Engineering owns launch readiness for this project” can reopen an unambiguous recorded conflict in the active chat with Add context prefilled. No option is selected and Remember authority remains unchecked. It creates a fresh confirmation linked to the earlier conflict, preserving past answers; the statement alone saves no choice, precedent, or policy change. Ambiguous scopes, unrelated claims, and other chats do not trigger this shortcut.
