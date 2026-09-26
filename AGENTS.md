# Chronicle — instructions for future coding sessions

## Read first

- Read [docs/proposal.md](docs/proposal.md) for the canonical MVP, stretch priorities, team ownership, sequencing, and role prompts.
- Read [docs/demo-flow.md](docs/demo-flow.md) for the canonical pipeline and **one-minute first-round / five-minute finalist** presentation requirements.
- Read [docs/decisions.md](docs/decisions.md) for the user's decisions and superseded directions. Log new decisions and apply them to the canonical docs and these instructions in the same change.
- [docs/sources/final-proposal.txt](docs/sources/final-proposal.txt) is the unmodified team-supplied source, preserved for provenance. Make ongoing agreed specification changes in the canonical Markdown docs rather than rewriting this archive.
- Follow the user's latest explicit instructions if they change the plan. Update the relevant canonical docs when changing agreed scope; avoid creating competing specifications.

## Product and scope

Chronicle is **Self-Healing Project Memory**. Its MVP is:

**New fact → conflict → resolution → human correction → scoped precedent and versioned policy update → improved resolution on a new conflict.**

The Living Ledger shows which facts, policy, and applied precedent influenced each decision. This is learning through persistent data and policy changes, not model-weight training.

- First-round presentation: **60 seconds total**, including narration and interactions. If selected in the top six, support **five minutes using the same view**. Keep the correction-and-reuse results prominent and evidence/integration inspections optional. Do not add separate presentation modes. All product branches need not be presented during the first minute.
- Keep the MVP focused. Importance-aware recall, formal evaluation infrastructure, downstream repair, and billion-token scaling are not MVP requirements.
- Follow the ordered stretch work in the proposal only after the integrated MVP is stable. Optional additions must be removable or switchable off if unstable.
- Do not promise novelty, first-place results, untested recall performance, or unimplemented capabilities.

## Current ownership — supersedes earlier chat role assignments

| Owner | Responsibility |
| --- | --- |
| Elmir | Self-healing memory engine: conflict detection, resolution, precedent applicability, correction-to-precedent conversion, proposed policy updates, explanations. |
| Sahil | Backend/data platform: Atlas, collections/indexes, APIs, validation, persistence, event delivery, and server-side hosting of Danny's retrieval module. |
| Maxime | Living Ledger frontend: graph, correction interaction, evidence panel, and highlighting. Only after the frontend is stable may Maxime improve Danny's existing retrieval module or attempt optional importance-aware recall. |
| Danny | Core precedent retrieval first: Voyage embeddings and Atlas Vector Search. Then orchestration, correction wiring, fresh-run/reset logic, demo scenarios, end-to-end checks, recording, and Cerebral Valley submission. |

Do not assign core retrieval back to Maxime or create a competing retrieval implementation. Danny sequences the workflow; Sahil implements storage and transport; Elmir owns resolution decisions; Maxime renders the trace.

## Integration rules

- Agree on shared record IDs, schemas, function signatures, and example payloads before building separate modules. Role-prompt signatures in the proposal are starting examples, not an already implemented API contract.
- Retrieval takes conflict context and project scope and returns candidate precedents with IDs, scores, and scope metadata. Elmir's engine decides applicability and use.
- A resolution includes project/conflict IDs, supporting fact IDs, selected fact or unresolved status, applied precedent ID if any, policy version, and an explanation.
- Preserve the distinction between candidate retrieval and actual precedent use. Highlight only evidence that influenced the decision.
- Reuse the same event/data contract for development fixtures and the live backend. Fixtures and recorded playback must be identifiable as such.
- Persist corrections and policy versions before presenting them as saved. Confirm retrieval readiness before demonstrating reuse.
- Preserve superseded facts and previous policy versions. Keep exceptions scoped. Abstain or request human input when evidence is insufficient.
- Develop modules against agreed fixtures, then connect a small real path early. Do not defer all integration until the end.

## Frontend and present implementation

The latest user direction is a **usable terminal first, optional internal replay second**. “Less is more”: keep the default view minimal and reveal supporting detail deliberately. Connections lead beyond the opening view and their nearby destinations become visible in replay. Submit any prompt and receive a response without moving the camera. Then use **Replay internals** on the completed response to zoom out to the compact spatial network. Keep the terminal near one fifth of the revealed scene, anchored nearby nodes, visible connections, and modest depth/perspective. Show incoming fact writes, confirmed saves, memory reads, conflict checks, policy application, model generation, decision writes, and the returned answer. Replay reads a recorded trace and must never perform another write or model request.

**Natural demo scenario:** Marketing uploads a realistic memo and requests a review. The Friday date is incidental rollout content. Chronicle should proactively notice the mismatch with an older Engineering update in stored memory, citing the source and date. Do not revert to a prompt explicitly supplying “Marketing says X; Engineering says Y.” Save the original memo before its extracted claims; replay exposes both writes. Plain-text/Markdown upload and a labeled example memo are implemented. The local claim parser is limited; the real model reviews the complete document.

Keep the product name as plain text: **there is no product logo**. Do not use star/asterisk provider-like symbols as Chronicle branding. Terminal header, transcript, and composer use consistent outer padding. Retain source identity, scrolling conversation, model selection, and optional provider connection settings rather than decorative-only controls.

**Current actual integrations:** browser-local facts, notes, turns, and traces persist across reloads; reset clears this demo's local records. The local Vite server bridges to the installed Codex CLI using the user's existing ChatGPT sign-in, with an ephemeral, read-only, text-only run and command/browser/app tools disabled. OpenAI Responses, Anthropic Messages, and custom OpenAI-compatible Chat Completions adapters accept user-provided keys kept only in server memory. Codex has been tested live; other providers require keys and remain unverified until exercised. Never expose keys to browser storage, bundles, logs, or the repository.

`src/journey.jsx` renders the terminal and trace replay; `src/memory.js` is a temporary local demo adapter (limited structured fact extraction and scoped rules, not Elmir's production engine or Danny's retrieval). General prompts reach the selected real model. `server/providers.mjs` and `vite.config.js` provide the localhost-only model bridge. Atlas, Voyage embeddings, Vector Search, and backend event delivery are still not connected. Update individual stations as the user supplies real service details; do not invent those integrations or replace the team's assigned modules.

Elmir’s standalone Python engine and tests are in `resolution-engine/`; preserve them when syncing frontend work. Their presence does not mean the frontend uses them. The current frontend lives in root `src/` with a local `server/` bridge; do not move it to the initially proposed `frontend/` directory merely to match an old folder sketch.

`docs/demo-flow.md` remains the canonical design and demonstration reference. `npm test` checks local memory/correction/failure behavior. `npm run dev` is needed for model endpoints; the static build/preview does not include the local Codex bridge.

## Setup and validation

- Use the designated Atlas Hackathon Sandbox from the organizer's email for live backend work. MongoDB Agent Skills/MCP and Voyage setup remain prerequisites to verify; do not assume they were completed because a frontend scaffold exists.
- Keep database credentials and API keys server-side and out of the public repository.
- `npm install` installs the frontend dependencies; `npm run dev` starts the local app; `npm run build` checks its production build.
- Validate changes proportionately. For frontend work, check rendering, navigation, and the affected interaction. For the completed MVP, verify persistence across fresh runs, actual precedent reuse, an out-of-scope case, trace accuracy, reset behavior, and a repeatable demo.
- A documentation-only edit does not require rebuilding the application; check local links, source fidelity, and consistency instead.
