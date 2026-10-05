# Chronicle

*Self-Healing Project Memory — Team 419, MongoDB Harness Engineering & Model Wrangling Hackathon (Sept 26, 2026)*

Teams keep contradicting themselves: Engineering says the launch is Monday, Marketing's memo says Friday. Chronicle detects the conflict, resolves it with an evolving policy, and **learns from the human's correction** so the next similar conflict resolves itself. The Living Ledger shows the evidence behind every decision.

**How it works**

1. A new fact arrives and is checked against stored project memory (Voyage AI embeddings, MongoDB Atlas Vector Search).
2. On a conflict, the engine first looks for an *applicable precedent* (same project, topic and subject, from an authoritative source). If none applies, it falls back to a weighted policy (source authority, then recency).
3. A human correction is stored as a new precedent and a scoped, versioned policy update.

**My part (Elmir): the resolution engine** in [`resolution-engine/`](resolution-engine/), about 560 lines of dependency-free Python with 19 tests. Design choice: retrieval similarity is evidence only, and applicability is decided deterministically in the engine, so an out-of-scope or cross-project precedent can never win just because it ranks first. I also wired the engine into the backend API and fixed the casing and subject-scope bugs that live integration surfaced.

```sh
python3 resolution-engine/test_resolution_engine.py
```

**Team:** Elmir Abdullaiev (resolution engine), Danny (retrieval), Sahil (backend and Atlas), Maxime (frontend). This is my fork of the team repo, kept for permanence. The working notes below are the team's.

---
Chronicle tracks shared project facts, resolves conflicts using an evolving policy, and learns from human corrections. The Living Ledger makes the evidence behind each decision visible.

## Source of truth

- [Project proposal](docs/proposal.md): canonical MVP, stretch priorities, team roles, sequencing, and role prompts.
- [Demo flow](docs/demo-flow.md): canonical pipeline, research references, and **60-second / five-minute** sequences using one shared view.
- [User decision log](docs/decisions.md): design decisions from the conversation, superseded directions, and implementation boundaries.
- [Agent instructions](AGENTS.md): guidance for future coding sessions, scope boundaries, and integration rules.
- [Original team proposal](docs/sources/final-proposal.txt): unmodified source archive.

The canonical proposal supersedes earlier role assignments: **Danny owns core retrieval, Sahil hosts it, Elmir owns self-healing logic, and Maxime owns the frontend.**

## Team modules

Targets: **Long Horizon Engineering** (primary) and **Recursive Harnessing** (secondary).

| Location | Owner | Status / responsibility |
| --- | --- | --- |
| `resolution-engine/` | Elmir | Standalone Python conflict resolution, correction handling, and tests. |
| `src/`, `server/`, root Vite setup | Maxime | Current frontend and local model bridge. The frontend currently lives here, rather than the initially proposed `frontend/` folder. |
| `backend/` (planned) | Sahil | Atlas persistence, APIs, event transport, and hosting retrieval. |
| `retrieval/` | Danny | Voyage AI embeddings + Atlas-ready precedent retrieval (merged). See [INTEGRATION.md](INTEGRATION.md). |

Run the standalone resolution engine and its tests:

```sh
python3 resolution-engine/resolution_engine.py
python3 resolution-engine/test_resolution_engine.py
```

The Python engine and terminal's temporary local adapter are not wired together yet.

## Precedent retrieval (Danny)

```sh
pip install -r requirements.txt
pytest -q
python scripts/demo_retrieval.py
```

- [retrieval/README.md](retrieval/README.md) — local run instructions
- [INTEGRATION.md](INTEGRATION.md) — contract for Sahil & Elmir (`find_matching_precedent`)
- [ATLAS_SETUP.md](ATLAS_SETUP.md) — Vector Search schema & index notes

Copy `.env.example` → `.env` for `VOYAGE_API_KEY` (never commit secrets).

## Local terminal demo

Chronicle opens as a working conversation terminal. An older Engineering readiness update is seeded in memory. Marketing attaches a realistic launch memo and asks for a review. Chronicle notices that its incidental Friday rollout conflicts with the earlier Monday readiness update. Receive the review, then select **Replay internals** to see the confirmed fact write, memory lookup, conflict, policy, model response, and saved decision in a compact spatial scene. Replay does not write again or call the model again.

Use the paperclip to upload a `.txt` or `.md` document (up to 100 KB), or **Use example memo** to load the go-to-market draft. Open the filename to read the complete memo; it includes campaign messaging, rollout, assets, and open questions. The original document is retained before claims are extracted, and the review names prior evidence with its source and date. PDF/Word extraction is not connected yet.

Answer the source-backed conflict question, select Engineering and retain the explicit readiness lesson, then attach the next-release memo to see reuse. The source picker contains Maya [Marketing] and Alex [Engineering]. Arbitrary prompts reach the selected model; structured claim extraction remains limited.

```sh
npm install
npm run dev
npm test
npm run build
```

The localhost dev server includes the model bridge. Static build/preview output does not run the bridge and is not a deployable replacement for a backend.

### Model connections

- **Codex · signed-in account:** uses the installed Codex CLI and its existing ChatGPT login. This connection has been tested live. If needed, run `codex login`. Override the executable path with the server environment variable `CHRONICLE_CODEX_BIN`. Runs use an empty temporary directory, are ephemeral/read-only, and disable command, browser, app, and multi-agent tools; only the supplied conversation/context is needed.
- **OpenAI API:** choose OpenAI, connect an API key and an account-accessible model ID. Uses the Responses API.
- **Claude:** choose Sonnet 5 or Opus 5.5, then connect an Anthropic API key. Uses Messages API.
- **Custom:** supply a model ID, API key, and HTTPS base URL (HTTP allowed for localhost). Supports OpenAI-compatible Chat Completions, not every provider-specific protocol.

API keys are sent only to the local connection endpoint and retained in server memory. They are not returned to the browser, written to disk, or bundled. Restarting the server clears them. A configured key is unverified until a request succeeds; non-Codex adapters have not been tested against live accounts. Model/provider errors are shown without silently switching providers.

### What is real

Real Codex generation, Atlas persistence, Voyage embeddings, project-filtered Atlas Vector Search and Elmir’s Python resolution engine. Workspace facts, documents, turns, corrections, policy history and replay receipts survive a backend restart. **Reset demo** starts a fresh isolated workspace with labeled Engineering examples and retains previous Atlas records. A failed write or model call is not represented as a completed answer; earlier acknowledged writes may remain.

`backend/app/api/ledger.py` hosts the existing engine and retrieval modules. The terminal receives service receipts with each request. The backend also exposes the generic repository’s `/events` SSE stream; replay does not consume that stream. Replay animates only recorded operations, including real candidate scores and applied-precedent IDs; it makes no service calls. The browser still performs limited structured claim extraction, which is labeled separately from the Python engine.

- `src/journey.jsx`: terminal, model connection UI, and optional replay.
- `src/memory.js`: claim extraction, request orchestration and trace assembly; `src/services.js` connects it to the Python API.
- `src/fixtures/launch-memo.md`: natural example document for the review demo.
- `src/memory.test.js`: persistence order, correction/reuse, scope, arbitrary prompts, and failure checks.
- `src/styles.css`: consistent terminal padding and layered spatial scene.
- `server/providers.mjs`: Codex and API provider adapters.
- `vite.config.js`: localhost-only, same-origin model endpoints.

Implementation references: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex authentication](https://learn.chatgpt.com/docs/auth), [OpenAI text generation](https://developers.openai.com/api/docs/guides/text), [Claude model IDs](https://platform.claude.com/docs/en/models/overview).

### Connected terminal services

The terminal uses the real Python engine, Voyage, and Atlas through the
canonical `/state` and `/state/correct` routes, with workspace load/save under
`/api/ledger/*`. Both state POSTs include `context.scope` and `context.subject`. Run **both** `npm run backend` and `npm run dev`; see
[backend setup and validation](backend/README.md#active-terminal-integration).
The Python backend reads ignored `.env` credentials. The current Voyage model
uses 1,024 dimensions and a project-filtered `precedent_vector_index`.
Replay shows stored service receipts and makes no new service requests.
