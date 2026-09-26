# Chronicle backend

This is the one real backend surface: Sahil's persistence-focused FastAPI
service (`backend/app/`) for facts, state, overrides, and persisted SSE
events, now wired to the real Chronicle logic instead of a mock:

- `app/integrations/elmir_engine.py` (`ElmirResolutionEngine`) is the default
  `resolution_engine` in `app/main.py`, replacing `PassthroughResolutionEngine`.
  It adapts Sahil's generic `subject/predicate/value/source` facts into
  Elmir's real `resolution_engine.py` (weighted authority+recency scoring,
  precedent lookup, and learning from corrections), and implements the
  `.correct()` method that `POST /state/correct` calls.
- `app/integrations/danny_retrieval.py` (`DannyPrecedentRetriever`) plugs in
  Danny's Atlas/Voyage vector search when `PRECEDENT_STORE=atlas` and
  `VOYAGE_API_KEY` is set; it falls back to `EmptyPrecedentRetriever` (in
  `mocks.py`) in memory mode. `ElmirResolutionEngine` also keeps its own
  session-local precedent store so a correction made moments ago is applied
  immediately, without waiting for it to be embedded and upserted into Atlas.

An earlier standalone `backend/app.py` (a single-file prototype wiring the
same resolution engine) has been retired now that this package is the real,
tested integration point — having both caused a literal Python import
collision (`app.py` and `app/` in the same directory), on top of being two
backend surfaces to keep in sync.

Run it from `backend/`: `uvicorn app.main:app --reload --port 8000`. Keep
credentials in `.env`; never commit the real MongoDB URI or Voyage key.

Endpoints: `GET /health`, `POST /facts`, `GET /facts`, `GET /state`,
`POST /state` (resolve a conflict — requires `context.scope` and
`context.subject`), `POST /state/correct` (record a human correction —
returns 501 if the wired resolution engine doesn't implement `.correct()`),
`POST /override`, `GET /events` (SSE). See the root `README.md`,
`INTEGRATION.md`, and `ATLAS_SETUP.md` for the wider integration contract.

To seed the service in Atlas mode, run from `backend/`:

```powershell
.\.venv\Scripts\python.exe scripts\seed_demo.py
```

The seed uses the existing API endpoints, creates the `chronicle-demo` facts
and conflict runs, avoids duplicates with a marker, and reports whether the
real retrieval and resolution integrations are available.

## Active terminal integration

The frontend resolves through `POST /state` and learns through `POST /state/correct`. Both require `context.scope` and `context.subject`. Workspace load/save/status remain in `app/api/ledger.py`. It is mounted inside this same `app.main:app` server. The generic `/state`
endpoints above remain available; the frontend uses the workspace-scoped routes
to preserve measured retrieval, durable policy versions and existing chats.

From the repository root:

```sh
uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
# Configure the ignored .env with MONGODB_URI and VOYAGE_API_KEY.
.venv/bin/python scripts/setup_atlas.py
npm run backend
# In another terminal:
npm run dev
```

`npm run backend` launches the canonical `app.main:app` and loads the root `.env` server-side. It automatically chooses Atlas when the URI
is present; configured Atlas failures do not silently fall back to memory.
Without a URI it explicitly reports non-durable server memory. The frontend
requires the backend and does not silently switch to local resolution rules.

| Endpoint | Contract |
| --- | --- |
| `GET /api/ledger/status` | Configuration metadata only; no credentials or proof of successful execution |
| `POST /api/ledger/load` | `{workspaceId}` → persisted frontend state + service configuration |
| `POST /api/ledger/save` | `{workspaceId,state,operation,route?}` → acknowledged persistence receipt |
| `POST /state` | `{project_id,conflict_text,context:{scope,subject,workspace_id,conflict_id,fact_ids}}` → `StateResponse.value` contains resolution + ordered receipts |
| `POST /state/correct` | `{correct_fact_id,reason,context:{scope,subject,workspace_id,conflict_id,request_id,remember_authority}}` → linked human decision, optional scoped lesson/policy, readiness + receipts |

Workspace IDs are stable browser-selected project IDs. `workspaces` holds one
atomic project snapshot: original documents, facts, turns, engine resolutions,
human answers, policy history and traces. This avoids deleting or relabeling
existing team collections. Danny's `precedents` collection holds the actual
Voyage vectors. Only IDs committed in the workspace are eligible for resolution;
a failed policy commit cannot publish an orphan vector as a usable lesson.
Reset creates a new isolated workspace and retains previous Atlas runs.

The explicit Engineering readiness choice broadens the new precedent from one
release subject to that workspace's launch-readiness domain, as requested by the
checkbox. Other choices leave policy unchanged. Corrections are idempotent per
conflict. Index readiness is checked with an actual search before reporting it.
No session candidates or synthetic similarity scores are injected.

Receipts include stable event ID, timestamp, service, stage, operation, status,
input/output summary, measured elapsed time and optional actual evidence.
They arrive with HTTP responses; the generic repository’s `/events` SSE route is separate from replay. A receipt's
`route` references the visualization contract in `src/replay-model.js`.
The original document is persisted before the limited browser parser's claims.
The model still reviews the complete uploaded document.

Validation:

```sh
.venv/bin/python -m pytest tests resolution-engine -q
npm test
npm run build
# Explicit paid/live calls; creates an isolated workspace-qa-* project:
node scripts/check_live_services.mjs
```

The live check deliberately stubs the response model; it verifies actual Atlas,
Voyage, search, engine decisions, correction reuse and an out-of-scope case.
Browser QA separately exercises Codex and read-only replay. This is a local demo
integration, not a multi-user hosted application.

### Correction and retrieval contract

`POST /state/correct` is the learning endpoint. `POST /override` only stores a key-value note. Both state POST endpoints require non-empty `context.scope` and `context.subject`; missing keys are rejected before retrieval. `OrchestrationService.resolve_candidates` calls `DannyPrecedentRetriever` once upstream and passes its results as `precedents` to `ElmirResolutionEngine`. The workspace path disables synthetic session-local candidates and restores the persisted policy before each decision. See [INTEGRATION.md](../INTEGRATION.md) for exact payloads.
