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
