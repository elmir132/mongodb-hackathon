gracefully to session-only precedents (see the `retrieval-fallback` trace
event) instead of erroring. Set both env vars (see `.env.example` at the repo
root) to run against the real Atlas Hackathon Sandbox.
# Chronicle backend

The repository now contains two cooperating backend surfaces:

- `backend/app.py` is the main demo API, wiring Elmir's resolution engine and
  Danny's retrieval into the conflict workflow.
- `backend/app/main.py` is the persistence-focused FastAPI service for facts,
  state, overrides, and persisted SSE events. It supports MongoDB transactions
  and the repeatable `scripts/seed_demo.py` Atlas seed.

Run the main demo API with `uvicorn backend.app:app --reload --port 8000` from
the repository root. The persistence service can be run from `backend/` with
`uvicorn app.main:app --reload`. Keep credentials in `.env`; never commit the
real MongoDB URI or Voyage key.

The main demo API exposes `/api/health`, `/api/demo/reset`,
`/api/conflicts/resolve`, `/api/conflicts/correct`, `/api/policy`, and
`/api/trace`. The persistence service exposes `/health`, `/facts`, `/state`,
`/override`, and `/events`. See the root `README.md`, `INTEGRATION.md`, and
`ATLAS_SETUP.md` for the current integration contract.

To seed the persistence service in Atlas mode, run from `backend/`:

```powershell
.\.venv\Scripts\python.exe scripts\seed_demo.py
```

The seed uses the existing API endpoints, creates the `chronicle-demo` facts
and conflict runs, avoids duplicates with a marker, and reports whether the
real retrieval and resolution integrations are available.
