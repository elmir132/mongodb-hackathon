# Chronicle backend

Wires Elmir's resolution engine + Danny's retrieval into one real HTTP API.
Sahil: this is a working starting point, point it at real Atlas/Voyage
credentials and extend as needed — nothing here is meant to be final.

## Run it

```sh
cd backend
python3 -m venv ../backend-venv          # first time only
../backend-venv/bin/pip install fastapi "uvicorn[standard]"
../backend-venv/bin/uvicorn app:app --reload --port 8000
```

Works immediately with no setup: no `MONGODB_URI` → in-memory precedent
store (Danny's own fallback). No `VOYAGE_API_KEY` → retrieval degrades
gracefully to session-only precedents (see the `retrieval-fallback` trace
event) instead of erroring. Set both env vars (see `.env.example` at the repo
root) to run against the real Atlas Hackathon Sandbox.

## Endpoints

| Method & path | What it does |
|---|---|
| `GET /api/health` | Storage mode (`atlas`/`in-memory`) + current policy version |
| `POST /api/demo/reset` | Wipes session state, fresh starting policy |
| `POST /api/conflicts/resolve` | Facts in, `Resolution` out (calls the engine + retrieval) |
| `POST /api/conflicts/correct` | Human correction in, new precedent + policy diff out |
| `GET /api/policy` | Current policy snapshot |
| `GET /api/trace` | Full session trace, for the Living Ledger replay |

## Try the actual demo scenario

```sh
curl -X POST localhost:8000/api/demo/reset

curl -X POST localhost:8000/api/conflicts/resolve -H 'content-type: application/json' -d '{
  "conflict_id": "c1", "scope": "launch-readiness",
  "facts": [
    {"text": "The launch is Friday", "source": "Marketing", "subject": "launch"},
    {"text": "The launch moved to Monday", "source": "Engineering", "subject": "launch"}
  ]
}'
# -> selected_fact_id is Marketing's (plausible-but-wrong starting policy)

curl -X POST localhost:8000/api/conflicts/correct -H 'content-type: application/json' -d '{
  "conflict_id": "c1", "correct_fact_id": "<engineerings fact id from above>",
  "reason": "Engineering owns launch readiness decisions."
}'

curl -X POST localhost:8000/api/conflicts/resolve -H 'content-type: application/json' -d '{
  "conflict_id": "c2", "scope": "launch-readiness",
  "facts": [
    {"text": "Launch is next Wednesday", "source": "Marketing", "subject": "launch"},
    {"text": "Launch is pushed to next Friday", "source": "Engineering", "subject": "launch"}
  ]
}'
# -> applied_precedent_id matches the correction above, selected = Engineering
```

## Known gap — source name casing

Found and fixed while wiring this: the engine's own demo/tests used lowercase
source names (`"marketing"`), but the real frontend sends capitalized ones
(`"Marketing"`, per Max's spec). This silently broke both authority scoring
and precedent matching, falling through to recency with no error. Fixed in
`resolution-engine/resolution_engine.py` (case-insensitive matching + a
de-duplicated ranking on correction) — verified end to end through this
actual API with capitalized sources, not just the lowercase local tests.

If you introduce a new source name anywhere (frontend, seed data, tests),
casing no longer needs to match exactly, but do keep it human-readable,
whatever casing wins a correction is what gets displayed in the policy panel.

## What's still not connected

- **Frontend** (`src/`) still runs on its own local adapter (`src/memory.js`),
  not this API yet. Swapping that is the next real integration step.
- **MongoDB persistence for facts/resolutions** — precedents go through
  Danny's store (Atlas-ready via `MONGODB_URI`), but facts/resolutions live
  in this process's memory for now. Fine for a single demo session; would
  need a real collection + the event-stream endpoint the team discussed if
  multi-session persistence matters before submission.
