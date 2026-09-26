# Chronicle Backend

FastAPI service for Chronicle facts, persisted state, manual overrides, and an event stream. The resolution engine and precedent retrieval are integration interfaces; the included development mocks deliberately return empty results and do not implement learning logic.

## Start In Development Mode

Python 3.11 or newer is required. From this `backend/` directory:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

`CHRONICLE_STORAGE_MODE=memory` is the default and is reported by `/health`. It is explicitly development-only: facts, state, overrides, and events live in process memory and are discarded when the process exits. The default retrieval and resolution mocks are also logged at startup. API docs are available at `/docs`.

## Atlas Mode

Set `CHRONICLE_STORAGE_MODE=mongodb` and `MONGODB_URI` in `.env`; the URI is read only from the environment and must never be committed. `MONGODB_DB` selects the database (default `chronicle`). The legacy `CHRONICLE_MONGODB_URI` and `CHRONICLE_MONGODB_DATABASE` names are also accepted. Startup pings MongoDB and creates app indexes. Fact/state/override mutations and their corresponding event records are committed in the same MongoDB transaction; Atlas must therefore be configured as a replica set, as it is by default.

Precedent retrieval is configured separately with `PRECEDENT_STORE=memory` (default mock) or `PRECEDENT_STORE=atlas`. Atlas retrieval requires `VOYAGE_API_KEY` and the teammate `retrieval` module. `VOYAGE_EMBEDDING_MODEL` defaults to `voyage-4`; `MONGODB_PRECEDENTS_COLLECTION` and `MONGODB_VECTOR_INDEX` default to `precedents` and `precedents_vector_index`. Danny owns embedding and retrieval behavior; this backend adapts to his module and does not implement either algorithm. See [ATLAS_SETUP.md](ATLAS_SETUP.md) for the shared collection/index contract.

## API Contracts

All request and response bodies are JSON except `GET /events`, which is Server-Sent Events (SSE). Validation failures return FastAPI's `422` response.

| Method and path | Contract |
| --- | --- |
| `GET /health` | Returns `status`, `storage_mode`, and `environment`; returns `503` if MongoDB is unavailable. |
| `POST /facts` | Accepts `{subject, predicate, value, source?, confidence?}`; confidence must be between `0` and `1`. Returns the stored fact (`201`). |
| `GET /facts` | Returns all stored facts, newest first in MongoDB mode. |
| `GET /state` | Returns `{revision, value, overrides, updated_at}` for the latest persisted state and manual overrides. |
| `POST /state` | Accepts `{conflict_text, project_id, context?}`. Loads facts, calls `find_matching_precedent(conflict_text, project_id, as_dicts=True)` through the retrieval adapter, passes facts/precedents/context to the resolution interface, persists its returned value, and emits `state.resolved`. Returns the new state. |
| `POST /override` | Accepts `{key, value, reason}`. Replaces the override for that key and emits `override.set`; returns the stored override (`201`). |
| `GET /events` | Opens an SSE stream. Each message has an event `id`, `event` kind, and JSON `data`. Resume with `?after_id=<id>` or the `Last-Event-ID` header. |

Facts and state runs emit `fact.created` and `state.resolved` events respectively. Event records persist in the same transaction as their mutation in Atlas mode. SSE polls persisted events, allowing clients to resume after reconnecting.

## Teammate Integrations

The service calls Danny's `retrieval.find_matching_precedent(conflict_text, project_id, as_dicts=True)` through `DannyPrecedentRetriever` when `PRECEDENT_STORE=atlas`. His module should return JSON-friendly candidate dictionaries containing IDs, similarity scores, and scope metadata. The service also passes those candidates to the teammate-owned `ResolutionEngine.resolve(facts=..., precedents=..., context=...)`; it does not define retrieval, resolution, or learning behavior.

Run tests from this directory with `python -m pytest`.
