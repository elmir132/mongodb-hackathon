# Chronicle

*Self-Healing Project Memory — Team 419*

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
| `resolution-engine/` | Elmir | Standalone Python conflict resolution, correction handling, and tests, preserved from GitHub. |
| `src/`, `server/`, root Vite setup | Maxime | Current frontend and local model bridge. The frontend currently lives here, rather than the initially proposed `frontend/` folder. |
| `backend/` (planned) | Sahil | Atlas persistence, APIs, event transport, and hosting retrieval. |
| `retrieval/` (planned on main) | Danny | Voyage/Atlas precedent retrieval, then orchestration. Separate branch work is not implicitly merged into main. |

Run the standalone resolution engine and its tests:

```sh
python3 resolution-engine/resolution_engine.py
python3 resolution-engine/test_resolution_engine.py
```

The Python engine and terminal's temporary local adapter are not wired together yet.

## Local terminal demo

Chronicle opens as a working conversation terminal. An older Engineering readiness update is seeded in memory. Marketing attaches a realistic launch memo and asks for a review. Chronicle notices that its incidental Friday rollout conflicts with the earlier Monday readiness update. Receive the review, then select **Replay internals** to see the confirmed fact write, memory lookup, conflict, policy, model response, and saved decision in a compact spatial scene. Replay does not write again or call the model again.

Use **Attach memo** to upload a `.txt` or `.md` document (up to 100 KB), or **Use example memo** to load the go-to-market draft. Open the filename to read the complete memo; it includes campaign messaging, rollout, assets, and open questions. The original document is retained before claims are extracted, and the review names prior evidence with its source and date. PDF/Word extraction is not connected yet.

Use **Correct the launch authority**, then try the next release to see the scoped lesson reused. The source picker also supports Engineering or your own input. Arbitrary prompts reach the selected model; local fact extraction and conflict rules remain a limited demo adapter.

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

Real Codex text generation and browser-local writes. Facts, notes, turns, corrections, and replay events survive reloads in this browser. **Reset demo** clears this demo’s records and restores the seeded Monday claim. A failed write or model call is not represented as a successfully saved answer; earlier successful fact writes may remain.

Atlas, Voyage, Vector Search, the team's production resolution engine, and backend streaming are not connected. The replay shows recorded application operations at an illustrative pace, not model-internal reasoning. Local policy rules are a provisional adapter, not a competing production implementation.

- `src/journey.jsx`: terminal, model connection UI, and optional replay.
- `src/memory.js`: provisional local memory/trace adapter.
- `src/fixtures/launch-memo.md`: natural example document for the review demo.
- `src/memory.test.js`: persistence order, correction/reuse, scope, arbitrary prompts, and failure checks.
- `src/styles.css`: consistent terminal padding and layered spatial scene.
- `server/providers.mjs`: Codex and API provider adapters.
- `vite.config.js`: localhost-only, same-origin model endpoints.

Implementation references: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex authentication](https://learn.chatgpt.com/docs/auth), [OpenAI text generation](https://developers.openai.com/api/docs/guides/text), [Claude model IDs](https://platform.claude.com/docs/en/models/overview).

## Team

Team 419: Elmir, Sahil, Maxime, and Danny. Full last names still need to be added before submission.
